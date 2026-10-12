//! «Ask on send» variables. A definition per variable name says how the value is asked
//! for (type, label, checks); the run pauses, shows a form, and the typed value lives only
//! in that run. No I/O here: the file is `application/inputs.rs`, the pause is the runner's.

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use super::request_prep::VAR_RE;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InputKind {
    #[default]
    Text,
    Number,
    /// N cells (an SMS code); ⌘V lays a pasted code out over them.
    Code,
    Secret,
    Select,
    /// A confirmation: «no» stops the run instead of sending `false`.
    Bool,
    Json,
    /// A file path.
    File,
}

/// One variable's form field, as saved in `.bonk/inputs.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct InputDef {
    #[serde(rename = "type")]
    pub kind: InputKind,
    pub label: String,
    pub hint: String,
    pub required: bool,
    pub default: String,
    /// Fill the form with the value of the last send (never for a secret).
    pub remember: bool,
    /// Mask the value in the form and the log whatever its type (`Secret` always is).
    pub secret: bool,
    /// `Select`: the variants.
    pub options: Vec<String>,
    /// `Text`: a regex the whole value must match.
    pub pattern: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    /// `Code`: how many cells (0 = 6).
    pub length: u32,
}

impl Default for InputDef {
    fn default() -> Self {
        Self {
            kind: InputKind::Text,
            label: String::new(),
            hint: String::new(),
            required: true,
            default: String::new(),
            remember: false,
            secret: false,
            options: Vec::new(),
            pattern: String::new(),
            min: None,
            max: None,
            step: None,
            length: 0,
        }
    }
}

/// Longest value a form field takes; a JSON or file field is the largest.
const MAX_VALUE_LEN: usize = 1 << 20;

impl InputDef {
    pub fn code_length(&self) -> usize {
        if self.length == 0 {
            6
        } else {
            self.length as usize
        }
    }

    /// Codes and secrets are hidden in logs, history and the sent-request view.
    pub fn sensitive(&self) -> bool {
        self.secret || matches!(self.kind, InputKind::Code | InputKind::Secret)
    }

    /// What a log shows instead of `value`: `••••13` for a code, `••••` for a secret.
    pub fn mask(&self, value: &str) -> String {
        let count = value.chars().count();
        if self.kind == InputKind::Secret || self.secret || count <= 4 {
            return "••••".into();
        }
        let tail: String = value.chars().skip(count - 2).collect();
        format!("••••{tail}")
    }

    /// The value as it is substituted: a number loses its group separators (`25 000`).
    pub fn normalize(&self, value: &str) -> String {
        match self.kind {
            InputKind::Number => value
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect::<String>()
                .replace(',', "."),
            _ => value.to_string(),
        }
    }

    /// `Ok` when a request may go out with `value` (already normalized).
    pub fn check(&self, value: &str) -> Result<(), String> {
        if value.len() > MAX_VALUE_LEN {
            return Err("value is too long".into());
        }
        if value.is_empty() {
            return if self.required {
                Err("value is required".into())
            } else {
                Ok(())
            };
        }
        match self.kind {
            InputKind::Text => {
                if self.pattern.is_empty() {
                    return Ok(());
                }
                let re = Regex::new(&format!("^(?:{})$", self.pattern))
                    .map_err(|e| format!("invalid pattern: {e}"))?;
                if re.is_match(value) {
                    Ok(())
                } else {
                    Err(format!("does not match {}", self.pattern))
                }
            }
            InputKind::Number => {
                let n: f64 = value.parse().map_err(|_| "not a number".to_string())?;
                if !n.is_finite() {
                    return Err("not a number".into());
                }
                if self.min.is_some_and(|min| n < min) {
                    return Err(format!("min {}", self.min.unwrap_or_default()));
                }
                if self.max.is_some_and(|max| n > max) {
                    return Err(format!("max {}", self.max.unwrap_or_default()));
                }
                if let Some(step) = self.step.filter(|s| *s > 0.0) {
                    let ratio = (n - self.min.unwrap_or(0.0)) / step;
                    if (ratio - ratio.round()).abs() > 1e-9 {
                        return Err(format!("step {step}"));
                    }
                }
                Ok(())
            }
            InputKind::Code => {
                let n = self.code_length();
                if value.chars().count() == n && value.chars().all(char::is_alphanumeric) {
                    Ok(())
                } else {
                    Err(format!("{n} characters expected"))
                }
            }
            InputKind::Select => {
                if self.options.is_empty() || self.options.iter().any(|o| o == value) {
                    Ok(())
                } else {
                    Err("not one of the options".into())
                }
            }
            InputKind::Bool => match value {
                "true" | "false" => Ok(()),
                _ => Err("true or false expected".into()),
            },
            InputKind::Json => serde_json::from_str::<serde_json::Value>(value)
                .map(|_| ())
                .map_err(|e| format!("not valid JSON: {e}")),
            InputKind::Secret | InputKind::File => Ok(()),
        }
    }
}

static NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z_][A-Za-z0-9_.\-]*$").expect("valid name regex"));

/// A variable name that can be asked for (no `$dynamic`, no braces).
pub fn valid_name(name: &str) -> bool {
    NAME_RE.is_match(name)
}

/// The `{{names}}` in `text`, each once, in order of appearance.
pub fn placeholders(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for captures in VAR_RE.captures_iter(text) {
        let name = captures[1].trim();
        if !out.iter().any(|n| n == name) {
            out.push(name.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn def(kind: InputKind) -> InputDef {
        InputDef {
            kind,
            ..InputDef::default()
        }
    }

    #[test]
    fn a_code_needs_exactly_its_cells() {
        let code = InputDef {
            length: 4,
            ..def(InputKind::Code)
        };
        assert!(code.check("4829").is_ok());
        assert!(code.check("482").is_err());
        assert!(code.check("48 9").is_err());
        assert!(def(InputKind::Code).check("482913").is_ok());
    }

    #[test]
    fn a_number_is_checked_against_min_max_and_step_from_the_min() {
        let n = InputDef {
            min: Some(100.0),
            max: Some(5_000_000.0),
            step: Some(100.0),
            ..def(InputKind::Number)
        };
        assert_eq!(n.normalize("25 000"), "25000");
        assert!(n.check("25000").is_ok());
        assert!(n.check("50").is_err());
        assert!(n.check("5000100").is_err());
        assert!(n.check("150").is_err());
        assert!(n.check("abc").is_err());
    }

    #[test]
    fn text_matches_its_whole_pattern_and_empty_obeys_required() {
        let text = InputDef {
            pattern: r".+@.+\..+".into(),
            ..def(InputKind::Text)
        };
        assert!(text.check("ivan@dummy.pay").is_ok());
        assert!(text.check("ivan@dummypay").is_err());
        assert!(text.check("").is_err());
        let optional = InputDef {
            required: false,
            ..def(InputKind::Text)
        };
        assert!(optional.check("").is_ok());
    }

    #[test]
    fn select_bool_and_json_take_only_their_values() {
        let select = InputDef {
            options: vec!["KZT".into(), "USD".into()],
            ..def(InputKind::Select)
        };
        assert!(select.check("USD").is_ok());
        assert!(select.check("EUR").is_err());
        assert!(def(InputKind::Bool).check("false").is_ok());
        assert!(def(InputKind::Bool).check("yes").is_err());
        assert!(def(InputKind::Json).check(r#"[{"sku":"A"}]"#).is_ok());
        assert!(def(InputKind::Json).check("{oops").is_err());
    }

    #[test]
    fn a_code_shows_its_tail_and_a_secret_nothing() {
        assert_eq!(def(InputKind::Code).mask("482913"), "••••13");
        assert_eq!(def(InputKind::Secret).mask("482913"), "••••");
        assert_eq!(def(InputKind::Code).mask("123"), "••••");
        assert!(def(InputKind::Code).sensitive());
        assert!(!def(InputKind::Text).sensitive());
        let hidden = InputDef {
            secret: true,
            ..def(InputKind::Select)
        };
        assert!(hidden.sensitive());
        assert_eq!(hidden.mask("KZT-long"), "••••");
    }

    #[test]
    fn placeholders_are_unique_and_trimmed() {
        assert_eq!(
            placeholders(r#"{"a":"{{ otp }}","b":"{{phone}}","c":"{{otp}}"}"#),
            ["otp", "phone"]
        );
    }

    #[test]
    fn a_definition_round_trips_and_rejects_unknown_fields() {
        let d: InputDef = serde_json::from_str(r#"{"type":"code","label":"SMS"}"#).unwrap();
        assert_eq!(d.kind, InputKind::Code);
        assert!(d.required);
        assert!(serde_json::from_str::<InputDef>(r#"{"kind":"code"}"#).is_err());
        assert!(valid_name("otp") && !valid_name("$guid") && !valid_name("a b"));
    }
}
