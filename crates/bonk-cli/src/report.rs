//! What a run prints as it goes, its summary, and the JUnit / JSON reports.

use bonk_core::application::runner::{RowStatus, RunEvent, RunResultRow, RunStatus};
use bonk_core::domain::request_prep::encode_uri_component;
use serde_json::{json, Value};

pub struct Report {
    iterations: u32,
    color: bool,
    /// Values never printed or written: CI logs and report artifacts are widely readable.
    secrets: Vec<String>,
    secret_keys: Vec<String>,
    rows: Vec<RunResultRow>,
}

impl Report {
    pub fn new(iterations: u32, color: bool, secrets: Vec<String>) -> Self {
        Self {
            iterations,
            color,
            secrets: secrets.into_iter().filter(|s| !s.is_empty()).collect(),
            rows: Vec::new(),
            secret_keys: Vec::new(),
        }
    }

    pub fn protect_variables(&mut self, keys: &[String]) {
        self.secret_keys = keys.to_vec();
    }

    /// `text` with every secret (as is, or URL-encoded) replaced by `<redacted>`.
    fn redact(&self, text: &str) -> String {
        self.secrets.iter().fold(text.to_string(), |text, secret| {
            let escaped = serde_json::to_string(secret).unwrap_or_default();
            let escaped = escaped
                .get(1..escaped.len().saturating_sub(1))
                .unwrap_or(secret);
            text.replace(secret, "<redacted>")
                .replace(escaped, "<redacted>")
                .replace(&encode_uri_component(secret), "<redacted>")
        })
    }

    /// Redact everything of a row that is printed or written, once, as it arrives.
    fn redact_row(&self, mut row: RunResultRow) -> RunResultRow {
        let redact = |value: &mut String| *value = self.redact(value);
        redact(&mut row.target);
        redact(&mut row.request_name);
        row.error.iter_mut().for_each(redact);
        row.response_body.iter_mut().for_each(redact);
        row.logs.iter_mut().for_each(redact);
        for test in &mut row.tests {
            redact(&mut test.name);
            test.error.iter_mut().for_each(redact);
        }
        row
    }

    /// Print a runner event as it happens; keep the rows for the summary and reports.
    pub fn event(&mut self, event: RunEvent) {
        match event {
            RunEvent::Vars(w) => {
                for (key, value) in w.env_set.into_iter().chain(w.globals_set) {
                    if self.secret_keys.contains(&key) && !value.is_empty() {
                        self.secrets.push(value);
                    }
                }
            }
            RunEvent::Iteration { index, .. } if self.iterations > 1 => {
                println!(
                    "\n{}",
                    self.paint(DIM, &format!("Iteration {index}/{}", self.iterations))
                );
            }
            RunEvent::Row(row) => {
                let row = self.redact_row(*row);
                self.print_row(&row);
                self.rows.push(row);
            }
            _ => {}
        }
    }

    pub fn all_ok(&self) -> bool {
        self.rows.iter().all(|row| row.ok)
    }

    fn print_row(&self, row: &RunResultRow) {
        let mark = if row.ok {
            self.paint(GREEN, "✓")
        } else {
            self.paint(RED, "✗")
        };
        println!(
            "{mark} {:<6} {:<4} {:>7}  {}  {}",
            row.method,
            status(&row.status),
            format!("{} ms", row.elapsed_ms),
            row.request_name,
            self.paint(DIM, &row.target)
        );
        for test in &row.tests {
            if test.passed {
                println!("    {} {}", self.paint(GREEN, "✓"), test.name);
            } else {
                let error = test
                    .error
                    .as_deref()
                    .map(|e| format!(": {e}"))
                    .unwrap_or_default();
                println!("    {} {}{error}", self.paint(RED, "✗"), test.name);
            }
        }
        if let Some(error) = &row.error {
            println!("    {}", self.paint(RED, &format!("error: {error}")));
        }
    }

    pub fn print_summary(&self, status: RunStatus) {
        let failed = self.rows.iter().filter(|row| !row.ok).count();
        let tests: Vec<_> = self.rows.iter().flat_map(|row| &row.tests).collect();
        let failed_tests = tests.iter().filter(|test| !test.passed).count();
        let seconds = self.rows.iter().map(|row| row.elapsed_ms).sum::<u64>() as f64 / 1000.0;
        let line = format!(
            "{} requests · {} passed · {} failed · {} tests, {} failed · {seconds:.1}s",
            self.rows.len(),
            self.rows.len() - failed,
            failed,
            tests.len(),
            failed_tests
        );
        println!(
            "\n{}",
            self.paint(if failed == 0 { GREEN } else { RED }, &line)
        );
        if status == RunStatus::Stopped {
            println!("{}", self.paint(DIM, "stopped early (--bail)"));
        }
    }

    pub fn json(&self, status: RunStatus) -> String {
        let rows: Vec<Value> = self
            .rows
            .iter()
            .map(|row| {
                let mut value = serde_json::to_value(row).unwrap_or_default();
                if let Some(map) = value.as_object_mut() {
                    map.remove("responseBody");
                }
                value
            })
            .collect();
        let failed = self.rows.iter().filter(|row| !row.ok).count();
        let report = json!({
            "status": status,
            "passed": self.rows.len() - failed,
            "failed": failed,
            "rows": rows,
        });
        serde_json::to_string_pretty(&report).unwrap_or_default()
    }

