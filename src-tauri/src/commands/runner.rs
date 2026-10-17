//! Collection Runner: bonk-core's runner with the app's network.

use std::collections::{BTreeMap, HashMap};
use std::future::Future;
use std::sync::Arc;

use bonk_core::application::http::{http_send_with, StreamHooks};
use bonk_core::application::runner::{
    self, GrpcSchema, GrpcTarget, InputAnswer, InputRequest, RunControl, RunEvent, RunPlan,
    RunStatus, RunVars, Transport,
};
use bonk_core::domain::grpc::{GrpcPrefs, GrpcResult};
use bonk_core::domain::http::{HttpRequest, HttpResponse, RequestSettings};
use bonk_core::infra::cookie_jar::CookieJar;
use serde::Deserialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::state::AppState;

/// gRPC settings of a run (Settings → gRPC and request timeouts).
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrpcRunSettings {
    #[serde(default)]
    pub(super) prefs: GrpcPrefs,
    pub(super) connect_timeout_ms: Option<u64>,
    pub(super) deadline_ms: Option<u64>,
}

/// Run `plan`, streaming rows, script variable writes and progress to `on_event`.
/// Returns how it ended. Pause / stop it by `run_id`.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn runner_run(
    run_id: String,
    mut plan: RunPlan,
    vars: RunVars,
    settings: RequestSettings,
    grpc: GrpcRunSettings,
    on_event: Channel<RunEvent>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<RunStatus, String> {
    let settings = settings.normalized();
    let jar = super::cookies::jar(&app, &state, &settings.cookie_jar)?;
    jar.set_keep_session(settings.cookies_keep_session);
    plan.client_certs = settings.client_certs.clone();
    let control = Arc::new(RunControl::default());
    state
        .runs
        .lock()
        .map_err(|_| "runner lock poisoned".to_string())?
        .insert(run_id.clone(), control.clone());
    let transport = AppTransport {
        state: &state,
        settings,
        jar,
        grpc,
        connection_id: None,
        run_id: run_id.clone(),
        live: None,
    };
    let mut vars = vars;
    let status = runner::run_collection(&plan, &mut vars, &transport, &control, &|event| {
        let _ = on_event.send(event);
    })
    .await;
    if let Ok(mut runs) = state.runs.lock() {
        runs.remove(&run_id);
    }
    drop_inputs(&state, &run_id);
    status
}

/// Interactive Send/Invoke uses the collection engine, retaining the editor's full response.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn request_run(
    request_id: String,
    node: bonk_core::domain::workspace::RequestNode,
    mut plan: RunPlan,
    mut vars: RunVars,
    settings: RequestSettings,
    grpc: GrpcRunSettings,
    connection_id: Option<String>,
    on_event: Channel<RunEvent>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<runner::RequestExecution, String> {
    let settings = settings.normalized();
    let jar = super::cookies::jar(&app, &state, &settings.cookie_jar)?;
    jar.set_keep_session(settings.cookies_keep_session);
    plan.client_certs = settings.client_certs.clone();
    // «Стоп» for an event stream: `request_stop_stream` flips this; the hard cancel stays as is.
    let (stop_tx, stop) = tokio::sync::watch::channel(false);
    if !request_id.is_empty() {
        state
            .stream_stops
            .lock()
            .map_err(|_| "stream registry lock poisoned".to_string())?
            .insert(request_id.clone(), stop_tx);
    }
    let transport = AppTransport {
        state: &state,
        settings,
        jar,
        grpc,
        connection_id,
        run_id: request_id.clone(),
        live: Some(LiveStream {
            on_event: &on_event,
            stop,
        }),
    };
    let id = Some(request_id);
    let cancel = super::http::register_cancel(&state, &id)?;
    let emit = |event| {
        let _ = on_event.send(event);
    };
    let execution = runner::execute_node(&plan, &node, &mut vars, &transport, &emit);
    let result = if let Some(cancel) = cancel {
        tokio::select! { result = execution => Ok(result), _ = cancel => Err("request cancelled".to_string()) }
    } else {
        Ok(execution.await)
    };
    super::http::finish_cancel(&state, &id);
    if let Some(id) = &id {
        if let Ok(mut stops) = state.stream_stops.lock() {
            stops.remove(id);
        }
        drop_inputs(&state, id);
    }
    result
}

/// “Pause” / “Resume”: the run holds before its next call.
#[tauri::command]
pub fn runner_pause(
    run_id: String,
    paused: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(control) = control(&state, &run_id)? {
        control.set_paused(paused);
    }
    Ok(())
}

/// “Stop”: the call in flight finishes, nothing after it is sent.
#[tauri::command]
pub fn runner_stop(run_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(control) = control(&state, &run_id)? {
        control.stop();
    }
    Ok(())
}

/// A person's reply to the form the run `input_id` belongs to waits on.
#[tauri::command]
pub fn runner_input_answer(
    input_id: String,
    answer: InputAnswer,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let (_, reply) = state
        .inputs
        .lock()
        .map_err(|_| "runner lock poisoned".to_string())?
        .remove(&input_id)
        .ok_or_else(|| "the form is no longer waiting".to_string())?;
    reply
        .send(answer)
        .map_err(|_| "the run has already ended".to_string())
}

