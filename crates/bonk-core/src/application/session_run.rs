//! Engine side of session auth: before a send, make sure the environment has a good access
//! token (reuse it, renew it with the refresh request, or run the sign-in scenario) and
//! put it into the request. The data and the keychain format are in `session.rs`.
//!
//! The sign-in scenario and the renewal request are ordinary saved requests run through
//! the same engine (`runner::run_collection` / `run_node`), so proxy, cookies, scripts and
//! «ask on send» inputs (an OTP) work in them unchanged. They run with `session_off`, so
//! a login request never asks for a session itself.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use super::oauth::TokenStore;
use super::runner::{
    self, plan_requests, run_collection, run_node, RowStatus, RunControl, RunEvent, RunPlan,
    RunResultRow, RunVars, Transport,
};
use super::scenarios::{self, Scenario};
use super::session::{self, Caught, Record, SessionInfo};
use super::workspace;
use crate::domain::http::{AuthConfig, SessionConfig};
use crate::domain::request_prep::Scope;

/// How a send got its token, for the editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    /// The stored access token was still good.
    Valid,
    /// Traded the refresh token for a new access token.
    Renewed,
    /// Ran the sign-in scenario.
    SignedIn,
}

/// One step of the sign-in scenario, as the timeline shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStep {
    pub name: String,
    pub status: String,
    pub ms: u64,
    pub ok: bool,
}

/// What happened on the way to a valid token, oldest first.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Trace {
    /// The stored access token was no good: `expired` (past its `exp`) or `rejected` (a 401).
    #[serde(rename_all = "camelCase")]
    Expired {
        at: u64,
        exp: Option<u64>,
        why: String,
    },
    #[serde(rename_all = "camelCase")]
    Renew {
        at: u64,
        request: String,
        status: String,
        ms: u64,
        ok: bool,
    },
    #[serde(rename_all = "camelCase")]
    Login {
        at: u64,
        scenario: String,
        steps: Vec<LoginStep>,
    },
}

/// The session behind a send (`ExecutionDetails.session`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionUse {
    pub environment: String,
    pub login: String,
    pub outcome: Outcome,
    pub info: SessionInfo,
    pub trace: Vec<Trace>,
}

/// Why a login is asking: shown above its form («Войти заново: Login ✓ Send OTP ✓ Verify OTP»).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPrompt {
    pub scenario: String,
    pub environment: String,
    pub steps: Vec<PromptStep>,
    /// What happened before the sign-in: the access token's end and the renewal's refusal.
    pub trace: Vec<Trace>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptStep {
    pub name: String,
    /// `done`, `now` (this one asks) or `todo`.
    pub state: String,
}

/// What a command wants of the session, apart from a send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    /// Before a send: reuse, renew when due, sign in when there is nothing to renew with.
    Send { force: bool },
    /// «Обновить»: renew now; no fallback to the sign-in.
    Refresh,
    /// «Войти»: run the sign-in scenario now.
    SignIn,
}

pub struct Ensured {
    pub record: Record,
    pub outcome: Outcome,
    pub trace: Vec<Trace>,
}

fn at_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().try_into().unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn status_text(status: &RowStatus) -> String {
    match status {
        RowStatus::Code(code) => code.to_string(),
        RowStatus::Text(text) => text.clone(),
    }
}

pub fn find_scenario(root: &str, name: &str) -> Result<Scenario, String> {
    scenarios::load(Path::new(root))?
        .into_iter()
        .find(|s| s.name == name)
        .ok_or_else(|| {
            format!("session: scenario `{name}` is not in this workspace (.bonk/scenarios.json)")
        })
}

/// For an outgoing `session` auth: make sure its environment has a good access token and
/// put it into `bearer_token`. `None` (and `none` auth) for a request that leaves the
/// session out. `force`: the server just said 401, renew whatever the clock says.
pub async fn prepare<T: Transport>(
    auth: &mut AuthConfig,
    node_id: &str,
    plan: &RunPlan,
    vars: &mut RunVars,
    transport: &T,
    emit: &(dyn Fn(RunEvent) + Sync),
    force: bool,
) -> Result<Option<(SessionUse, Scope)>, String> {
    if plan.session_off {
        auth.auth_type = "none".into();
        return Ok(None);
    }
    let config = auth.session.clone().unwrap_or_default();
    config.check()?;
    let scenario = find_scenario(&plan.workspace_root, &config.login)?;
    if config.leaves_out(node_id, &scenario.paths) {
        auth.auth_type = "none".into();
        return Ok(None);
    }
    let got = ensure(
        &config,
        &scenario,
        plan,
        vars,
        transport,
        emit,
        Mode::Send { force },
    )
    .await?;
    auth.bearer_token = Some(got.record.access.clone());
    let mut extra = Scope::new();
    extra.insert("session.access".into(), got.record.access.clone());
    if let Some(refresh) = &got.record.refresh {
        extra.insert("session.refresh".into(), refresh.clone());
    }
    Ok(Some((used(&config, plan, got), extra)))
}