    /// One `<testcase>` per executed request; the class is its folder in the workspace.
    pub fn junit(&self) -> String {
        let failures = self.rows.iter().filter(|row| !row.ok).count();
        let seconds = |ms: u64| format!("{:.3}", ms as f64 / 1000.0);
        let total = seconds(self.rows.iter().map(|row| row.elapsed_ms).sum());
        let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        out += &format!(
            "<testsuites name=\"bonk\" tests=\"{}\" failures=\"{failures}\" time=\"{total}\">\n",
            self.rows.len()
        );
        out += &format!(
            "  <testsuite name=\"bonk\" tests=\"{}\" failures=\"{failures}\" time=\"{total}\">\n",
            self.rows.len()
        );
        for row in &self.rows {
            let class = row
                .node_id
                .strip_prefix("fs:")
                .and_then(|rel| rel.rsplit_once('/'))
                .map_or("bonk", |(dir, _)| dir);
            let name = if self.iterations > 1 {
                format!("{} #{}", row.request_name, row.iteration)
            } else {
                row.request_name.clone()
            };
            out += &format!(
                "    <testcase classname=\"{}\" name=\"{}\" time=\"{}\"",
                xml(class),
                xml(&name),
                seconds(row.elapsed_ms)
            );
            if row.ok {
                out += "/>\n";
                continue;
            }
            let failed: Vec<String> = row
                .tests
                .iter()
                .filter(|t| !t.passed)
                .map(|t| format!("{}: {}", t.name, t.error.as_deref().unwrap_or("failed")))
                .collect();
            let message = row
                .error
                .clone()
                .or_else(|| failed.first().cloned())
                .unwrap_or_else(|| format!("status {}", status(&row.status)));
            out += &format!(
                ">\n      <failure message=\"{}\">{}</failure>\n    </testcase>\n",
                xml(&message),
                xml(&format!(
                    "{} {}\n{}",
                    row.method,
                    row.target,
                    failed.join("\n")
                ))
            );
        }
        out + "  </testsuite>\n</testsuites>\n"
    }

    fn paint(&self, code: &str, text: &str) -> String {
        if self.color {
            format!("\x1b[{code}m{text}\x1b[0m")
        } else {
            text.to_string()
        }
    }
}

const GREEN: &str = "32";
const RED: &str = "31";
const DIM: &str = "2";

fn status(status: &RowStatus) -> String {
    match status {
        RowStatus::Code(code) => code.to_string(),
        RowStatus::Text(text) => text.clone(),
    }
}

fn xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use bonk_core::application::runner::ScriptTest;

    fn row(ok: bool) -> RunResultRow {
        RunResultRow {
            id: "1".into(),
            iteration: 1,
            request_name: "get <user>".into(),
            protocol: "http".into(),
            method: "GET".into(),
            target: "https://x/?a=1&b=2".into(),
            status: RowStatus::Code(if ok { 200 } else { 500 }),
            ok,
            elapsed_ms: 1500,
            tests: vec![ScriptTest {
                name: "status".into(),
                passed: ok,
                error: (!ok).then(|| "expected 500 to equal 200".into()),
                ..ScriptTest::default()
            }],
            logs: Vec::new(),
            error: None,
            response_body: Some("secret body".into()),
            node_id: "fs:api/users/get.bonk.json".into(),
            start_offset_ms: None,
            size_bytes: None,
            end_ms: None,
            inputs: Default::default(),
            waited_ms: None,
        }
    }

    #[test]
    fn junit_escapes_and_names_the_failure() {
        let mut report = Report::new(1, false, Vec::new());
        report.event(RunEvent::Row(Box::new(row(true))));
        report.event(RunEvent::Row(Box::new(row(false))));
        let xml = report.junit();
        assert!(
            xml.contains(r#"tests="2" failures="1" time="3.000""#),
            "{xml}"
        );
        assert!(
            xml.contains(r#"classname="api/users" name="get &lt;user&gt;""#),
            "{xml}"
        );
        assert!(
            xml.contains(r#"message="status: expected 500 to equal 200""#),
            "{xml}"
        );
        assert!(xml.contains("?a=1&amp;b=2"), "{xml}");
    }

    #[test]
    fn secrets_never_reach_the_output() {
        let mut report = Report::new(1, false, vec!["s3 cret".into()]);
        report.protect_variables(&["TOKEN".into()]);
        let refreshed = "refreshed\"token";
        report.event(RunEvent::Vars(bonk_core::application::runner::VarWrites {
            env_set: [("TOKEN".into(), refreshed.into())].into(),
            ..Default::default()
        }));
        let mut leaky = row(false);
        leaky.target = "https://x/?key=s3%20cret".into();
        leaky.error = Some("401 for token s3 cret".into());
        leaky
            .logs
            .push(serde_json::json!({ "token": refreshed }).to_string());
        report.event(RunEvent::Row(Box::new(leaky)));
        let (xml, json) = (report.junit(), report.json(RunStatus::Done));
        assert!(!xml.contains("s3") && !json.contains("s3"), "{xml}\n{json}");
        assert!(xml.contains("key=&lt;redacted&gt;"), "{xml}");
        assert!(!json.contains("refreshed"), "{json}");
    }

    #[test]
    fn json_drops_response_bodies() {
        let mut report = Report::new(1, false, Vec::new());
        report.event(RunEvent::Row(Box::new(row(false))));
        let json = report.json(RunStatus::Done);
        assert!(json.contains(r#""failed": 1"#), "{json}");
        assert!(!json.contains("secret body"), "{json}");
    }
}
