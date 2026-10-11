//! Collection Runner data files (CSV / JSON): one `name → value` row per iteration,
//! fed to `pm.iterationData` and `{{var}}` resolution. Mirrors
//! src/features/runner/runnerData.ts (same cases in the tests below).

use serde_json::Value;

use crate::domain::request_prep::Scope;

/// Parse a data file by its extension (`.csv` / `.json`, any case).
pub fn parse_data_file(name: &str, text: &str) -> Result<Vec<Scope>, String> {
    let ext = name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "csv" => Ok(parse_csv(text)),
        "json" => parse_json(text),
        _ => Err(format!(
            "unsupported data file type: {name} (use .csv or .json)"
        )),
    }
}

/// RFC-4180-ish CSV: the first record is the header; quoted fields may hold commas,
/// newlines and `""`; CRLF or LF; a trailing empty line is ignored; missing cells are "".
pub fn parse_csv(text: &str) -> Vec<Scope> {
    let records = split_csv_records(text);
    let Some((headers, rows)) = records.split_first() else {
        return Vec::new();
    };
    rows.iter()
        .map(|cells| {
            headers
                .iter()
                .enumerate()
                .map(|(i, h)| (h.clone(), cells.get(i).cloned().unwrap_or_default()))
                .collect()
        })
        .collect()
}

fn split_csv_records(text: &str) -> Vec<Vec<String>> {
    let chars: Vec<char> = text.chars().collect();
    let mut records = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut in_quotes = false;
    // Anything seen since the last record break (so a final newline adds no empty record).
    let mut saw_any = false;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if in_quotes {
            if ch == '"' {
                if chars.get(i + 1) == Some(&'"') {
                    field.push('"');
                    i += 1;
                } else {
                    in_quotes = false;
                }
            } else {
                field.push(ch);
            }
            saw_any = true;
        } else {
            match ch {
                '"' => {
                    in_quotes = true;
                    saw_any = true;
                }
                ',' => {
                    record.push(std::mem::take(&mut field));
                    saw_any = true;
                }
                '\r' | '\n' => {
                    if ch == '\r' && chars.get(i + 1) == Some(&'\n') {
                        i += 1;
                    }
                    record.push(std::mem::take(&mut field));
                    records.push(std::mem::take(&mut record));
                    saw_any = false;
                }
                _ => {
                    field.push(ch);
                    saw_any = true;
                }
            }
        }
        i += 1;
    }
    if saw_any || !field.is_empty() || !record.is_empty() {
        record.push(field);
        records.push(record);
    }
    records
}

/// A JSON array of objects; values become strings (objects/arrays as JSON, `null` as "null").
pub fn parse_json(text: &str) -> Result<Vec<Scope>, String> {
    let data: Value =
        serde_json::from_str(text).map_err(|e| format!("data file is not valid JSON: {e}"))?;
    let Value::Array(items) = data else {
        return Err("a JSON data file must be an array of objects".into());
    };
    items
        .into_iter()
        .enumerate()
        .map(|(i, item)| match item {
            Value::Object(map) => Ok(map
                .into_iter()
                .map(|(k, v)| {
                    let v = match v {
                        Value::String(s) => s,
                        other => other.to_string(),
                    };
                    (k, v)
                })
                .collect()),
            _ => Err(format!("row {} of the data file is not an object", i + 1)),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(pairs: &[&[(&str, &str)]]) -> Vec<Scope> {
        pairs
            .iter()
            .map(|row| {
                row.iter()
                    .map(|(k, v)| (k.to_string(), v.to_string()))
                    .collect()
            })
            .collect()
    }

    #[test]
    fn csv_cases_from_the_app() {
        assert_eq!(
            parse_csv("name,age\nAda,36\nGrace,44"),
            rows(&[
                &[("name", "Ada"), ("age", "36")],
                &[("name", "Grace"), ("age", "44")]
            ])
        );
        assert_eq!(
            parse_csv("name,note\n\"Doe, John\",\"line1\nline2\""),
            rows(&[&[("name", "Doe, John"), ("note", "line1\nline2")]])
        );
        assert_eq!(
            parse_csv("msg\n\"she said \"\"hi\"\"\""),
            rows(&[&[("msg", "she said \"hi\"")]])
        );
        assert_eq!(
            parse_csv("a,b\r\n1,2\r\n"),
            rows(&[&[("a", "1"), ("b", "2")]])
        );
        assert_eq!(
            parse_csv("a,b,c\n1,2"),
            rows(&[&[("a", "1"), ("b", "2"), ("c", "")]])
        );
        assert!(parse_csv("a,b").is_empty());
    }

    #[test]
    fn json_cases_from_the_app() {
        assert_eq!(
            parse_json(r#"[{"id":1,"active":true,"ratio":1.5,"missing":null}]"#).unwrap(),
            rows(&[&[
                ("id", "1"),
                ("active", "true"),
                ("ratio", "1.5"),
                ("missing", "null")
            ]])
        );
        assert_eq!(
            parse_json(r#"[{"tags":["a","b"],"meta":{"k":1}}]"#).unwrap(),
            rows(&[&[("tags", r#"["a","b"]"#), ("meta", r#"{"k":1}"#)]])
        );
        assert!(parse_json(r#"{"name":"x"}"#).unwrap_err().contains("array"));
        assert!(parse_json(r#"[{"a":1}, 42]"#)
            .unwrap_err()
            .contains("row 2"));
        assert!(parse_json("[{").unwrap_err().contains("not valid JSON"));
    }

    #[test]
    fn dispatches_by_extension() {
        assert_eq!(
            parse_data_file("rows.CSV", "a\n1").unwrap(),
            rows(&[&[("a", "1")]])
        );
        assert_eq!(
            parse_data_file("rows.json", r#"[{"a":"1"}]"#).unwrap(),
            rows(&[&[("a", "1")]])
        );
        assert!(parse_data_file("rows.txt", "a\n1").is_err());
    }
}