/// The session behind `got`, for the editor.
pub fn used(config: &SessionConfig, plan: &RunPlan, got: Ensured) -> SessionUse {
    SessionUse {
        environment: plan.environment_name.clone(),
        login: config.login.clone(),
        outcome: got.outcome,
        info: got.record.info(),
        trace: got.trace,
    }
}

/// A valid session for the environment of `plan`, saved in the transport's token store.
pub async fn ensure<T: Transport>(
    config: &SessionConfig,
    scenario: &Scenario,
    plan: &RunPlan,
    vars: &mut RunVars,
    transport: &T,
    emit: &(dyn Fn(RunEvent) + Sync),
    mode: Mode,
) -> Result<Ensured, String> {
    let store = transport.token_store();
    let account = session::account(&plan.workspace_root, &plan.environment_name, config);
    let now = session::now_secs();
    let stored = session::stored(&account, store);
    let mut trace = Vec::new();
    let force = matches!(mode, Mode::Send { force: true });
    if let (Mode::Send { .. }, Some(record)) = (mode, &stored) {
        let due = !record.access_fresh(now, config.lead());
        // Not due: reuse. Due, but renewing by itself is off: send it as it is (a 401 may renew).
        if !force && (!due || !config.auto_refreshes()) {
            return Ok(Ensured {
                record: record.clone(),
                outcome: Outcome::Valid,
                trace,
            });
        }
    }
    if mode != Mode::SignIn {
        if let Some(record) = &stored {
            if mode != Mode::Refresh {
                trace.push(Trace::Expired {
                    at: at_ms(),
                    exp: record.access_exp,
                    why: if force { "rejected" } else { "expired" }.into(),
                });
            }
            if config.can_renew() && record.refresh_usable(now) {
                match renew(config, record, plan, vars, transport, emit, &mut trace).await {
                    Ok(next) => {
                        session::save(&account, store, &next)?;
                        return Ok(Ensured {
                            record: next,
                            outcome: Outcome::Renewed,
                            trace,
                        });
                    }
                    Err(e) if mode == Mode::Refresh => return Err(e),
                    Err(_) => {}
                }
            } else if mode == Mode::Refresh {
                return Err("session: there is no refresh token to renew with".into());
            }
        } else if mode == Mode::Refresh {
            return Err("session: not signed in".into());
        }
    }
    let next = login(config, scenario, plan, vars, transport, emit, &mut trace).await?;
    session::save(&account, store, &next)?;
    Ok(Ensured {
        record: next,
        outcome: Outcome::SignedIn,
        trace,
    })
}

/// Trade the refresh token for a new access token with the saved renewal request.
async fn renew<T: Transport>(
    config: &SessionConfig,
    record: &Record,
    plan: &RunPlan,
    vars: &mut RunVars,
    transport: &T,
    emit: &(dyn Fn(RunEvent) + Sync),
    trace: &mut Vec<Trace>,
) -> Result<Record, String> {
    let tree = workspace::load(&plan.workspace_root)?;
    let node = plan_requests(&tree, std::slice::from_ref(&config.renew_request))?
        .into_iter()
        .next()
        .ok_or_else(|| "session: the renewal request is gone".to_string())?;
    let mut nested = plan.clone();
    nested.session_off = true;
    nested.requests.clear();
    let mut data = Scope::new();
    data.insert("session.access".into(), record.access.clone());
    if let Some(refresh) = &record.refresh {
        data.insert("session.refresh".into(), refresh.clone());
    }
    let forward = |event: RunEvent| {
        if matches!(event, RunEvent::Vars(_)) {
            emit(event);
        }
    };
    let row = Box::pin(run_node(
        &nested, &node, 1, &data, vars, transport, &forward,
    ))
    .await;
    let accepted = matches!(row.status, RowStatus::Code(code) if (200..300).contains(&code));
    trace.push(Trace::Renew {
        at: at_ms(),
        request: node.name.clone(),
        status: status_text(&row.status),
        ms: row.elapsed_ms,
        ok: accepted,
    });
    if !accepted {
        return Err(format!(
            "session: the renewal was refused ({})",
            status_text(&row.status)
        ));
    }
    session::renewed(
        config,
        record,
        row.response_body.as_deref().unwrap_or_default(),
        session::now_secs(),
    )
}