/// Forget the forms of a finished run.
pub(super) fn drop_inputs(state: &AppState, run_id: &str) {
    if let Ok(mut inputs) = state.inputs.lock() {
        inputs.retain(|_, (owner, _)| owner != run_id);
    }
}

fn control(state: &AppState, run_id: &str) -> Result<Option<Arc<RunControl>>, String> {
    Ok(state
        .runs
        .lock()
        .map_err(|_| "runner lock poisoned".to_string())?
        .get(run_id)
        .cloned())
}

/// The app's network: its HTTP client cache (proxy, CAs, mTLS), the workspace cookie jar,
/// and its gRPC connections (grpcurl first, like the editor).
pub(super) struct AppTransport<'a> {
    pub(super) state: &'a AppState,
    pub(super) settings: RequestSettings,
    pub(super) jar: Arc<CookieJar>,
    pub(super) grpc: GrpcRunSettings,
    pub(super) connection_id: Option<String>,
    /// Owner of the forms this run opens (`AppState.inputs`).
    pub(super) run_id: String,
    /// Single editor Send only: stream SSE events to the UI and listen for «Стоп».
    pub(super) live: Option<LiveStream<'a>>,
}

/// Where an event stream's events go and what stops it.
pub(super) struct LiveStream<'a> {
    pub(super) on_event: &'a Channel<RunEvent>,
    pub(super) stop: tokio::sync::watch::Receiver<bool>,
}

impl Transport for AppTransport<'_> {
    /// Connection id in `AppState.conns`.
    type Grpc = String;

    async fn send_http(&self, request: HttpRequest) -> Result<HttpResponse, String> {
        let client =
            self.state
                .http_client(&self.settings, &request.url, Some(self.jar.clone()))?;
        // A fresh receiver per call: Stop still works on the retry after a 401.
        let on_open = |started_at_ms: u64| {
            if let Some(live) = &self.live {
                let _ = live.on_event.send(RunEvent::SseOpen { started_at_ms });
            }
        };
        let on_event = |e: &bonk_core::domain::sse::SseEvent| {
            if let Some(live) = &self.live {
                let _ = live.on_event.send(RunEvent::SseEvent(e.clone()));
            }
        };
        let hooks = self.live.as_ref().map(|live| StreamHooks {
            on_open: &on_open,
            on_event: &on_event,
            stop: live.stop.clone(),
        });
        let result = http_send_with(
            client,
            request,
            self.settings.clone(),
            Some(&self.jar),
            hooks,
        )
        .await;
        // A jar that can't be written must not hide the response; it's retried on the next save.
        if let Err(e) = self.jar.save() {
            eprintln!("{e}");
        }
        result
    }

    async fn grpc_open(&self, target: GrpcTarget) -> Result<String, String> {
        if let Some(id) = &self.connection_id {
            return Ok(id.clone());
        }
        let id = super::grpc::open(
            self.state,
            target.endpoint,
            target.plaintext,
            target.tls,
            self.grpc.prefs.clone(),
            self.grpc.connect_timeout_ms,
        )
        .await
        .map_err(|e| e.message)?;
        match target.schema {
            GrpcSchema::Reflection => {
                super::grpc::reflect(self.state, &id, self.grpc.connect_timeout_ms)
                    .await
                    .map_err(|e| e.message)?;
            }
            GrpcSchema::Proto { files, imports } => {
                super::grpc::load_proto(self.state, &id, files, imports).await?;
            }
        }
        Ok(id)
    }

    fn grpc_call(
        &self,
        conn: &String,
        method: &str,
        message: &str,
        metadata: &BTreeMap<String, String>,
    ) -> impl Future<Output = Result<GrpcResult, String>> + Send {
        let metadata: HashMap<String, String> = metadata.clone().into_iter().collect();
        async move {
            super::grpc::call(
                self.state,
                conn,
                method,
                message,
                &metadata,
                &None,
                self.grpc.deadline_ms,
            )
            .await
            .map_err(|e| e.message)
        }
    }

    async fn ask_input(
        &self,
        request: InputRequest,
        emit: &(dyn Fn(RunEvent) + Sync),
    ) -> Result<InputAnswer, String> {
        let (reply, answer) = tokio::sync::oneshot::channel();
        self.state
            .inputs
            .lock()
            .map_err(|_| "runner lock poisoned".to_string())?
            .insert(request.id.clone(), (self.run_id.clone(), reply));
        emit(RunEvent::Input(Box::new(request)));
        answer.await.map_err(|_| "the form was closed".to_string())
    }

    fn clear_script_cookies(&self, url: &str) {
        self.jar.clear_for_url(url);
        if let Err(e) = self.jar.save() {
            eprintln!("{e}");
        }
    }

    fn script_cookies(&self, url: &str, response: Option<&HttpResponse>) -> Vec<(String, String)> {
        let set = response.map_or(&[][..], |r| r.cookies.as_slice());
        self.jar.script_cookies(url, set)
    }
}
