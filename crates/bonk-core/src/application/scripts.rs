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

use rquickjs::{context::EvalOptions, CatchResultExt, Context, Runtime};
use std::time::{Duration, Instant};

/// Wall-clock budget for a single script. An interrupt handler trips once the
/// deadline passes, raising an uncatchable QuickJS exception that unwinds the
/// running script (including a `while(true){}` busy loop).
pub const SCRIPT_TIMEOUT_MS: u64 = 2000;

/// File name the user code is evaluated under. Stack frames from it are the
/// user's own lines (the prelude runs as `eval_script`), which is how a test,
/// an assertion or a thrown error is pinned to a line of the editor.
const USER_FILE: &str = "script.js";

/// Injected before the user code. Defines the `pm` API, a `console` that
/// captures logs, the `__out` accumulator, and `__finish` (which folds the
/// mutated request into `__out.requestPatch`). Kept as ES5-ish so it parses on
/// any QuickJS build without relying on newer syntax.
///
/// `__out.events` is the console feed (SC5): every log, variable write and
/// header change with a `Date.now()` stamp. `tests[].line` is the line of the
/// `pm.test` call, `tests[].errorLine` the line of the failed assertion.
const PRELUDE: &str = r#"
globalThis.__out={logs:[],events:[],tests:[],envSet:{},envUnset:[],globalsSet:{},globalsUnset:[],cookieClears:[],requestPatch:null,error:null,errorLine:null};
globalThis.__line=function(stack){var m=/script\.js:(\d+)/.exec(String(stack||''));return m?Math.max(1,Number(m[1])-1):null;};
globalThis.__msg=function(e){if(!e||typeof e!=='object')return String(e);var n=e.name&&e.name!=='Error'?e.name+': ':'';return n+String(e.message);};
(function(){
  var c=globalThis.__ctx||{};
  var env=Object.assign({},c.environment||{}), glob=Object.assign({},c.globals||{}), locals={};
  var iterData=Object.assign({},c.iterationData||{});
  var req=c.request||{}, reqPatch={__t:1};
  function ev(o){o.t=Date.now();__out.events.push(o);}
  function log(){var s=Array.prototype.map.call(arguments,function(v){return typeof v==='object'&&v!==null?fmt(v):String(v);}).join(' ');__out.logs.push(s);ev({kind:'log',text:s});}
  globalThis.console={log:log,warn:log,error:log,info:log,debug:log};
  function fmt(v){try{var s=JSON.stringify(v);return s===undefined?String(v):s;}catch(e){return String(v);}}
  function setHeader(k,v,op){var h=req.headers||{},l=String(k).toLowerCase();for(var n in h)if(n.toLowerCase()===l)delete h[n];h[k]=String(v);req.headers=h;reqPatch.headers=h;ev({kind:'hdr',op:op,key:k,value:String(v)});}
  function getHeader(o,k){if(!o)return undefined;var l=String(k).toLowerCase();for(var n in o)if(n.toLowerCase()===l)return o[n];return undefined;}
  var request={method:req.method,
    get url(){return req.url;},
    set url(v){if(req.readonlyUrl)throw new TypeError('pm.request.url is read-only in gRPC requests');req.url=v;reqPatch.url=v;},
    get body(){return req.body;}, set body(v){req.body=v;reqPatch.body=v;},
    headers:{add:function(k,v){if(k&&typeof k==='object'){v=k.value;k=k.key;}setHeader(k,v,'add');},
             upsert:function(k,v){if(k&&typeof k==='object'){v=k.value;k=k.key;}setHeader(k,v,'upsert');},
             remove:function(k){var h=req.headers||{},l=String(k).toLowerCase();for(var n in h)if(n.toLowerCase()===l)delete h[n];req.headers=h;reqPatch.headers=h;ev({kind:'hdr',op:'remove',key:k});},
             get:function(k){return getHeader(req.headers,k);},
             has:function(k){return getHeader(req.headers,k)!==undefined;},
             toObject:function(){return Object.assign({},req.headers||{});}}};
  var resp;
  if(c.response){
    var rh=Object.assign({},c.response.headers||{});
    Object.defineProperty(rh,'get',{value:function(k){return getHeader(rh,k);}});
    Object.defineProperty(rh,'has',{value:function(k){return getHeader(rh,k)!==undefined;}});
    resp={code:c.response.code,status:c.response.status||'',responseTime:c.response.responseTime,headers:rh,
      text:function(){return c.response.body||'';},json:function(){return JSON.parse(c.response.body||'null');}};
    Object.defineProperty(resp,'to',{get:function(){return new Assertion(resp,false).to;}});
  }
  var cks=(c.cookies||[]).slice();
  function ckFind(n){for(var i=0;i<cks.length;i++)if(cks[i].name===n)return cks[i];return undefined;}
  var cookies={get:function(n){var x=ckFind(n);return x?x.value:undefined;},has:function(n){return !!ckFind(n);},
    toObject:function(){var o={};cks.forEach(function(x){o[x.name]=x.value;});return o;},
    jar:function(){return {clear:function(url,cb){__out.cookieClears.push(String(url||req.url||''));if(typeof cb==='function')cb(null);}};}};
  function scope(name,store,setB,unsetA){return {
    get:function(k){return store[k];},
    has:function(k){return Object.prototype.hasOwnProperty.call(store,k);},
    toObject:function(){return Object.assign({},store);},
    set:function(k,v){var s=typeof v==='object'&&v!==null?fmt(v):String(v);store[k]=s;setB[k]=s;ev({kind:name,op:'set',key:k,value:s});},
    unset:function(k){delete store[k];delete setB[k];unsetA.push(k);ev({kind:name,op:'unset',key:k});}};}
  function lookup(k){return (k in locals)?locals[k]:(k in iterData)?iterData[k]:(k in env)?env[k]:glob[k];}
  function AssertionError(m){this.message=m;var e=new Error(m);this.stack=e.stack;}
  AssertionError.prototype=Object.create(Error.prototype);
  AssertionError.prototype.name='AssertionError';
  AssertionError.prototype.constructor=AssertionError;
  function typeOf(v){if(v===null)return 'null';if(Array.isArray(v))return 'array';return typeof v;}
  function Assertion(v,neg,deep){this.v=v;this.neg=neg;this.dp=!!deep;}
  var P=Assertion.prototype;
  P.check=function(ok,what){if(!!ok===this.neg)throw new AssertionError('expected '+fmt(this.v)+(this.neg?' not ':' ')+what);return this;};
  ['to','be','been','is','that','which','and','has','have','with','at','of','same','does','still'].forEach(function(w){Object.defineProperty(P,w,{get:function(){return this;}});});
  Object.defineProperty(P,'not',{get:function(){return new Assertion(this.v,!this.neg,this.dp);}});
  Object.defineProperty(P,'deep',{get:function(){return new Assertion(this.v,this.neg,true);}});
  Object.defineProperty(P,'ok',{get:function(){return this.check(this.v,'to be ok');}});
  Object.defineProperty(P,'true',{get:function(){return this.check(this.v===true,'to be true');}});
  Object.defineProperty(P,'false',{get:function(){return this.check(this.v===false,'to be false');}});
  Object.defineProperty(P,'null',{get:function(){return this.check(this.v===null,'to be null');}});
  Object.defineProperty(P,'undefined',{get:function(){return this.check(this.v===undefined,'to be undefined');}});
  Object.defineProperty(P,'empty',{get:function(){var a=this.v,n=a==null?0:typeof a==='object'&&!Array.isArray(a)?Object.keys(a).length:a.length;return this.check(n===0,'to be empty');}});
  P.equal=P.equals=P.eq=function(x){return this.dp?this.eql(x):this.check(this.v===x,'to equal '+fmt(x));};
  P.eql=function(x){return this.check(fmt(this.v)===fmt(x),'to eql '+fmt(x));};
  P.above=P.gt=P.greaterThan=function(n){return this.check(this.v>n,'to be above '+fmt(n));};
  P.below=P.lt=P.lessThan=function(n){return this.check(this.v<n,'to be below '+fmt(n));};
  P.least=P.gte=function(n){return this.check(this.v>=n,'to be at least '+fmt(n));};
  P.most=P.lte=function(n){return this.check(this.v<=n,'to be at most '+fmt(n));};
  P.a=P.an=function(t){return this.check(typeOf(this.v)===String(t).toLowerCase(),'to be a '+t);};
  P.include=P.includes=P.contain=P.contains=function(x){var a=this.v,ok;
    if(typeof a==='string'||Array.isArray(a))ok=a.indexOf(x)>=0;
    else if(a&&typeof a==='object'&&x&&typeof x==='object'){ok=true;for(var k in x)if(fmt(a[k])!==fmt(x[k]))ok=false;}
    else ok=false;
    return this.check(ok,'to include '+fmt(x));};
  P.match=function(re){return this.check(re.test(String(this.v)),'to match '+String(re));};
  P.keys=function(){var ks=Array.isArray(arguments[0])?arguments[0]:Array.prototype.slice.call(arguments),a=this.v||{};
    return this.check(ks.every(function(k){return Object.prototype.hasOwnProperty.call(a,k);}),'to have keys '+fmt(ks));};
  P.property=function(k,v){var a=this.v,has=a!=null&&(typeof a==='object'||typeof a==='function')&&k in a;
    if(arguments.length<2)return this.check(has,'to have property '+fmt(k));
    return this.check(has&&a[k]===v,'to have property '+fmt(k)+' of '+fmt(v));};
  P.lengthOf=P.length=function(n){return this.check(this.v!=null&&this.v.length===n,'to have length '+n);};
  P.oneOf=function(list){return this.check(list.indexOf(this.v)>=0,'to be one of '+fmt(list));};
  P.status=function(n){var code=this.v&&this.v.code;if((code===n)===this.neg)throw new AssertionError('expected status '+n+(this.neg?' not':'')+' but got '+code);return this;};
  P.header=function(k){var h=this.v&&this.v.headers;return this.check(h&&getHeader(h,k)!==undefined,'to have header '+fmt(k));};
  P.jsonBody=function(){var ok=true;try{this.v.json();}catch(e){ok=false;}return this.check(ok,'to have a JSON body');};
  globalThis.pm={
    environment:scope('env',env,__out.envSet,__out.envUnset),
    globals:scope('glob',glob,__out.globalsSet,__out.globalsUnset),
    iterationData:{get:function(k){return iterData[k];},has:function(k){return k in iterData;},toObject:function(){return Object.assign({},iterData);}},
    variables:{get:lookup,has:function(k){return lookup(k)!==undefined;},set:function(k,v){locals[k]=String(v);},
      toObject:function(){return Object.assign({},glob,env,iterData,locals);},
      replaceIn:function(s){return String(s).replace(/\{\{([^{}]+)\}\}/g,function(m,k){var v=lookup(k.trim());return v===undefined?m:v;});}},
    request:request, response:resp, cookies:cookies,
    test:function(name,fn){var line=__line(new Error().stack),t={name:String(name),passed:true};if(line)t.line=line;
      try{fn();}catch(e){t.passed=false;t.error=__msg(e);var el=__line(e&&e.stack);if(el)t.errorLine=el;}
      __out.tests.push(t);ev({kind:'test',name:t.name,passed:t.passed});},
    expect:function(a){return new Assertion(a,false);}
  };
  pm.expect.fail=function(m){throw new AssertionError(m||'expect.fail()');};
  globalThis.__finish=function(){var k=Object.keys(reqPatch);if(k.length>1){delete reqPatch.__t;__out.requestPatch=reqPatch;}};
  globalThis.payload=c.payload;
})();
"#;

