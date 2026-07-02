//! Postman-style user scripts (pre-request + test) executed in a sandboxed
//! QuickJS engine via `rquickjs`.
//!
//! The sandbox is QuickJS's default surface: there is no `fetch`, `require`,
//! `fs`, `setTimeout`, or any host binding beyond what [`PRELUDE`] defines
//! (`pm`, `console`, `__out`, `__finish`). An interrupt handler kills an
//! infinite loop after [`SCRIPT_TIMEOUT_MS`].
//!
//! `run_script` takes the phase (`"pre-request"` | `"test"`, currently only
//! used for future differentiation / diagnostics), the user `code`, and a
//! `context_json` string (already valid JSON, hence a valid JS object literal)
//! and returns the serialized `__out` object as a JSON string. All failures are
//! reported as `Err(String)`; a thrown error inside the user script is captured
//! into `__out.error` instead (so tests/logs collected before the throw survive).

use rquickjs::{CatchResultExt, Context, Runtime};
use std::time::{Duration, Instant};

/// Wall-clock budget for a single script. An interrupt handler trips once the
/// deadline passes, raising an uncatchable QuickJS exception that unwinds the
/// running script (including a `while(true){}` busy loop).
pub const SCRIPT_TIMEOUT_MS: u64 = 2000;

/// Injected before the user code. Defines the `pm` API, a `console` that
/// captures logs, the `__out` accumulator, and `__finish` (which folds the
/// mutated request into `__out.requestPatch`). Kept as ES5-ish so it parses on
/// any QuickJS build without relying on newer syntax.
const PRELUDE: &str = r#"
globalThis.__out={logs:[],tests:[],envSet:{},envUnset:[],globalsSet:{},globalsUnset:[],requestPatch:null,error:null};
(function(){
  var c=globalThis.__ctx||{};
  var env=Object.assign({},c.environment||{}), glob=Object.assign({},c.globals||{});
  var iterData=Object.assign({},c.iterationData||{});
  var req=c.request||{}, reqPatch={__t:1};
  function log(){__out.logs.push(Array.prototype.map.call(arguments,String).join(' '));}
  globalThis.console={log:log,warn:log,error:log,info:log};
  var request={method:req.method,
    get url(){return req.url;}, set url(v){req.url=v;reqPatch.url=v;},
    get body(){return req.body;}, set body(v){req.body=v;reqPatch.body=v;},
    headers:{add:function(k,v){req.headers=req.headers||{};req.headers[k]=v;reqPatch.headers=req.headers;},
             get:function(k){return (req.headers||{})[k];}}};
  var resp=c.response?{code:c.response.code,responseTime:c.response.responseTime,headers:c.response.headers||{},
    text:function(){return c.response.body||'';},json:function(){return JSON.parse(c.response.body||'null');}}:undefined;
  function scope(store,setB,unsetA){return {get:function(k){return store[k];},
    set:function(k,v){store[k]=String(v);setB[k]=String(v);},
    unset:function(k){delete store[k];unsetA.push(k);}};}
  globalThis.pm={
    environment:scope(env,__out.envSet,__out.envUnset),
    globals:scope(glob,__out.globalsSet,__out.globalsUnset),
    iterationData:{get:function(k){return iterData[k];}},
    variables:{get:function(k){return (k in iterData)?iterData[k]:(k in env)?env[k]:glob[k];}},
    request:request, response:resp,
    test:function(name,fn){try{fn();__out.tests.push({name:name,passed:true});}
      catch(e){__out.tests.push({name:name,passed:false,error:String((e&&e.message)||e)});}},
    expect:function(a){return {to:{
      equal:function(x){if(a!==x)throw new Error('expected '+JSON.stringify(a)+' to equal '+JSON.stringify(x));},
      eql:function(x){if(JSON.stringify(a)!==JSON.stringify(x))throw new Error('expected '+JSON.stringify(a)+' to eql '+JSON.stringify(x));},
      be:{get ok(){if(!a)throw new Error('expected '+JSON.stringify(a)+' to be ok');return true;}},
      have:{status:function(n){var code=a&&a.code;if(code!==n)throw new Error('expected status '+n+' but got '+code);}}
    }};}
  };
  globalThis.__finish=function(){var k=Object.keys(reqPatch);if(k.length>1){delete reqPatch.__t;__out.requestPatch=reqPatch;}};
})();
"#;