/// Run the sign-in scenario and read the tokens out of its responses.
async fn login<T: Transport>(
    config: &SessionConfig,
    scenario: &Scenario,
    plan: &RunPlan,
    vars: &mut RunVars,
    transport: &T,
    emit: &(dyn Fn(RunEvent) + Sync),
    trace: &mut Vec<Trace>,
) -> Result<Record, String> {
    let mut nested = scenario.plan(Path::new(&plan.workspace_root))?;
    nested.session_off = true;
    nested.iterations = 1;
    nested.data_rows.clear();
    nested.client_certs = plan.client_certs.clone();
    nested.global_import_paths = plan.global_import_paths.clone();
    nested.inputs = plan.inputs.clone();
    nested.input_values = plan.input_values.clone();
    nested.input_mode = plan.input_mode;
    nested.input_attempts = plan.input_attempts;
    nested.environment_name = plan.environment_name.clone();
    let names: Vec<String> = nested.requests.iter().map(|n| n.name.clone()).collect();
    let before = trace.clone();
    let rows = Mutex::new(Vec::<RunResultRow>::new());
    let wrapped = |event: RunEvent| match event {
        RunEvent::Row(row) => {
            if let Ok(mut rows) = rows.lock() {
                rows.push(*row);
            }
        }
        // «Отправить заново» ran the step before again: its new row replaces the old one.
        RunEvent::Resent(row) => {
            if let Ok(mut rows) = rows.lock() {
                match rows.iter().rposition(|old| old.node_id == row.node_id) {
                    Some(at) => rows[at] = *row,
                    None => rows.push(*row),
                }
            }
        }
        RunEvent::Input(mut request) => {
            let done = rows.lock().map(|rows| rows.len()).unwrap_or(0);
            request.session = Some(SessionPrompt {
                scenario: scenario.name.clone(),
                environment: plan.environment_name.clone(),
                trace: before.clone(),
                steps: names
                    .iter()
                    .enumerate()
                    .map(|(i, name)| PromptStep {
                        name: name.clone(),
                        state: match i.cmp(&done) {
                            std::cmp::Ordering::Less => "done",
                            std::cmp::Ordering::Equal => "now",
                            std::cmp::Ordering::Greater => "todo",
                        }
                        .into(),
                    })
                    .collect(),
            });
            emit(RunEvent::Input(request));
        }
        RunEvent::Vars(_) => emit(event),
        RunEvent::Iteration { .. }
        | RunEvent::Call { .. }
        | RunEvent::SseOpen
        | RunEvent::SseEvent(_) => {}
    };
    let control = RunControl::default();
    let status = Box::pin(run_collection(&nested, vars, transport, &control, &wrapped)).await?;
    let rows = rows.into_inner().unwrap_or_default();
    trace.push(Trace::Login {
        at: at_ms(),
        scenario: scenario.name.clone(),
        steps: rows
            .iter()
            .map(|row| LoginStep {
                name: row.request_name.clone(),
                status: status_text(&row.status),
                ms: row.elapsed_ms,
                ok: row.ok,
            })
            .collect(),
    });
    if let Some(bad) = rows.iter().find(|row| !row.ok) {
        let why = bad
            .error
            .clone()
            .unwrap_or_else(|| status_text(&bad.status));
        return Err(format!(
            "session: sign-in stopped at {}: {why}",
            bad.request_name
        ));
    }
    if status == runner::RunStatus::Stopped || rows.len() < names.len() {
        return Err("session: the sign-in was cancelled".into());
    }
    let caught: Vec<Caught<'_>> = rows
        .iter()
        .map(|row| Caught {
            node_id: &row.node_id,
            body: row.response_body.as_deref().unwrap_or_default(),
        })
        .collect();
    session::catch(config, &caught, session::now_secs())
}

/// Keep the tokens a finished run of the sign-in scenario caught (the Runner's «Запомнить вход?»).
pub fn save_caught(
    root: &str,
    environment: &str,
    config: &SessionConfig,
    rows: &[(String, String)],
    store: &dyn TokenStore,
) -> Result<Record, String> {
    let caught: Vec<Caught<'_>> = rows
        .iter()
        .map(|(node_id, body)| Caught { node_id, body })
        .collect();
    let record = session::catch(config, &caught, session::now_secs())?;
    session::save(&session::account(root, environment, config), store, &record)?;
    Ok(record)
}