/// Wrap the user code so a thrown error is captured into `__out.error` rather
/// than aborting the whole evaluation (letting logs/tests recorded before the
/// throw survive). An interrupt (timeout) still unwinds this because it raises
/// an *uncatchable* exception. The wrapper function's return value (a top-level
/// `return X` in user code) is captured into `__out.returnValue` — Flow blocks
/// use it to pass data to the next block; `JSON.stringify` drops it when the
/// script returns nothing. The user code starts on line 2, which `__line`
/// subtracts back out.
fn wrap_user_code(code: &str) -> String {
    format!(
        ";globalThis.__out.returnValue=(function(){{try{{\n{code}\n}}catch(e){{globalThis.__out.error=__msg(e);globalThis.__out.errorLine=__line(e&&e.stack);}}}})();"
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
        // 1. Seed the context object. Validate on the Rust side for a clear
        //    error, then hand it to JS as a *string literal* through JSON.parse
        //    so context data is parsed, never evaluated as code.
        let _: serde_json::Value = serde_json::from_str(context_json)
            .map_err(|e| format!("invalid script context JSON: {e}"))?;
        let ctx_literal = serde_json::to_string(context_json)
            .map_err(|e| format!("failed to encode script context: {e}"))?;
        ctx.eval::<(), _>(format!("globalThis.__ctx = JSON.parse({ctx_literal});"))
            .catch(&ctx)
            .map_err(|e| timeout_or(&deadline, format!("failed to load script context: {e}")))?;

        // 2. Define the pm/console/__out/__finish surface.
        ctx.eval::<(), _>(PRELUDE)
            .catch(&ctx)
            .map_err(|e| timeout_or(&deadline, format!("script prelude failed: {e}")))?;

        // 3. Run the user code (its own throws are caught into __out.error;
        //    only an interrupt or a syntax error surfaces here). A syntax error
        //    becomes `__out.error` + `errorLine` too, so the editor can mark it.
        let mut options = EvalOptions::default();
        options.filename = Some(USER_FILE.to_string());
        if let Err(e) = ctx
            .eval_with_options::<(), _>(user.as_bytes(), options)
            .catch(&ctx)
        {
            if Instant::now() >= deadline {
                return Err(timeout_or(&deadline, String::new()));
            }
            let text = e.to_string();
            // Runtime throws are caught by the wrapper, so what reaches here is a
            // parse failure; rquickjs prints it as a plain `Error: …`.
            let first = text.lines().next().unwrap_or("script error").trim();
            let message = match first.strip_prefix("Error: ") {
                Some(rest) => format!("SyntaxError: {rest}"),
                None => first.to_string(),
            };
            let set = format!(
                "__out.error={};__out.errorLine=__line({});",
                serde_json::to_string(&message).map_err(|e| e.to_string())?,
                serde_json::to_string(&text).map_err(|e| e.to_string())?,
            );
            ctx.eval::<(), _>(set)
                .catch(&ctx)
                .map_err(|e| format!("failed to record script error: {e}"))?;
        }

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
    fn pm_cookies_reads_context_and_queues_jar_clears() {
        let ctx =
            r#"{"request":{"url":"https://api.a.kz/x"},"cookies":[{"name":"sid","value":"s1"}]}"#;
        let out = run(
            r#"
            pm.test('get', function(){ pm.expect(pm.cookies.get('sid')).to.equal('s1'); });
            pm.test('has', function(){ pm.expect(pm.cookies.has('nope')).to.be.false; });
            pm.test('obj', function(){ pm.expect(pm.cookies.toObject()).to.deep.equal({sid:'s1'}); });
            var called = false;
            pm.cookies.jar().clear('https://b.kz/', function(){ called = true; });
            pm.cookies.jar().clear();
            pm.test('callback', function(){ pm.expect(called).to.be.true; });
            "#,
            ctx,
        );
        assert!(
            out["tests"]
                .as_array()
                .unwrap()
                .iter()
                .all(|t| t["passed"] == true),
            "{out}"
        );
        assert_eq!(
            out["cookieClears"],
            serde_json::json!(["https://b.kz/", "https://api.a.kz/x"])
        );
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
    fn return_value_is_captured() {
        let out = run("return 41 + 1;", "{}");
        assert_eq!(out["returnValue"], 42);
    }

    #[test]
    fn no_return_leaves_return_value_absent() {
        let out = run("console.log('hi');", "{}");
        assert!(out.get("returnValue").is_none() || out["returnValue"].is_null());
        assert_eq!(out["logs"][0], "hi");
    }

    #[test]
    fn payload_is_exposed_to_flow_scripts() {
        let ctx = r#"{"payload":{"status":200,"body":{"token":"abc"}}}"#;
        let out = run("return payload.body.token;", ctx);
        assert_eq!(out["returnValue"], "abc");
        assert!(out["error"].is_null());
    }

    #[test]
    fn tests_and_failed_assertions_carry_user_lines() {
        let code = "pm.test('a', function () {\n  pm.expect(1).to.equal(1);\n});\npm.test('b', function () {\n  var x = 2;\n  pm.expect(x).to.equal(3);\n});";
        let out = run(code, "{}");
        let tests = out["tests"].as_array().unwrap();
        assert_eq!(tests[0]["line"], 1);
        assert!(tests[0].get("errorLine").is_none());
        assert_eq!(tests[1]["line"], 4);
        assert_eq!(tests[1]["errorLine"], 6);
        assert_eq!(tests[1]["error"], "AssertionError: expected 2 to equal 3");
    }

    #[test]
    fn runtime_error_reports_name_and_line() {
        let out = run(
            "const ts = 1;\n\npm.request.headers.add('X', sign(ts));",
            "{}",
        );
        assert_eq!(out["error"], "ReferenceError: sign is not defined");
        assert_eq!(out["errorLine"], 3);
    }

    #[test]
    fn syntax_error_is_captured_with_its_line() {
        let out = run("const a = 1;\nconst b = ;\n", "{}");
        assert!(
            out["error"].as_str().unwrap().contains("SyntaxError"),
            "{out}"
        );
        assert_eq!(out["errorLine"], 2);
    }

    #[test]
    fn chai_style_matchers() {
        let ctx = r#"{"response":{"code":200,"body":"{\"items\":[1],\"next\":\"n\",\"total\":1}","responseTime":340,"headers":{"Content-Type":"application/json"}}}"#;
        let code = r#"
            var d = pm.response.json();
            pm.test('keys', function(){ pm.expect(d).to.have.keys('items', 'next', 'total'); });
            pm.test('array', function(){ pm.expect(d.items).to.be.an('array'); });
            pm.test('match', function(){ pm.expect('pay_1').to.match(/^pay_/); });
            pm.test('true', function(){ pm.expect(true).to.be.true; });
            pm.test('not', function(){ pm.expect(1).to.not.equal(2); });
            pm.test('include', function(){ pm.expect('abc').to.include('b'); });
            pm.test('property', function(){ pm.expect(d).to.have.property('next', 'n'); });
            pm.test('header', function(){ pm.expect(pm.response.headers.get('content-type')).to.equal('application/json'); });
            pm.test('status', function(){ pm.response.to.have.status(200); });
            pm.test('a', function(){ pm.expect('x').to.be.a('string'); });
            pm.test('deep', function(){ pm.expect({a:[1]}).to.deep.equal({a:[1]}); });
            pm.test('below', function(){ pm.expect(pm.response.responseTime).to.be.below(200); });
        "#;
        let out = run(code, ctx);
        let tests = out["tests"].as_array().unwrap();
        for t in &tests[..11] {
            assert_eq!(t["passed"], true, "{t}");
        }
        assert_eq!(
            tests[11]["error"],
            "AssertionError: expected 340 to be below 200"
        );
    }

    #[test]
    fn events_record_logs_vars_and_headers_in_order() {
        let ctx = r#"{"request":{"method":"GET","url":"u","headers":{}}}"#;
        let code = "console.log('ts', 1); pm.environment.set('ts', 1); pm.request.headers.add('X-Ts', 1); pm.globals.unset('g');";
        let out = run(code, ctx);
        let kinds: Vec<&str> = out["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["log", "env", "hdr", "glob"]);
        assert_eq!(out["events"][0]["text"], "ts 1");
        assert_eq!(out["events"][1]["value"], "1");
        assert!(out["events"][0]["t"].as_f64().unwrap() > 0.0);
    }

    #[test]
    fn header_upsert_replaces_any_case() {
        let ctx = r#"{"request":{"method":"GET","url":"u","headers":{"Content-Type":"a"}}}"#;
        let out = run("pm.request.headers.upsert('content-type', 'b');", ctx);
        assert_eq!(
            out["requestPatch"]["headers"],
            serde_json::json!({"content-type": "b"})
        );
    }

    #[test]
    fn scopes_have_has_and_to_object() {
        let ctx = r#"{"environment":{"a":"1"}}"#;
        let code = "return [pm.environment.has('a'), pm.environment.has('b'), pm.environment.toObject().a, pm.variables.replaceIn('x{{a}}y')];";
        let out = run(code, ctx);
        assert_eq!(
            out["returnValue"],
            serde_json::json!([true, false, "1", "x1y"])
        );
    }

    #[test]
    fn grpc_url_is_read_only() {
        let ctx = r#"{"request":{"method":"m","url":"host:443","headers":{},"readonlyUrl":true}}"#;
        let out = run("pm.request.url = 'other';", ctx);
        assert!(out["error"].as_str().unwrap().contains("read-only"));
        assert!(out["requestPatch"].is_null());
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