/// Wrap the user code so a thrown error is captured into `__out.error` rather
/// than aborting the whole evaluation (letting logs/tests recorded before the
/// throw survive). An interrupt (timeout) still unwinds this because it raises
/// an *uncatchable* exception.
fn wrap_user_code(code: &str) -> String {
    format!(
        ";(function(){{try{{\n{code}\n}}catch(e){{globalThis.__out.error=String((e&&e.message)||e);}}}})();"
    )
}

/// Run `code` for `phase` against `context_json`, returning the serialized
/// `__out` JSON string.
///
/// `context_json` must be valid JSON (it is embedded verbatim as a JS object
/// literal). This is synchronous and CPU-bound; callers on an async runtime
/// must run it via `spawn_blocking`.
pub fn run_script(phase: &str, code: &str, context_json: &str) -> Result<String, String> {
    let _ = phase; // reserved for future per-phase behavior / diagnostics
    run_script_with_timeout(code, context_json, SCRIPT_TIMEOUT_MS)
}

/// Core implementation with a configurable timeout so tests can trip the
/// interrupt quickly without waiting the full production budget.
fn run_script_with_timeout(
    code: &str,
    context_json: &str,
    timeout_ms: u64,
) -> Result<String, String> {
    let runtime = Runtime::new().map_err(|e| format!("failed to create JS runtime: {e}"))?;
    let context =
        Context::full(&runtime).map_err(|e| format!("failed to create JS context: {e}"))?;

    // Trip after the deadline. QuickJS calls this periodically while executing;
    // returning true raises an uncatchable exception that unwinds the script,
    // which is how a `while(true){}` gets killed.
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    runtime.set_interrupt_handler(Some(Box::new(move || Instant::now() >= deadline)));

    let user = wrap_user_code(code);

    let result = context.with(|ctx| -> Result<String, String> {
        // 1. Seed the context object (valid JSON == valid JS literal).
        ctx.eval::<(), _>(format!("globalThis.__ctx = ({context_json});"))
            .catch(&ctx)
            .map_err(|e| timeout_or(&deadline, format!("failed to load script context: {e}")))?;

        // 2. Define the pm/console/__out/__finish surface.
        ctx.eval::<(), _>(PRELUDE)
            .catch(&ctx)
            .map_err(|e| timeout_or(&deadline, format!("script prelude failed: {e}")))?;

        // 3. Run the user code (its own throws are caught into __out.error;
        //    only an interrupt/parse error surfaces here).
        ctx.eval::<(), _>(user.as_bytes())
            .catch(&ctx)
            .map_err(|e| timeout_or(&deadline, format!("script error: {e}")))?;

        // 4. Fold the request mutation into __out and serialize it.
        let out: String = ctx
            .eval("__finish(); JSON.stringify(globalThis.__out)")
            .catch(&ctx)
            .map_err(|e| timeout_or(&deadline, format!("failed to finalize script: {e}")))?;

        Ok(out)
    });

    // Clear the handler so the (soon-dropped) runtime holds no dangling closure.
    runtime.set_interrupt_handler(None);

    result
}

