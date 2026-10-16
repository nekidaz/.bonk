//! Server-Sent Events: wire types and a byte-level parser (WHATWG HTML §9.2).

use serde::{Deserialize, Serialize};

/// One dispatched event of an SSE stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SseEvent {
    /// 0-based, in arrival order.
    pub index: usize,
    /// Epoch ms when the chunk carrying the event arrived.
    pub at_ms: u64,
    /// `message` unless the stream said `event: <name>`.
    pub event: String,
    pub data: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamEndReason {
    Closed,
    Stopped,
    Timeout,
    Truncated,
    Error,
}

/// How and when a streamed response ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamEnd {
    pub reason: StreamEndReason,
    /// Epoch ms the request started, so the UI can show intervals.
    pub started_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Incremental parser: feed raw body chunks, get finished events back.
#[derive(Debug, Default)]
pub struct SseParser {
    /// Bytes of the current, not yet terminated line.
    line: Vec<u8>,
    /// The previous byte was `\r`, so a `\n` right after it is the same line end.
    after_cr: bool,
    /// Whether any line has been completed yet (the BOM can only start the first one).
    seen_line: bool,
    /// `None` until a `data` field arrives; `data\n\n` is an event with empty data.
    data: Option<String>,
    event: Option<String>,
    /// Survives dispatches, as in the spec ("last event id").
    last_id: Option<String>,
    next_index: usize,
}

impl SseParser {
    pub fn push(&mut self, chunk: &[u8], at_ms: u64) -> Vec<SseEvent> {
        let mut out = Vec::new();
        for &b in chunk {
            if std::mem::take(&mut self.after_cr) && b == b'\n' {
                continue;
            }
            match b {
                b'\n' | b'\r' => {
                    self.after_cr = b == b'\r';
                    // Line ends are ASCII, so a multibyte char is never cut here.
                    let line = std::mem::take(&mut self.line);
                    out.extend(self.line_done(&line, at_ms));
                }
                _ => self.line.push(b),
            }
        }
        out
    }

    /// End of stream: an unfinished event that has data is still delivered.
    pub fn finish(&mut self, at_ms: u64) -> Option<SseEvent> {
        if !self.line.is_empty() {
            let line = std::mem::take(&mut self.line);
            if let Some(ev) = self.line_done(&line, at_ms) {
                return Some(ev);
            }
        }
        self.dispatch(at_ms)
    }

    fn line_done(&mut self, raw: &[u8], at_ms: u64) -> Option<SseEvent> {
        let decoded = String::from_utf8_lossy(raw);
        let mut line: &str = &decoded;
        if !std::mem::replace(&mut self.seen_line, true) {
            line = line.strip_prefix('\u{FEFF}').unwrap_or(line);
        }
        if line.is_empty() {
            return self.dispatch(at_ms);
        }
        if line.starts_with(':') {
            return None;
        }
        let (name, value) = line.split_once(':').unwrap_or((line, ""));
        let value = value.strip_prefix(' ').unwrap_or(value);
        match name {
            "data" => match &mut self.data {
                Some(d) => {
                    d.push('\n');
                    d.push_str(value);
                }
                None => self.data = Some(value.to_string()),
            },
            "event" => self.event = Some(value.to_string()),
            "id" if !value.contains('\0') => self.last_id = Some(value.to_string()),
            _ => {} // retry and unknown fields are ignored
        }
        None
    }

    fn dispatch(&mut self, at_ms: u64) -> Option<SseEvent> {
        let event = self.event.take();
        let data = self.data.take()?;
        let index = self.next_index;
        self.next_index += 1;
        Some(SseEvent {
            index,
            at_ms,
            event: event
                .filter(|e| !e.is_empty())
                .unwrap_or_else(|| "message".into()),
            data,
            id: self.last_id.clone(),
        })
    }
}

