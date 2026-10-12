//! Session auth for the Authorization tab, the Sessions dialog and the Runner's «Запомнить вход?».
//! Sends use the runner itself (`request_run`); these are the buttons: sign in now,
//! renew now, sign out, what is stored. Logic: `bonk_core::application::session{,_run}`.

use bonk_core::application::oauth::Keychain;
use bonk_core::application::runner::{RunEvent, RunPlan, RunVars};
use bonk_core::application::session::{self, SessionInfo};
use bonk_core::application::session_run::{self, Mode, SessionUse};
use bonk_core::domain::http::{RequestSettings, SessionConfig};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use super::runner::{drop_inputs, AppTransport, GrpcRunSettings};
use crate::state::AppState;

/// One environment's session as the Sessions dialog lists it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvSession {
    environment: String,
    info: Option<SessionInfo>,
}

/// What is stored for each of `environments` (expired sessions too: the dialog says so).
#[tauri::command]
pub fn session_status(
    workspace_root: String,
    environments: Vec<String>,
    config: SessionConfig,
) -> Vec<EnvSession> {
    environments
        .into_iter()
        .map(|environment| {
            let account = session::account(&workspace_root, &environment, &config);
            EnvSession {
                info: session::stored(&account, &Keychain).map(|r| r.info()),
                environment,
            }
        })
        .collect()
}

/// «Войти» (`signIn`) or «Обновить» (`refresh`) now. The sign-in asks for typed input the
/// way a send does: through `on_event`, answered with `runner_input_answer`.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn session_run(
    request_id: String,
    mode: String,
    config: SessionConfig,
    plan: RunPlan,
    mut vars: RunVars,
    settings: RequestSettings,
    on_event: Channel<RunEvent>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<SessionUse, String> {
    config.check()?;
    let mode = match mode.as_str() {
        "signIn" => Mode::SignIn,
        "refresh" => Mode::Refresh,
        other => return Err(format!("session: unknown mode `{other}`")),
    };
    let settings = settings.normalized();
    let jar = super::cookies::jar(&app, &state, &settings.cookie_jar)?;
    jar.set_keep_session(settings.cookies_keep_session);
    let mut plan = plan;
    plan.client_certs = settings.client_certs.clone();
    let scenario = session_run::find_scenario(&plan.workspace_root, &config.login)?;
    let transport = AppTransport {
        state: &state,
        settings,
        jar,
        grpc: GrpcRunSettings::default(),
        connection_id: None,
        run_id: request_id.clone(),
    };
    let id = Some(request_id.clone());
    let cancel = super::http::register_cancel(&state, &id)?;
    let emit = |event| {
        let _ = on_event.send(event);
    };
    let work = session_run::ensure(
        &config, &scenario, &plan, &mut vars, &transport, &emit, mode,
    );
    let result = match cancel {
        Some(cancel) => tokio::select! {
            result = work => result,
            _ = cancel => Err("cancelled".to_string()),
        },
        None => work.await,
    };
    super::http::finish_cancel(&state, &id);
    drop_inputs(&state, &request_id);
    result.map(|got| session_run::used(&config, &plan, got))
}

/// «Выйти»: forget the session of these environments.
#[tauri::command]
pub fn session_forget(
    workspace_root: String,
    environments: Vec<String>,
    config: SessionConfig,
) -> Result<(), String> {
    for environment in environments {
        session::forget(
            &session::account(&workspace_root, &environment, &config),
            &Keychain,
        )?;
    }
    Ok(())
}

/// «Сохранить» in the Runner: keep the tokens a finished run of the sign-in scenario caught.
/// `rows` are `(node id, response body)` of that run.
#[tauri::command]
pub fn session_save_caught(
    workspace_root: String,
    environment: String,
    config: SessionConfig,
    rows: Vec<(String, String)>,
) -> Result<SessionInfo, String> {
    session_run::save_caught(&workspace_root, &environment, &config, &rows, &Keychain)
        .map(|record| record.info())
}

/// What a finished run of the sign-in scenario would give, without keeping it (the card's
/// «пойманы» list). `None`: the run did not reach the tokens.
#[tauri::command]
pub fn session_peek(config: SessionConfig, rows: Vec<(String, String)>) -> Option<SessionInfo> {
    let caught: Vec<session::Caught<'_>> = rows
        .iter()
        .map(|(node_id, body)| session::Caught { node_id, body })
        .collect();
    session::catch(&config, &caught, session::now_secs())
        .ok()
        .map(|record| record.info())
}