/// Map any eval failure that occurred at/after the deadline to a clear timeout
/// message; otherwise keep the original error text.
fn timeout_or(deadline: &Instant, err: String) -> String {
    if Instant::now() >= *deadline {
        format!("script timed out after {SCRIPT_TIMEOUT_MS} ms")
    } else {
        err
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn run(code: &str, ctx: &str) -> Value {
        let out = run_script("test", code, ctx).expect("script should run");
        serde_json::from_str(&out).expect("output is valid JSON")
    }

    #[test]
    fn environment_set_is_recorded() {
        let out = run("pm.environment.set('token', 'abc123');", "{}");
        assert_eq!(out["envSet"]["token"], "abc123");
        assert!(out["error"].is_null());
    }

    #[test]
    fn globals_set_and_unset_recorded() {
        let ctx = r#"{"globals":{"stale":"x"}}"#;
        let out = run(
            "pm.globals.set('base', 'https://api'); pm.globals.unset('stale');",
            ctx,
        );
        assert_eq!(out["globalsSet"]["base"], "https://api");
        assert_eq!(out["globalsUnset"][0], "stale");
    }

    #[test]
    fn tests_pass_and_fail_are_both_recorded() {
        let code = r#"
            pm.test('passes', function(){ pm.expect(1).to.equal(1); });
            pm.test('fails', function(){ pm.expect(1).to.equal(2); });
        "#;
        let out = run(code, "{}");
        let tests = out["tests"].as_array().unwrap();
        assert_eq!(tests.len(), 2);
        assert_eq!(tests[0]["name"], "passes");
        assert_eq!(tests[0]["passed"], true);
        assert_eq!(tests[1]["name"], "fails");
        assert_eq!(tests[1]["passed"], false);
        assert!(tests[1]["error"].as_str().unwrap().contains("equal"));
    }

    #[test]
    fn response_status_assertion_uses_context() {
        let ctx =
            r#"{"response":{"code":200,"body":"{\"ok\":true}","responseTime":12,"headers":{}}}"#;
        let code = r#"
            pm.test('status', function(){ pm.expect(pm.response).to.have.status(200); });
            pm.test('json', function(){ pm.expect(pm.response.json().ok).to.be.ok; });
        "#;
        let out = run(code, ctx);
        let tests = out["tests"].as_array().unwrap();
        assert_eq!(tests[0]["passed"], true);
        assert_eq!(tests[1]["passed"], true);
    }

    #[test]
    fn request_mutation_becomes_a_patch() {
        let ctx = r#"{"request":{"method":"GET","url":"https://old","headers":{}}}"#;
        let code = r#"
            pm.request.url = 'https://new';
            pm.request.headers.add('X-Trace', 'yes');
        "#;
        let out = run(code, ctx);
        assert_eq!(out["requestPatch"]["url"], "https://new");
        assert_eq!(out["requestPatch"]["headers"]["X-Trace"], "yes");
    }

    #[test]
    fn no_request_mutation_leaves_patch_null() {
        let out = run("pm.environment.set('a', '1');", "{}");
        assert!(out["requestPatch"].is_null());
    }

    #[test]
    fn thrown_error_is_captured_not_fatal() {
        let out = run(
            "pm.environment.set('a','1'); throw new Error('boom');",
            "{}",
        );
        // The set before the throw survives, and the message is captured.
        assert_eq!(out["envSet"]["a"], "1");
        assert_eq!(out["error"], "boom");
    }

    #[test]
    fn iteration_data_is_exposed_and_wins_over_env_and_globals() {
        // `x` lives in all three scopes; `only` lives only in iterationData.
        let ctx = r#"{"iterationData":{"x":"iter","only":"row"},"environment":{"x":"env"},"globals":{"x":"glob"}}"#;
        let code = r#"
            pm.test('iterationData.get returns the seeded value', function(){
                pm.expect(pm.iterationData.get('only')).to.equal('row');
            });
            pm.test('variables.get prefers iterationData over env and globals', function(){
                pm.expect(pm.variables.get('x')).to.equal('iter');
            });
        "#;
        let out = run(code, ctx);
        for test in out["tests"].as_array().unwrap() {
            assert_eq!(test["passed"], true, "iterationData check failed: {test}");
        }
    }

    #[test]
    fn variables_get_falls_back_env_then_globals_without_iteration_data() {
        // No iterationData: env wins over globals, and a globals-only key resolves.
        let ctx = r#"{"environment":{"a":"env"},"globals":{"a":"glob","b":"gb"}}"#;
        let code = r#"
            pm.test('env over globals', function(){ pm.expect(pm.variables.get('a')).to.equal('env'); });
            pm.test('globals fallback', function(){ pm.expect(pm.variables.get('b')).to.equal('gb'); });
        "#;
        let out = run(code, ctx);
        for test in out["tests"].as_array().unwrap() {
            assert_eq!(test["passed"], true, "fallback check failed: {test}");
        }
    }

    #[test]
    fn console_log_is_captured() {
        let out = run("console.log('hello', 42);", "{}");
        assert_eq!(out["logs"][0], "hello 42");
    }

    #[test]
    fn fetch_and_require_are_undefined_sandbox() {
        let code = r#"
            pm.test('no fetch', function(){ pm.expect(typeof fetch).to.equal('undefined'); });
            pm.test('no require', function(){ pm.expect(typeof require).to.equal('undefined'); });
            pm.test('no setTimeout', function(){ pm.expect(typeof setTimeout).to.equal('undefined'); });
        "#;
        let out = run(code, "{}");
        for test in out["tests"].as_array().unwrap() {
            assert_eq!(test["passed"], true, "sandbox check failed: {test}");
        }
    }

    #[test]
    fn infinite_loop_times_out() {
        // Use a short timeout so the test doesn't wait the full 2s budget.
        let err = run_script_with_timeout("while(true){}", "{}", 150)
            .expect_err("infinite loop must be interrupted");
        assert!(
            err.contains("timed out"),
            "expected a timeout error, got: {err}"
        );
    }
}