/// `text/event-stream`, case-insensitive, parameters (`; charset=utf-8`) allowed.
pub fn is_event_stream(content_type: &str) -> bool {
    content_type
        .split(';')
        .next()
        .is_some_and(|m| m.trim().eq_ignore_ascii_case("text/event-stream"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::http::HttpResponse;

    fn all(parser: &mut SseParser, chunk: &[u8]) -> Vec<SseEvent> {
        parser.push(chunk, 1)
    }

    #[test]
    fn joins_multiline_data() {
        let ev = all(&mut SseParser::default(), b"data: a\ndata: b\n\n");
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].data, "a\nb");
        assert_eq!(ev[0].event, "message");
        assert_eq!(ev[0].index, 0);
    }

    #[test]
    fn named_event_with_id() {
        let ev = all(
            &mut SseParser::default(),
            b"event: delta\nid: 7\ndata: {\"x\":1}\n\n",
        );
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].event, "delta");
        assert_eq!(ev[0].id.as_deref(), Some("7"));
        assert_eq!(ev[0].data, "{\"x\":1}");
    }

    #[test]
    fn crlf_and_cr_line_endings() {
        let ev = all(
            &mut SseParser::default(),
            b"data: a\r\n\r\ndata: b\r\rdata: c\n\n",
        );
        let data: Vec<_> = ev.iter().map(|e| e.data.as_str()).collect();
        assert_eq!(data, ["a", "b", "c"]);
    }

    #[test]
    fn cr_split_across_chunks() {
        let mut p = SseParser::default();
        assert!(p.push(b"data: a\r", 1).is_empty());
        let ev = p.push(b"\n\r\n", 2);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].data, "a");
        assert_eq!(ev[0].at_ms, 2);
    }

    #[test]
    fn utf8_split_across_chunks() {
        let bytes = "data: привет\n\n".as_bytes();
        // "data: " is 6 bytes, "п" and "р" 2 each, so 11 cuts "и" in half.
        let (a, b) = bytes.split_at(11);
        let mut p = SseParser::default();
        assert!(p.push(a, 1).is_empty());
        let ev = p.push(b, 2);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].data, "привет");
    }

    #[test]
    fn strips_bom_and_ignores_comments() {
        let ev = all(
            &mut SseParser::default(),
            b"\xEF\xBB\xBF: ping\n\ndata: x\n\n",
        );
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].data, "x");
    }

    #[test]
    fn bom_directly_before_a_field_is_stripped() {
        let ev = all(&mut SseParser::default(), b"\xEF\xBB\xBFdata: x\n\n");
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].data, "x");
    }

    #[test]
    fn bom_split_across_chunks_is_stripped() {
        let mut p = SseParser::default();
        assert!(p.push(b"\xEF\xBB", 1).is_empty());
        let ev = p.push(b"\xBFdata: x\n\n", 2);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].data, "x");
    }

    #[test]
    fn bom_after_the_first_line_is_not_stripped() {
        // The mangled field name is unknown, so that line is ignored.
        let ev = all(
            &mut SseParser::default(),
            b"data: a\n\n\xEF\xBB\xBFdata: b\n\n",
        );
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].data, "a");
    }

    #[test]
    fn event_name_resets_to_message_after_dispatch() {
        let ev = all(
            &mut SseParser::default(),
            b"event: delta\ndata: a\n\ndata: b\n\n",
        );
        let names: Vec<_> = ev.iter().map(|e| e.event.as_str()).collect();
        assert_eq!(names, ["delta", "message"]);
    }

    #[test]
    fn no_data_no_event() {
        assert!(all(&mut SseParser::default(), b"event: x\n\n").is_empty());
    }

    #[test]
    fn finish_flushes_pending_event() {
        let mut p = SseParser::default();
        assert!(p.push(b"data: tail", 1).is_empty());
        let ev = p.finish(2).expect("pending event");
        assert_eq!(ev.data, "tail");
        assert_eq!(ev.at_ms, 2);
        assert!(p.finish(3).is_none());
    }

    #[test]
    fn field_without_colon_and_no_space() {
        let ev = all(&mut SseParser::default(), b"data\ndata:x\n\n");
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].data, "\nx");
    }

    #[test]
    fn indices_increase() {
        let ev = all(&mut SseParser::default(), b"data: a\n\ndata: b\n\n");
        let idx: Vec<_> = ev.iter().map(|e| e.index).collect();
        assert_eq!(idx, [0, 1]);
    }

    #[test]
    fn last_event_id_carries_over_and_nul_id_is_ignored() {
        let ev = all(
            &mut SseParser::default(),
            b"id: 1\ndata: a\n\ndata: b\n\nid: x\0y\ndata: c\n\n",
        );
        let ids: Vec<_> = ev.iter().map(|e| e.id.as_deref()).collect();
        assert_eq!(ids, [Some("1"), Some("1"), Some("1")]);
    }

    #[test]
    fn detects_event_stream() {
        assert!(is_event_stream("Text/Event-Stream; charset=utf-8"));
        assert!(!is_event_stream("application/json"));
        assert!(!is_event_stream(""));
    }

    #[test]
    fn http_response_json_unchanged_without_stream() {
        let resp: HttpResponse = serde_json::from_value(serde_json::json!({
            "status": 200, "headers": {}, "body": "", "final_url": "",
            "elapsed_ms": 1, "size_bytes": 0,
        }))
        .unwrap();
        assert!(resp.events.is_empty());
        assert!(resp.stream_end.is_none());
        let v = serde_json::to_value(&resp).unwrap();
        assert!(v.get("events").is_none());
        assert!(v.get("stream_end").is_none());
    }
}
