






const Q = new URLSearchParams(location.search);
window.isTauri = true; // native-macOS header inset, like the real window
try { localStorage.setItem('bonk.theme', Q.get('theme') || 'smooth-dark'); localStorage.setItem('bonk.theme.version', '4'); } catch {}
const req = (method, url, extra = {}) => ({ method, url, headers: {}, bodyMode: 'none', ...extra });
const r = (id, name, method, path, extra = {}) => ({ kind: 'request', id: 'fs:' + id, name, protocol: 'http', request: req(method, '{{baseUrl}}' + path, extra) });
const g = (id, name, method) => ({ kind: 'request', id: 'fs:' + id, name, protocol: 'grpc', request: req('POST', ''), grpc: GRPC(method) });
const GRPC = (method) => ({
  endpoint: '{{grpcHost}}:443', plaintext: false, source: 'reflection', method: 'helloworld.Greeter.' + method,
  message: '{\n  "name": "Aru"\n}', metadata: { authorization: 'Bearer {{token}}' },
});

const LONG = [['limit', '50', 'Number of payments to return'], ['status', 'captured', 'pending · captured · refunded'], ['currency', 'KZT', 'ISO 4217'], ['created_from', '2026-09-01T00:00:00Z', 'Period start, ISO 8601'], ['created_to', '2026-09-30T23:59:59Z', 'Period end, ISO 8601'], ['customer_id', 'cus_8f2k1', ''], ['sort', '-created_at', ''], ['expand', 'customer,refunds', ''], ['cursor', 'eyJpZCI6InBheV84ZjJrMSJ9', '']];
const LIST_URL = Q.get('long') ? '/v1/payments?' + LONG.map(([k, v]) => `${k}=${v}`).join('&') : '/v1/payments?limit=20&status=captured';
const LIST_HEADERS = { Accept: 'application/json', 'X-Request-Id': '{{$uuid}}', 'X-Client': 'bonk/3.0' };
const LIST_NOTES = { Accept: 'Response format', 'X-Request-Id': 'Unique for each request', 'X-Client': 'Client identifier' };
const LIST_PARAMS = [
  { key: 'limit', value: '20', description: 'Number of payments to return', enabled: true },
  { key: 'status', value: 'captured', description: 'pending · captured · refunded', enabled: true },
];
const CREATE_BODY = '{\n  "amount": 12900,\n  "currency": "KZT",\n  "customer": {\n    "email": "aru@example.com"\n  },\n  "capture": true\n}';

const BIG = Array.from({ length: 100 }, (_, f) => ({
  kind: 'folder', id: `fs:svc${f}`, name: `Service ${f}`, expanded: true,
  children: Array.from({ length: 100 }, (_, i) => r(`svc${f}/req${i}`, `Request ${f}.${i}`, 'GET', `/v1/svc${f}/${i}`)),
}));
const tree = Q.get('empty') ? [] : Q.get('big') ? BIG : [
  { kind: 'folder', id: 'fs:payments', name: 'Payments API', expanded: true, auth: { type: 'bearer', bearerToken: '{{token}}' }, children: [
      { ...r('payments/list', 'List payments', 'GET', LIST_URL, { headers: LIST_HEADERS, headerNotes: LIST_NOTES, auth: { type: 'inherit' } }), params: LIST_PARAMS },
      r('payments/get', 'Get payment', 'GET', '/v1/payments/{{paymentId}}'),
      r('payments/create', 'Create payment', 'POST', '/v1/payments', { bodyMode: 'raw', rawBodyFormat: 'JSON', body: CREATE_BODY, headers: LIST_HEADERS }),
      r('payments/update', 'Update payment', 'PATCH', '/v1/payments/{{paymentId}}'),
      r('payments/refund', 'Refund payment', 'DELETE', '/v1/payments/pay_8f2k1/refund'),
    ] },
  { kind: 'folder', id: 'fs:auth', name: 'Auth', expanded: true, children: [
      r('auth/issue', 'Issue token', 'POST', '/v1/tokens'),
      r('auth/refresh', 'Refresh token', 'POST', '/v1/tokens/refresh'),
      r('auth/revoke', 'Revoke token', 'DELETE', '/v1/tokens/tok_1'),
    ] },
  { kind: 'folder', id: 'fs:greeter', name: 'Greeter (gRPC)', expanded: false, children: [
      g('greeter/hello', 'SayHello', 'SayHello'),
      g('greeter/stream', 'SayHelloStream', 'SayHelloStream'),
      ...(Q.get('grpc') === 'streams' ? [g('greeter/collect', 'CollectNames', 'CollectNames'), g('greeter/chat', 'Chat', 'Chat')] : []),
    ] },
  { kind: 'folder', id: 'fs:webhooks', name: 'Webhooks', expanded: false, children: [
      r('webhooks/list', 'List webhooks', 'GET', '/v1/webhooks'),
      r('webhooks/create', 'Register webhook', 'POST', '/v1/webhooks'),
      r('webhooks/test', 'Send test event', 'POST', '/v1/webhooks/{{webhookId}}/test'),
      r('webhooks/delete', 'Delete webhook', 'DELETE', '/v1/webhooks/{{webhookId}}'),
    ] },
];

const BODY = '{\n  "id": "pay_8f2k1",\n  "amount": 12900,\n  "currency": "KZT",\n  "status": "captured",\n  "customer": {\n    "email": "aru@example.com"\n  },\n  "refundable": true\n}';
const HEADERS = {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-request-id': 'req_01JQ8ZK4M2',
  'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4998', 'x-ratelimit-reset': '1759935600', server: 'fp-edge/2.3.1',
  date: 'Thu, 08 Oct 2026 14:02:11 GMT', 'content-length': '2458', connection: 'keep-alive', vary: 'Accept-Encoding',
  'strict-transport-security': 'max-age=31536000', 'x-content-type-options': 'nosniff', etag: 'W/"99a-1f4c"',
};
const RESP = { status: 200, headers: HEADERS, body: BODY, final_url: 'https://api.dummypay.dev' + LIST_URL, elapsed_ms: 128, size_bytes: 2458 };
const ERR401 = { ...RESP, status: 401, elapsed_ms: 64, size_bytes: 112, body: '{\n  "error": {\n    "code": "unauthorized",\n    "message": "Invalid or expired access token",\n    "docs": "https://docs.bonk.dev/errors/401"\n  }\n}' };
const ERR500 = { ...RESP, status: 500, elapsed_ms: 1840, size_bytes: 96, headers: { ...HEADERS, 'x-request-id': 'req_7Hc2x9' }, body: '{\n  "error": {\n    "code": "internal_error",\n    "message": "Unexpected error while listing payments",\n    "request_id": "req_7Hc2x9"\n  }\n}' };
const TIMEOUT = { status: 0, headers: {}, body: 'request timed out after 30000 ms', final_url: '', elapsed_ms: 30000, size_bytes: 0 };
const CREATED = { ...RESP, status: 201, elapsed_ms: 212, size_bytes: 318, body: '{\n  "id": "pay_9a1c3",\n  "status": "pending",\n  "amount": 12900,\n  "currency": "KZT",\n  "created_at": "2026-10-08T14:02:11Z"\n}' };
const HTTP = { '401': ERR401, '500': ERR500, timeout: TIMEOUT };

const svc = (name, methods) => ({
  name,
  methods: methods.map(([m, cs, ss, inp, out]) => ({ name: m, symbol: `${name}.${m}`, clientStreaming: !!cs, serverStreaming: !!ss, inputType: inp ?? `${name.split('.').slice(0, -1).join('.')}.${m}Request`, outputType: out ?? `${name.split('.').slice(0, -1).join('.')}.${m}Reply`, inputFields: inp === 'helloworld.HelloRequest' ? 4 : 1, inputSchema: inp === 'helloworld.HelloRequest' ? HELLO_SCHEMA : [] })),
});
const HELLO_SCHEMA = [
  { name: 'name', protoName: 'name', typeLabel: 'string', json: 'string', doc: 'Name to greet' },
  { name: 'locale', protoName: 'locale', typeLabel: 'string', json: 'string', doc: 'Reply language, e.g. "en"' },
  { name: 'greetingType', protoName: 'greeting_type', typeLabel: 'enum Greeting', json: 'enum', doc: '', enumValues: ['FORMAL', 'CASUAL'] },
  { name: 'tags', protoName: 'tags', typeLabel: 'repeated string', json: 'array', doc: 'Tags' },
];
const SVC = { services: [
  svc('helloworld.Greeter', [['SayHello', 0, 0, 'helloworld.HelloRequest', 'helloworld.HelloReply'], ['SayHelloStream', 0, 1, 'helloworld.HelloRequest', 'helloworld.HelloReply'], ...(Q.get('grpc') === 'streams' ? [['CollectNames', 1, 0, 'helloworld.HelloRequest', 'helloworld.HelloReply'], ['Chat', 1, 1, 'helloworld.ChatMessage', 'helloworld.ChatMessage']] : [])]),
  svc('payments.v1.PaymentService', [['CreatePayment'], ['GetPayment'], ['ListPayments'], ['WatchPayments', 0, 1]]),
  svc('grpc.health.v1.Health', [['Check'], ['Watch', 0, 1]]),
] };
const STREAMS = {};
const GRPC_BODY = '{\n  "message": "Hello, Aru"\n}';

const ENV = (id, name, extra = {}) => ({ id: 'env-' + id, name, vars: [], ...extra });
const STATE = { uiLanguage: 'en', requestLayout: 'side',
  ...(Q.get('lang') && { uiLanguage: Q.get('lang') }), // ?lang=en
  ...(Q.get('layout') && { requestLayout: Q.get('layout') }), // ?layout=side|focus
  workspacePath: '/Users/aru/work/Dummy Payments',
  recentWorkspacePaths: ['/Users/aru/work/Dummy Payments', '/Users/aru/work/Local development'],
  activeTabId: 'tab-list',
  tabs: Q.get('notabs') || Q.get('empty') ? [] : [
    {
      id: 'tab-list', protocol: 'http', title: 'List payments', manualTitle: true, savedPath: 'fs:payments/list',
      request: { method: 'GET', url: '{{baseUrl}}' + LIST_URL, headers: LIST_HEADERS, headerNotes: LIST_NOTES, bodyMode: 'none', auth: { type: 'inherit' } },
      params: Q.get('long') ? LONG.map(([key, value, description]) => ({ key, value, description, enabled: true })) : LIST_PARAMS.map((p) => ({ ...p })),
      response: HTTP[Q.get('http')] ?? RESP,
    },
    {
      id: 'tab-create', protocol: 'http', title: 'Create payment', manualTitle: true, savedPath: 'fs:payments/create',
      request: { method: 'POST', url: '{{baseUrl}}/v1/payments', headers: LIST_HEADERS, bodyMode: 'raw', rawBodyFormat: 'JSON', body: CREATE_BODY.replace('12900', '15000'), auth: { type: 'bearer', bearerToken: '{{token}}' } },
      params: [],
      response: CREATED,
    },
    { id: 'tab-env', protocol: 'env', title: 'Environments', request: req('GET', '') },
  ],
  environments: [
    ENV('prod', 'Production', { protected: true, color: 'red', vars: [
      { key: 'baseUrl', value: 'https://api.dummypay.dev', enabled: true },
      { key: 'grpcHost', value: 'grpc.dummypay.dev', enabled: true },
      { key: 'token', value: 'demo-token-not-a-credential', enabled: true, secret: true },
      { key: 'merchantId', value: 'mrc_7731', enabled: true },
      { key: 'paymentId', value: 'pay_8f2k1', enabled: true },
    ] }),
    ENV('preprod', 'Preprod', { protected: true, color: 'red' }),
    ENV('eu-prod', 'EU · Production', { protected: true, color: 'red' }),
    ENV('staging', 'Staging', { color: 'amber', vars: [{ key: 'baseUrl', value: 'https://staging.api.dummypay.dev', enabled: true }, { key: 'grpcHost', value: 'grpc.staging.dummypay.dev', enabled: true }, { key: 'token', value: 'demo-staging-token', enabled: true, secret: true }] }),
    ENV('eu-staging', 'EU · Staging', { color: 'amber' }),
    ENV('dev', 'Dev', { color: 'green' }),
    ENV('local', 'Local', { color: 'green', vars: [{ key: 'baseUrl', value: 'http://localhost:8080', enabled: true }, { key: 'grpcHost', value: 'localhost', enabled: true }] }),
    ENV('qa', 'QA', { color: 'gray' }),
    ENV('sandbox', 'Sandbox', { color: 'gray' }),
    ENV('demo', 'Demo', { color: 'gray' }),
    ENV('checkout', 'Feature · checkout-v2', { color: 'gray' }),
    ENV('payouts', 'Feature · payouts', { color: 'gray' }),
    ENV('perf', 'Perf', { color: 'gray' }),
    ENV('mock', 'Mock', { color: 'gray' }),
  ],
  activeEnvironmentId: Q.get('empty') ? null : 'env-prod',
  globals: [{ key: 'apiVersion', value: '2026-10-01', enabled: true }],
  history: Q.get('empty') ? [] : [
    { id: 'h1', protocol: 'http', request: { method: 'GET', url: 'https://api.dummypay.dev/v1/payments', headers: {} }, status: 200, ok: true, at: Date.now() - 2 * 60e3, envName: 'Production', savedPath: 'fs:payments/list', title: 'List payments', raw: { method: 'GET', url: '{{baseUrl}}' + LIST_URL, headers: LIST_HEADERS, headerNotes: LIST_NOTES, bodyMode: 'none', auth: { type: 'inherit' } }, params: LIST_PARAMS },
    { id: 'h2', protocol: 'http', request: { method: 'POST', url: 'https://api.dummypay.dev/v1/payments', headers: {} }, status: 201, ok: true, at: Date.now() - 62 * 60e3, envName: 'Production', savedPath: 'fs:payments/create', title: 'Create payment' },
    { id: 'h3', protocol: 'http', request: { method: 'GET', url: 'https://api.dummypay.dev/v1/payments', headers: {} }, status: 401, ok: false, at: Date.now() - 24 * 60e3, envName: 'Production' },
    { id: 'h4', protocol: 'http', request: { method: 'DELETE', url: 'https://api.dummypay.dev/v1/tokens/tok_1', headers: {} }, status: 204, ok: true, at: Date.now() - 20 * 3600e3, envName: 'Production', savedPath: 'fs:auth/revoke', title: 'Revoke token' },
    { id: 'h5', protocol: 'grpc', request: { method: 'GRPC', url: 'grpc.dummypay.dev:443 helloworld.Greeter.SayHello', headers: {} }, status: 0, ok: true, at: Date.now() - 21 * 3600e3, envName: 'Production', grpc: GRPC('SayHello'), savedPath: 'fs:greeter/hello', title: 'SayHello' },
    { id: 'h6', protocol: 'http', request: { method: 'GET', url: 'https://api.dummypay.dev/v1/payments/pay_8f2k1', headers: {} }, status: 404, ok: false, at: Date.now() - 21 * 3600e3, envName: 'Production' },
    { id: 'h7', protocol: 'http', request: { method: 'POST', url: 'https://api.dummypay.dev/oauth/token', headers: {} }, status: 500, ok: false, at: Date.now() - 22 * 3600e3, envName: 'Production' },
  ],
};

const DYN = {
  $timestamp: '1760166251', $isoTimestamp: '2026-10-11T07:04:11.204Z', $guid: '3f1e8a52-7c0d-4b8e-9a1f-2d6c0b7e91aa',
  $uuid: '3f1e8a52-7c0d-4b8e-9a1f-2d6c0b7e91aa', $randomUUID: '9b2d1c70-41e5-4f0a-8c3e-5d7a2b1f6e90', $randomInt: '412', $randomEmail: 'aigerim.kasymova@example.com',
  $randomFullName: 'Maya Collins', $randomFirstName: 'Leo', $randomLastName: 'Harper', $randomUserName: 'asel.b92',
  $randomPhoneNumber: '+7 701 555 12 34', $randomJobTitle: 'Financial analyst', $randomCompanyName: 'Northwind Trading',
  $randomAvatarImage: 'https://i.pravatar.cc/150?img=12', $randomNamePrefix: 'Ms.', $randomCity: 'Lisbon',
};

const fill = (s, scope, used) => s?.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => {
  if (!k.startsWith('$')) return scope?.[k] ?? m;
  if (!(k in DYN)) return m;
  if (used && !used.some((u) => u.name === k)) used.push({ name: k, value: DYN[k] });
  return DYN[k];
});
const resolveReq = (q, scope, used) => ({
  ...q, url: fill(q.url, scope, used), body: fill(q.body, scope, used),
  headers: Object.fromEntries(Object.entries(q.headers ?? {}).map(([k, v]) => [k, fill(v, scope, used)])),
});

const channel = (ch) => { let i = 0; return (message) => window['_' + ch.id]({ index: i++, message }); };

const KEYCHAIN = new Map();
const H = {
  workspace_pick_folder: () => '/Users/aru/work/Dummy Payments',
  workspace_load: () => tree,
  workspace_load_children: (a) => {
    const find = (nodes) => nodes.flatMap((n) => (n.id === 'fs:' + a.dir ? [n] : n.kind === 'folder' ? find(n.children) : []));
    const kids = a.dir ? (find(tree)[0]?.children ?? []) : tree;
    return kids.map((n) => (n.kind === 'folder' && a.keep.includes(n.id) ? { ...n, children: [] } : n));
  },
  workspace_save_request: (a) => a.path || 'fs:payments/' + String(a.node?.name ?? 'new').toLowerCase().replace(/\W+/g, '-'),
  workspace_create_folder: () => 'fs:newfolder',
  workspace_delete: () => null,
  workspace_rename: () => null,
  app_state_load: () => STATE,
  app_state_save: () => null,
  secret_get: (a) => KEYCHAIN.get(a.key) ?? null,
  secret_set: (a) => { KEYCHAIN.set(a.key, a.value); return null; },
  secret_delete: (a) => { KEYCHAIN.delete(a.key); return null; },
  app_state_set: (a) => { if (a && a.key !== undefined) STATE[a.key] = a.value; return null; },
  mcp_journal: () => [],
  app_data_dir: () => '/Users/aru/Library/Application Support/bonk',

  themes_list: () => [],
  theme_save: ({ slug }) => `/Users/aru/.bonk/themes/${slug}.json`,
  theme_delete: () => null,
  theme_import_pick: () => {
    const style = (bg, panel, text, muted, accent) => ({
      background: bg, 'editor.background': panel, 'elevated_surface.background': panel, text, 'text.muted': muted,
      'text.accent': accent, border: '#403d52', created: '#31748f', error: '#eb6f92', warning: '#f6c177',
      'terminal.ansi.blue': '#9ccfd8', 'terminal.ansi.green': '#31748f', 'terminal.ansi.red': '#eb6f92',
      syntax: { property: { color: '#9ccfd8' }, string: { color: '#f6c177' } },
    });
    const text = JSON.stringify({ name: 'Rosé Pine', themes: [
      { name: 'Rosé Pine', appearance: 'dark', style: style('#191724', '#1f1d2e', '#e0def4', '#6e6a86', '#c4a7e7') },
      { name: 'Rosé Pine Dawn', appearance: 'light', style: style('#faf4ed', '#fffaf3', '#575279', '#9893a5', '#907aa9') },
    ] });
    return { name: 'rose-pine.json', path: '/Users/aru/Downloads/rose-pine.json', size: text.length, text };
  },
  'plugin:app|version': () => '0.2.0',
  'plugin:window|is_fullscreen': () => false,

  http_prepare: (a) => a.req,
  http_resolve: (a) => { const used = []; return { request: resolveReq(a.req, a.scope, used), dynamic: used }; },
  dynamic_samples: () => DYN,
  http_send: (a) => {
    const mode = Q.get('http');
    const resp = a?.req?.method === 'POST' ? CREATED : HTTP[mode] ?? RESP;
    const wait = mode === 'slow' ? 60_000 : 300;
    return new Promise((res) => setTimeout(() => res(resp), wait));
  },
  cancel_request: (a) => (STREAMS[a.requestId]?.res({ ok: false, status: 'CANCELLED', body: 'cancelled by user', elapsed_ms: 0, size_bytes: 0 }), null),
  terminal_default_cwd: () => '/Users/aru',
  terminal_run: (a) => {
    const emit = channel(a.onLine);
    for (const text of ['bonk 0.1.7', 'workspace: /Users/ada/dev/bonk-collections', '3 collections · 12 requests · 1 grpc'])
      emit({ stderr: false, text });
    return { status: 0, elapsedMs: 38, cwd: '/Users/ada/dev/bonk-collections' };
  },
  mcp_integration_status: () => ({
    binaryAvailable: true,
    installedBinary: '/usr/local/bin/bonk-mcp',
    clients: [
      { id: 'claude', name: 'Claude Desktop', available: true, installed: true, needsUpdate: false, workspace: '/Users/ada/dev/bonk-collections', detail: 'Connected', error: null },
      { id: 'cursor', name: 'Cursor', available: true, installed: false, needsUpdate: false, workspace: null, detail: 'Not installed', error: null },
      { id: 'vscode', name: 'VS Code', available: false, installed: false, needsUpdate: false, workspace: null, detail: 'Not detected', error: null },
    ],
  }),
  grpc_connect: (a) => {
    if (a.endpoint.includes('down') || Q.get('grpc') === 'down') throw { code: 'UNAVAILABLE', message: 'connect failed: tcp connect error: Connection refused (os error 61)' };
    return 'conn_1';
  },
  grpc_tls_inspect: (a) => a.tls?.insecure
    ? { verified: false, error: 'invalid peer certificate: UnknownIssuer', subject: 'localhost', issuer: 'mkcert dev CA', notAfter: 1799712000 }
    : { verified: true, error: null, subject: '*.bonk.dev', issuer: "Let's Encrypt R11", notAfter: 1799712000 },
  grpc_proto_inspect: (a) => ({
    importPaths: a.importPaths,
    files: a.paths.map((path) => path.includes('money')
      ? { path, name: path.split('/').slice(-2).join('/'), ok: false, error: { kind: 'missing_import', message: 'import "google/type/money.proto" not found', import: 'google/type/money.proto' }, services: [], wellKnownDeps: [] }
      : { path, name: path.split('/').pop(), ok: true, error: null, services: [{ name: 'bonk.echo.EchoService', methods: [{ name: 'Ping', kind: 'unary' }, { name: 'Stream', kind: 'server_stream' }] }], wellKnownDeps: ['google/protobuf/timestamp.proto'] }),
  }),
  proto_read: () => 'syntax = "proto3";\npackage bonk.echo;\n\nservice EchoService {\n  rpc Ping (PingRequest) returns (PingReply);\n  rpc Stream (PingRequest) returns (stream PingReply);\n}\nmessage PingRequest { string message = 1; int32 count = 2; }\n',
  file_pick: () => '/Users/ada/dev/certs/client.pem',
  grpc_reflect: () => SVC,
  grpc_load_proto: () => SVC,
  grpc_prepare: (a) => ({ message: a.message?.trim() || '{}', metadata: a.metadata ?? {} }),
  grpc_template: () => '{\n  "name": "Aru",\n  "locale": "ru"\n}',
  grpc_call: (a) => {
    if (a.jsonBody.includes('""') || Q.get('grpc') === 'invalid') return { ok: false, status: 'INVALID_ARGUMENT', body: 'name must not be empty', elapsed_ms: 8, size_bytes: 0, metadata: { 'content-type': 'application/grpc', 'x-request-id': 'req_9c1' }, trailers: { 'grpc-status': '3', 'grpc-message': 'name must not be empty', 'x-trace': 'tr_1' }, details: [{ typeName: 'google.rpc.BadRequest', fieldViolations: [{ field: 'name', description: 'must not be empty' }] }] };
    return { ok: true, status: 'OK', body: GRPC_BODY, elapsed_ms: 42, size_bytes: 18, metadata: { 'content-type': 'application/grpc', 'x-envoy-upstream-service-time': '38' }, trailers: { 'grpc-status': '0' } };
    const body = '{\n  "message": "pong",\n  "servedBy": "edge-3",\n  "latencyMs": 12,\n  "receivedAt": "2025-08-21T15:20:11Z"\n}';
    return { ok: true, status: 'OK', body, elapsed_ms: 24, size_bytes: body.length };
  },
  grpc_stream: (a) => {
    const cb = window['_' + a.onMessage.id];

    if (/CollectNames|Chat$/.test(a.method)) return new Promise((res) => {
      const t0 = Date.now(), bidi = a.method.endsWith('Chat'), names = [];
      let n = 0;
      const reply = (body) => cb({ index: n, message: { index: ++n, atMs: Date.now(), body, sizeBytes: body.length + 4 } });
      const take = (json) => { for (const m of [].concat(JSON.parse(json))) { names.push(m.name ?? m.text); if (bidi) setTimeout(() => reply(JSON.stringify({ from: 'bot', text: `echo: ${m.name ?? m.text}` })), 150); } };
      take(a.jsonBody);
      STREAMS[a.requestId] = { take, res, end: () => {
        if (!bidi) setTimeout(() => reply(JSON.stringify({ message: `Hello, ${names.join(', ')}`, count: names.length })), 400);
        setTimeout(() => res({ ok: true, status: 'OK', body: '', elapsed_ms: Date.now() - t0, size_bytes: 98, metadata: { 'content-type': 'application/grpc' }, trailers: { 'grpc-status': '0' } }), 700);
      } };
    });
    const fail = Q.get('grpc') === 'streamerr';
    const ends = Q.get('grpc') === 'stream12';
    return new Promise((res) => {
      let i = 0;
      const tick = () => {
        i += 1;
        cb({ index: i - 1, message: { index: i, atMs: Date.now(), body: `{"message":"Hello, Aru (${i}/∞)"}`, sizeBytes: 24 } });
        if (fail && i === 3) return setTimeout(() => res({ ok: false, status: 'INTERNAL', body: 'stream reset by server (RST_STREAM)', elapsed_ms: 3400, size_bytes: 72, metadata: {} }), 1000);
        if (ends && i === 12) return res({ ok: true, status: 'OK', body: '', elapsed_ms: 12000, size_bytes: 576, metadata: {}, trailers: { 'grpc-status': '0' } });
        if (i < 4 || !fail) setTimeout(tick, ends ? 100 : 1000);
      };
      setTimeout(tick, 200);
    });
  },
  grpc_stream_send: (a) => (STREAMS[a.requestId]?.take(a.jsonBody), 1),
  grpc_stream_end: (a) => STREAMS[a.requestId]?.end(),
  proto_pick: () => ['/Users/aru/work/payments/protos/echo.proto', '/Users/aru/work/payments/protos/common/money.proto'],
  run_script: () => JSON.stringify({
    logs: [{ level: 'log', args: ['status', 200] }],
    tests: [{ name: 'status is 200', passed: true }, { name: 'body has data', passed: true }],
    vars: {}, error: null,
  }),
};

H.request_run = async (a) => {
  const node = a.node, isGrpc = node.protocol === 'grpc';
  const scope = { ...a.vars.globals, ...a.vars.environment };
  const used = [];
  const request = resolveReq(node.request, scope, used);
  const config = isGrpc ? node.grpc : request;
  const pre = config.preRequestScript?.trim() ? JSON.parse(H.run_script()) : null;
  const response = isGrpc ? null : await H.http_send({ req: request });
  const grpcResult = isGrpc ? await H.grpc_call({ jsonBody: node.grpc.message, method: node.grpc.method }) : null;
  const post = config.testScript?.trim() ? JSON.parse(H.run_script()) : null;
  const ok = isGrpc ? grpcResult.ok : response.status >= 200 && response.status < 400;
  const row = { id: 'editor-row', iteration: 1, requestName: node.name, protocol: node.protocol,
    method: isGrpc ? 'gRPC' : request.method, target: isGrpc ? node.grpc.endpoint : request.url,
    status: isGrpc ? grpcResult.status : response.status, ok, elapsedMs: isGrpc ? grpcResult.elapsed_ms : response.elapsed_ms,
    tests: [...(pre?.tests ?? []), ...(post?.tests ?? [])], logs: [], nodeId: node.id };
  return { row, details: { request: isGrpc ? null : request, response, grpcResult, pre, post, postMs: post ? 0 : null, oauth: null, dynamic: used } };
};
const SCENARIOS = [];
H.scenarios_load = () => SCENARIOS;
H.scenarios_save = (a) => { const at = SCENARIOS.findIndex((s) => s.name === a.scenario.name); if (at < 0) SCENARIOS.push(a.scenario); else SCENARIOS[at] = a.scenario; return null; };
H.scenarios_delete = (a) => { const at = SCENARIOS.findIndex((s) => s.name === a.name); if (at >= 0) SCENARIOS.splice(at, 1); return null; };
H.workspace_import_collection = () => 'fs:newfolder';



{
  const H_ = 3600e3;
  const ck = (domain, name, value, o = {}) => ({
    name, value, domain, hostOnly: o.hostOnly ?? true, path: o.path ?? '/', expiresMs: o.exp ?? null,
    expired: o.expired ?? false, httpOnly: !!o.httpOnly, secure: !!o.secure, sameSite: o.sameSite ?? null,
    raw: `${name}=${value}; Path=${o.path ?? '/'}`,
  });
  let jar = !Q.get('cookies') ? [] : [
    ck('api.dummypay.dev', 'session_id', 's%3Aa91f02c4e7b85d3a7c2e.Kx0Qp9L2', { httpOnly: true, secure: true, sameSite: 'Lax' }),
    ck('api.dummypay.dev', 'csrf_token', '9f2c41d0b7e84a3c', { exp: Date.now() + 2 * H_, secure: true, sameSite: 'Strict' }),
    ck('api.dummypay.dev', '__cf_bm', 'jR8.aXq2f0Q-1760', { exp: Date.now() + 0.47 * H_, httpOnly: true, secure: true, sameSite: 'None' }),
    ck('api.dummypay.dev', 'locale', 'ru-KZ', { exp: Date.now() + 366 * 24 * H_ }),
    ck('api.dummypay.dev', 'merchant', 'mrc_7731', { path: '/v1', exp: Date.now() + 30 * 24 * H_, secure: true }),
    ck('api.dummypay.dev', 'ab_test', 'checkout_v2', { exp: Date.now() - H_, expired: true }),
    ck('dummypay.dev', 'device', 'd_81aa', { hostOnly: false, exp: Date.now() + 90 * 24 * H_ }),
    ck('localhost', 'dev_session', 'local-1', {}),
  ];
  const sort = () => jar.sort((a, b) => (a.domain + a.path + a.name).localeCompare(b.domain + b.path + b.name));
  sort();
  Object.assign(H, {
    cookies_list: () => jar.map((c) => ({ ...c })),
    cookies_keep_session: () => null,
    cookies_jar_path: () => '/Users/aru/Library/Application Support/bonk/cookies/dummy-payments-1a2b3c4d.json',
    cookies_add: (a) => {
      const [pair, ...attrs] = a.setCookie.split(';').map((x) => x.trim());
      const [name, ...v] = pair.split('=');
      const attr = (k) => attrs.find((x) => x.toLowerCase().startsWith(k + '='))?.split('=').slice(1).join('=');
      const has = (k) => attrs.some((x) => x.toLowerCase() === k);
      const host = new URL(a.url).hostname;
      const dom = attr('domain')?.replace(/^\./, '');
      const exp = attr('expires') ? Date.parse(attr('expires')) : null;
      const c = ck(dom ?? host, name, v.join('='), { hostOnly: !dom, path: attr('path') ?? '/', exp, httpOnly: has('httponly'), secure: has('secure'), sameSite: attr('samesite') ?? null });
      c.raw = a.setCookie;
      jar = jar.filter((x) => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
      jar.push(c);
      sort();
      return null;
    },
    cookies_remove: (a) => { const n = jar.length; jar = jar.filter((x) => !(x.name === a.name && x.domain === a.domain && x.path === a.path)); return jar.length < n; },
    cookies_clear: (a) => { jar = a.domain == null ? [] : jar.filter((x) => x.domain !== a.domain); return null; },
  });
  if (Q.get('cookies')) {
    const rc = (c, change) => ({ ...c, change });
    RESP.cookies = [
      rc(ck('dummypay.dev', 'session_id', 's%3Aa91f…7c2e.Kx0', { hostOnly: false, httpOnly: true, secure: true }), 'updated'),
      rc(ck('api.dummypay.dev', 'csrf_token', '9f2c41d0b7e84a3c', { exp: Date.now() + 2 * H_ }), 'new'),
      rc(ck('api.dummypay.dev', 'ab_test', 'deleted', { exp: Date.now() - 1, expired: true }), 'deleted'),
    ];
    RESP.jar_sends = 5;
    RESP.headers = { ...RESP.headers, 'set-cookie': 'session_id=s%3Aa91f; Domain=dummypay.dev; Path=/; HttpOnly; Secure, csrf_token=9f2c41d0b7e84a3c; Max-Age=7200, ab_test=deleted; Max-Age=0' };
  }
}

const OAUTH = Q.get('oauth');
if (OAUTH) {
  const now = Math.floor(Date.now() / 1000);
  const auth = { type: 'oauth2', oauth: { grant: 'authorization_code', authUrl: 'https://accounts.dummypay.dev/oauth/authorize', tokenUrl: 'https://accounts.dummypay.dev/oauth/token', revokeUrl: 'https://accounts.dummypay.dev/oauth/revoke', clientId: 'bonk-dev', scope: 'payments:read payments:write offline_access' } };
  tree[0].auth = auth;
  if (OAUTH !== 'inherit') STATE.tabs[0].request.auth = auth;
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${b64({ alg: 'RS256', kid: '94' })}.${b64({ sub: 'usr_7f2a91', aud: 'payments-api', iss: 'accounts.dummypay.dev', exp: now + 3540, iat: now - 60, roles: 'merchant_admin' })}.mQ3x0`;
  const TOKEN = { accessToken: jwt, tokenType: 'Bearer', hasRefresh: true, expiresAt: now + 3540, scope: auth.oauth.scope, obtainedAt: now - 60 };
  const FAIL = { kind: 'provider', status: 400, url: auth.oauth.tokenUrl, error: 'invalid_grant', description: 'redirect_uri does not match the address registered for the bonk-dev app.', body: '{ "error": "invalid_grant", "error_description": "redirect_uri mismatch" }' };
  let stored = OAUTH === 'valid' || OAUTH === 'inherit' ? TOKEN : OAUTH === 'expired' ? { ...TOKEN, expiresAt: now - 120 } : null;
  H.oauth_status = () => stored;
  H.oauth_token = () => ((stored = TOKEN), { token: TOKEN, renewed: true, previousExpiresAt: now - 120 });
  H.oauth_login_start = () => ({ flowId: '1', url: 'https://accounts.dummypay.dev/oauth/authorize?client_id=bonk-dev&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', redirectUri: 'http://127.0.0.1:53682/callback', listens: true });
  H.oauth_login_wait = () => (OAUTH === 'error' ? Promise.reject(FAIL) : new Promise(() => {}));
  for (const name of ['oauth_login_input', 'oauth_forget', 'oauth_revoke', 'open_url']) H[name] = () => null;
}

if (Q.get('runner')) {
  for (const f of tree) if (f.id === 'fs:payments' || f.id === 'fs:auth') for (const c of f.children) c.request.testScript = "pm.test('status is 2xx', () => {});";
  STATE.tabs = STATE.tabs.filter((t) => t.protocol !== 'env');
  STATE.activeEnvironmentId = 'env-staging';
  STATE.runnerConfig = { folderIds: ['fs:payments', 'fs:auth'], iterations: 2, delayMs: 200, stopOnFailure: false };
  const day = 864e5;
  STATE.runnerHistory = [4600, 4900, 4300, 5300, 3900, 4800, 5100, 4500, 5700].map((ms, i) => ({
    n: 33 + i, startedAt: Date.now() - (9 - i) * day, passed: i === 4 ? 14 : 16, total: 16, durationMs: ms, p95Ms: i === 8 ? 194 : 180 + i,
  }));

  const ROUTES = [
    ['GET', /\/v1\/payments\?/, 146, 128, () => 200, BODY, 2458],
    ['GET', /\/v1\/payments\/[^/]+$/, 135, 96, () => 200, BODY, 412],
    ['POST', /\/v1\/payments$/, 190, 212, () => 201, CREATED.body, 318],
    ['PATCH', /\/v1\/payments\//, 154, 140, () => 200, BODY, 412],
    ['DELETE', /\/refund$/, 132, 88, (n) => (n > 1 ? 404 : 200), (s) => (s === 404 ? '{"error":"payment not found"}' : BODY), 64],
    ['POST', /\/v1\/tokens\/refresh$/, 118, 61, (n) => (n > 1 ? 401 : 200), (s) => (s === 401 ? '{"error":"token revoked"}' : '{"access_token":"tok_2"}'), 48],
    ['POST', /\/v1\/tokens$/, 172, 174, () => 200, '{"id":"tok_1","access_token":"tok_1"}', 96],
    ['DELETE', /\/v1\/tokens\//, 79, 79, () => 204, '', 0],
  ];
  const calls = new Map();
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

  H.runner_run = async (a) => {
    const emit = channel(a.onEvent);
    const { requests, dataRows, delayMs, stopOnFailure } = a.plan;
    const iterations = dataRows.length || Math.max(1, a.plan.iterations);


    let clock = 0;
    for (let it = 1; it <= iterations; it++) {
      const scope = { ...a.vars.globals, ...a.vars.environment, ...dataRows[it - 1] };
      const itStart = clock;
      let idle = 0; // delays are kept out of the waterfall
      emit({ kind: 'iteration', index: it, atMs: itStart });
      for (const [j, node] of requests.entries()) {
        const { method } = node.request;
        const url = fill(node.request.url, scope);
        emit({ kind: 'call', nodeId: node.id, name: node.name, method });
        const startOffsetMs = clock - itStart - idle;
        const [, re, wait, elapsed, status, body, size] = ROUTES.find(([m, re]) => m === method && re.test(url)) ?? [, url, 100, 128, () => 200, BODY, 2458];
        const n = (calls.get(re) ?? 0) + 1;
        calls.set(re, n);
        await sleep(wait);
        clock += elapsed;
        const s = status(n);
        const passed = s >= 200 && s < 300;
        const tests = [{ name: 'status is 2xx', passed, error: passed ? undefined : `received ${s}` }, { name: 'response time < 500 ms', passed: elapsed < 500 }];
        const ok = tests.every((t) => t.passed);
        emit({
          kind: 'row', id: crypto.randomUUID(), iteration: it, requestName: node.name, protocol: 'http', method, target: url,
          status: s, ok, elapsedMs: elapsed, tests, logs: [], responseBody: typeof body === 'function' ? body(s) : body,
          nodeId: node.id, startOffsetMs, sizeBytes: s >= 400 ? 64 : size, endMs: clock,
        });
        if (stopOnFailure && !ok) return 'stopped';
        if (delayMs > 0 && !(it === iterations && j === requests.length - 1)) { await sleep(delayMs); clock += delayMs; idle += delayMs; }
      }
    }
    return 'done';
  };
}

{
  const G = Q.get('git');
  const now = Math.floor(Date.now() / 1000);
  const H_ = 3600;
  const LIST_OLD = '{\n  "name": "List payments",\n  "method": "GET",\n  "url": "{{baseUrl}}/v1/payments",\n  "headers": {\n    "Authorization": "Bearer {{TOKEN}}"\n  },\n  "body": { "mode": "none" }\n}';
  const LIST_DIFF = 'diff --git a/payments/list b/payments/list\n--- a/payments/list\n+++ b/payments/list\n@@ -1,9 +1,11 @@\n {\n   "name": "List payments",\n   "method": "GET",\n-  "url": "{{baseUrl}}/v1/payments",\n+  "url": "{{baseUrl}}/v1/payments?limit=20",\n   "headers": {\n     "Authorization": "Bearer {{TOKEN}}",\n+    "Idempotency-Key": "{{uuid}}",\n+    "Accept": "application/json"\n   },\n   "body": { "mode": "none" }\n }\n';
  const whole = (path, text, sign) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,${sign === '-' ? text.split('\n').length : 0} +1,${sign === '+' ? text.split('\n').length : 0} @@\n` + text.split('\n').map((l) => sign + l).join('\n') + '\n';
  let files = G === '1' ? [
    { path: 'payments/create', index: 'A', worktree: ' ' },
    { path: 'auth/issue', index: 'M', worktree: ' ' },
    { path: 'payments/list', index: ' ', worktree: 'M' },
    { path: 'payments/refund', index: ' ', worktree: 'M' },
    { path: 'webhooks/old-webhook.bonk.json', index: ' ', worktree: 'D' },
    ...(Q.get('op') ? [{ path: 'payments/create', index: 'U', worktree: 'U' }, { path: 'webhooks/old-webhook.bonk.json', index: 'D', worktree: 'U' }] : []),
  ] : G === 'many' ? Array.from({ length: 282 }, (_, i) => ({ path: `Dummy Payments/req-${i}.bonk.json`, index: '?', worktree: '?' })) : [];
  let stashes = G === '1' ? [
    { index: 0, hash: 'f00a1', short: 'f00a1c', message: 'timeout tweak', branch: 'feature/refunds', time: now - 2 * H_ },
    { index: 1, hash: 'f00b2', short: 'b21d09', message: 'auth headers', branch: 'main', time: now - 3 * 24 * H_ },
  ] : [];
  const branch = G === '1' ? 'feature/refunds' : 'main';
  Object.assign(H, {
    git_status: () => G === 'none'
      ? { isRepo: false, branch: '', upstream: null, ahead: 0, behind: 0, files: [], prefix: '', operation: '', undoRebase: '' }
      : { isRepo: true, branch, upstream: `origin/${branch}`, ahead: G === '1' ? 1 : 0, behind: G === '1' ? 2 : 0, files: [...new Map(files.map((f) => [f.path, f])).values()], prefix: '', operation: Q.get('op') || '', undoRebase: Q.get('undo') ? 'c0ffee' + '0'.repeat(34) : '' },
    git_log: () => [
      { hash: 'a91c3e0', short: 'a91c3e', subject: 'Bump payments to v2', author: 'Aru', date: '2026-10-11', time: now - 2 * H_ },
      { hash: '4f02bd0', short: '4f02bd', subject: 'Auth: refresh token flow', author: 'Aru', date: '2026-10-10', time: now - 26 * H_ },
      { hash: 'e7d2100', short: 'e7d210', subject: 'Initial collections', author: 'Aru', date: '2026-10-08', time: now - 72 * H_ },
    ],
    git_stash_list: () => stashes,
    git_branch_list: () => [
      { name: branch, remote: false, current: true, upstream: `origin/${branch}`, ahead: G === '1' ? 1 : 0, behind: G === '1' ? 2 : 0 },
      ...(G === '1' ? [{ name: 'main', remote: false, current: false, upstream: 'origin/main', ahead: 0, behind: 0 }] : []),
      { name: 'fix/auth-timeout', remote: false, current: false, upstream: null, ahead: 3, behind: 0 },
      { name: 'fix/webhook-retries', remote: false, current: false, upstream: null, ahead: 0, behind: 0 },
      { name: `origin/${branch}`, remote: true, current: false, upstream: null, ahead: 0, behind: 0 },
      { name: 'origin/fix/flaky-tests', remote: true, current: false, upstream: null, ahead: 0, behind: 0 },
    ],
    git_diff: (a) => a.path === 'payments/list' ? LIST_DIFF : a.path.includes('old-webhook') ? whole(a.path, LIST_OLD, '-') : whole(a.path, LIST_OLD, '+'),
    git_graph_log: (a) => {
      const C = (hash, subject, parents, author, ago, refs = []) => ({ hash: hash + '0'.repeat(34), short: hash, parents: parents.map((p) => p + '0'.repeat(34)), author, email: author.split(' ')[0].toLowerCase() + '@dummypay.dev', time: now - ago, subject, refs });
      const ALL = [
        C('a91c3e', 'Bump payments to v2', ['7c55d0'], 'Dana K.', 2 * H_, [{ name: branch, kind: 'head' }]),
        C('d10f77', 'Release 1.4', ['c2e981'], 'Aru S.', 5 * H_, [{ name: 'main', kind: G === '1' ? 'branch' : 'head' }, { name: 'origin/main', kind: 'remote' }, { name: 'v1.4', kind: 'tag' }]),
        C('3be1a2', 'Webhooks: retry policy', ['88ab14'], 'Timur K.', 26 * H_, [{ name: 'feature/webhooks-v2', kind: 'branch' }]),
        C('7c55d0', 'Refund: idempotency header', ['4f02bd'], 'Dana K.', 30 * H_, [{ name: 'origin/feature/refunds', kind: 'remote' }]),
        C('4f02bd', "Merge branch 'main' into feature/refunds", ['5d3f0a', 'c2e981'], 'Dana K.', 50 * H_),
        C('c2e981', 'Auth: refresh token flow', ['b71e2c'], 'Aru S.', 52 * H_),
        C('88ab14', 'Webhooks: signature check', ['e7d210'], 'Timur K.', 74 * H_),
        C('5d3f0a', 'Create refund endpoint', ['b71e2c'], 'Dana K.', 98 * H_),
        C('b71e2c', 'Payments: pagination', ['e7d210'], 'Aru S.', 120 * H_),
        C('e7d210', 'Initial collections', [], 'Aru S.', 29 * 24 * H_, [{ name: 'v1.0', kind: 'tag' }]),
      ];
      const list = a.all ? ALL : ALL.filter((c) => !['3be1a2', '88ab14', 'd10f77'].includes(c.short));
      return { commits: list.slice(a.skip, a.skip + a.limit), total: list.length + (a.all ? 32 : 20), branches: 3 };
    },
    git_commit_detail: (a) => {
      const c = H.git_graph_log({ all: true, skip: 0, limit: 99 }).commits.find((x) => x.hash === a.hash);
      return { ...c, body: c.short === '7c55d0' ? 'Idempotency-Key on Create refund and Issue token — a retried request no longer creates a second refund.' : '', branches: c.refs.filter((r) => r.kind !== 'tag').map((r) => r.name).concat(c.short === '7c55d0' ? [] : []), files: [
        { path: 'payments/create', status: 'M', additions: 12, deletions: 2 },
        { path: 'auth/issue', status: 'M', additions: 4, deletions: 1 },
        { path: 'payments/refund', status: 'M', additions: 2, deletions: 1 },
      ] };
    },
    git_commit_file_diff: () => LIST_DIFF,
    git_format_patch: () => 'From a91c3e…\n',
    git_conflicts: () => Q.get('op') ? [
      {
        path: 'payments/create',
        base: JSON.stringify({ name: 'Create refund', method: 'POST', url: '{{baseUrl}}/v1/refunds', asserts: [{ path: 'status', op: 'eq', value: 200 }, { path: 'body.id', op: 'exists' }], params: [{ key: 'limit', value: '20', description: '', enabled: true }, { key: 'status', value: 'captured', description: '', enabled: true }], headers: { Authorization: 'Bearer {{TOKEN}}' }, timeout: 5000, body: { mode: 'json', amount: '{{a}}' } }, null, 2) + '\n',
        mine: JSON.stringify({ name: 'Create refund', method: 'POST', url: '{{baseUrl}}/v1/refunds', asserts: [{ path: 'status', op: 'eq', value: 200 }, { path: 'body.refundId', op: 'exists' }], params: [{ key: 'limit', value: '50', description: '', enabled: true }, { key: 'status', value: 'captured', description: '', enabled: true }], headers: { Authorization: 'Bearer {{TOKEN}}', 'Idempotency-Key': '{{uuid}}' }, timeout: 10000, body: { mode: 'json', amount: '{{amount}}' } }, null, 2) + '\n',
        theirs: JSON.stringify({ name: 'Create refund', method: 'POST', url: '{{baseUrl}}/v1/refunds', asserts: [{ path: 'status', op: 'eq', value: 200 }, { path: 'body.state', op: 'eq', value: 'ok' }], params: [{ key: 'limit', value: '20', description: '', enabled: true }, { key: 'status', value: 'refunded', description: '', enabled: true }, { key: 'expand', value: 'customer', description: '', enabled: true }], headers: { Authorization: 'Bearer {{TOKEN}}', 'X-Retry-Policy': 'exponential' }, timeout: 30000, retries: 5, body: { mode: 'json', amount: '{{refundAmount}}' } }, null, 2) + '\n',
      },
      { path: 'webhooks/old-webhook.bonk.json', base: '{}', mine: null, theirs: '{ "v": 2 }' },
    ] : [],
    git_operation_info: () => ({ kind: Q.get('op') || '', step: 1, total: 2, hash: '3be1a2' + '0'.repeat(34), subject: 'Webhooks: retry policy', mine: branch, theirs: '3be1a2', paused: Q.get('paused') === '1' }),
    git_rebase_undo: () => null,
    git_delete_branch: () => 'c0ffee' + '0'.repeat(34),
    git_restore_snapshot: () => null,
    git_remote_list: () => [{ name: 'origin', url: 'git@github.com:dummypay/payments-api.git' }],
    git_remote_add: () => null,
    git_remote_remove: () => null,
    git_clone: (a) => `/Users/aru/work/${a.url.split('/').pop().replace(/\.git$/, '')}`,
    git_reflog: () => [
      { hash: 'a91c3e' + '0'.repeat(34), short: 'a91c3e', action: 'commit: Bump payments to v2', time: now - 2 * H_ },
      { hash: '4f02bd' + '0'.repeat(34), short: '4f02bd', action: 'checkout: moving from main to feature/refunds', time: now - 5 * H_ },
      { hash: 'c0ffee' + '0'.repeat(34), short: 'c0ffee', action: 'reset: moving to HEAD~2', time: now - 26 * H_ },
    ],
    git_commits_touching: () => [],
    git_apply_patch: () => null,
    git_head: () => 'a91c3e' + '0'.repeat(34),
    git_move_head: () => null,
    git_compare: () => [
      { path: 'payments/list', status: 'M', additions: 3, deletions: 1 },
      { path: 'auth/token', status: 'A', additions: 18, deletions: 0 },
    ],
    git_compare_file_diff: () => LIST_DIFF,
    git_delete_remote_branch: () => '',
    git_rename_branch: () => null,
    git_delete_tag: () => null,
    git_push_tag: () => '',
    git_file_log: (a) => a.skip ? [] : [
      { hash: 'a91c3e' + '0'.repeat(34), short: 'a91c3e', subject: 'Bump payments to v2', author: 'Aru', time: now - 2 * H_, path: a.path, status: 'M' },
      { hash: '7c55d0' + '0'.repeat(34), short: '7c55d0', subject: 'Refund: idempotency header', author: 'Timur K.', time: now - 26 * H_, path: a.path, status: 'M' },
      { hash: 'e7d210' + '0'.repeat(34), short: 'e7d210', subject: 'Initial collections', author: 'Aru', time: now - 72 * H_, path: 'payments/list-old.bonk.json', status: 'A' },
    ],
    git_blame: () => ['{', '  "name": "List payments",', '  "request": {', '    "method": "GET",', '    "url": "{{baseUrl}}/v1/payments?limit=20"', '  }', '}'].map((text, i) => ({
      hash: i === 4 ? '0'.repeat(40) : (i < 2 ? 'e7d210' : 'a91c3e') + '0'.repeat(34), author: i < 2 ? 'Aru' : 'Timur K.', time: now - (i < 2 ? 72 : 2) * H_, summary: i < 2 ? 'Initial collections' : 'Bump payments to v2', text })),
    git_rebase_plan: (a) => ({ onto: 'd10f77' + '0'.repeat(34), ontoShort: 'd10f77', ontoSubject: 'Release 1.4', commits: [
      { hash: '5d3f0a' + '0'.repeat(34), short: '5d3f0a', subject: 'Create refund endpoint', message: 'Create refund endpoint\n\nPOST /refunds with an idempotency key.', pushed: true },
      { hash: '7c55d0' + '0'.repeat(34), short: '7c55d0', subject: 'Refund: idempotency header', message: 'Refund: idempotency header', pushed: true },
      { hash: '2e1f9c' + '0'.repeat(34), short: '2e1f9c', subject: 'fix typo in refund body', message: 'fix typo in refund body', pushed: false },
      { hash: 'a91c3e' + '0'.repeat(34), short: 'a91c3e', subject: 'Bump payments to v2', message: 'Bump payments to v2', pushed: false },
      { hash: '9b0c1d' + '0'.repeat(34), short: '9b0c1d', subject: 'wip: debug logs', message: 'wip: debug logs', pushed: false },
    ] }),
    git_status_diffs: () => files.map((f) => ({ path: f.path, staged: f.index !== ' ' && f.index !== '?', untracked: f.index === '?', diff: f.path === 'payments/list' ? LIST_DIFF : whole(f.path, LIST_OLD, f.worktree === 'D' ? '-' : '+') })),
    git_stash_show: () => [{ path: 'payments/list', status: 'M', diff: LIST_DIFF }],
    git_stage: (a) => { files = files.map((f) => a.paths.includes(f.path) ? { ...f, index: f.worktree === ' ' ? f.index : f.worktree, worktree: ' ' } : f); return null; },
    git_unstage: (a) => { files = files.map((f) => a.paths.includes(f.path) ? { ...f, index: ' ', worktree: f.index === 'A' ? '?' : f.index } : f); return null; },
    git_discard: (a) => { files = files.filter((f) => !a.paths.includes(f.path)); return 'f00d' + '0'.repeat(36); },
    git_commit: () => { files = files.filter((f) => f.index === ' ' || f.index === '?'); return 'abc1234'; },
    git_stash_push: (a) => { stashes = [{ index: 0, hash: 'n' + Date.now(), short: 'c0ffee', message: a.message || 'WIP', branch, time: now }, ...stashes.map((x) => ({ ...x, index: x.index + 1 }))]; files = []; return null; },
    git_stash_drop: (a) => { stashes = stashes.filter((x) => x.index !== a.index).map((x, i) => ({ ...x, index: i })); return null; },
    git_stash_pop: (a) => H.git_stash_drop(a),
    git_push: () => 'Everything up-to-date',
    git_pull: () => 'Already up to date.',
  });
}


STATE.tabs[0].request.testScript = "// ── Helpers ─────────────────────────────\nconst data = pm.response.json();\nconst isDate = (s) => !Number.isNaN(Date.parse(s));\nfunction assertMoney(v) {\n  pm.expect(v).to.be.a('number');\n  pm.expect(v).to.be.above(0);\n}\n\n// ── Response contract ───────────────────\npm.test('Status is 200', function () {\n  pm.expect(pm.response).to.have.status(200);\n});\npm.test('List schema', function () {\n  pm.expect(data).to.have.keys('items', 'next', 'total');\n  pm.expect(data.items).to.be.an('array');\n});\npm.test('Every payment is valid', function () {\n  data.items.forEach((p, i) => {\n    pm.expect(p.id, `items[${i}].id`).to.match(/^pay_/);\n    assertMoney(p.amount);\n    pm.expect(isDate(p.created_at)).to.be.true;\n  });\n});\npm.test('Pagination', function () {\n  pm.expect(data.items.length).to.be.at.most(20);\n});\n\n// ── Environment ─────────────────────────\npm.environment.set('payment_id', data.items[0].id);\npm.environment.set('next_cursor', data.next ?? '');\nif (data.total > 1000) {\n  console.log('large page', data.total);\n}";
STATE.tabs.push({ id: 'tab-grpc', protocol: 'grpc', title: 'SayHello', manualTitle: true,
  savedPath: 'fs:greeter/hello', request: req('POST', ''), grpc: GRPC('SayHello') });
if (Q.has('grpcshot')) STATE.activeTabId = 'tab-grpc';
H.run_script = () => JSON.stringify({
  logs: [{ level: 'log', args: ['payments', 20] }, { level: 'log', args: ['next cursor', 'cur_9Qx2'] }],
  tests: [
    { name: 'Status is 200', passed: true },
    { name: 'List schema', passed: true },
    { name: 'Every payment is valid', passed: false, error: 'AssertionError: expected "2026-13-01" to be a valid date (items[7].created_at)' },
    { name: 'Pagination', passed: true },
  ],
  vars: { payment_id: 'pay_8f2k1' }, error: null,
});
(function demoChrome() {
  const view = new URLSearchParams(location.search).get('view');
  const until = (find, ms = 5000) =>
    new Promise((done, fail) => {
      const t0 = Date.now();
      const tick = () => {
        const el = find();
        if (el) return done(el);
        if (Date.now() - t0 > ms) return fail(new Error(`demo: ${view} step timed out`));
        setTimeout(tick, 50);
      };
      tick();
    });
  const byText = (sel, text) => () =>
    [...document.querySelectorAll(sel)].find((el) =>
      text instanceof RegExp ? text.test(el.textContent.trim()) : el.textContent.trim() === text,
    );
  const byLabel = (label) => () => document.querySelector(`[aria-label="${label}"], [title="${label}"]`);
  const click = async (find) => (await until(find)).click();
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const STEPS = {
    git: async () => {
      await click(byLabel('Source control'));
      await click(byText('button', /^Graph/));
    },
    scripts: async () => {
      await click(() => document.querySelector('#bs-rtab-scripts'));
      await click(byText('button, [role="tab"]', /Post-response/));
      await click(byLabel('Close snippets'));
      await click(() => document.querySelector('[aria-label="Expand"], [title="Expand"]'));
    },
    tests: async () => {
      await click(() => document.querySelector('button.bs-send'));
      await click(byText('[role="tab"]', /^Tests/));
    },
    console: async () => {
      await click(() => document.querySelector('button.bs-send'));
      await pause(400);
      await click(byText('[role="tab"]', /SayHello/));
      await click(() => document.querySelector('button.bs-send'));
      await pause(400);
      await click(byText('[role="tab"]', /List payments/));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', metaKey: true, bubbles: true }));
    },
    grpc: async () => {
      const leaf = (text) => () =>
        [...document.querySelectorAll('.bs-sidebar-content *')].find(
          (el) => !el.children.length && el.textContent.trim() === text,
        );
      await click(leaf('Greeter (gRPC)'));
      await click(leaf('CollectNames'));
      await click(() => document.querySelector('button.bs-send'));
    },
    mcp: async () => {
      await click(byLabel('Settings'));
      await click(byText('button, [role="tab"], a', /AI \/ MCP$/));
    },
  };
  addEventListener('DOMContentLoaded', async () => {
    // No macOS title bar in a browser: keep the app's inset for it and draw the traffic lights.
    document.documentElement.dataset.nativeMacos = 'true';
    const lights = document.createElement('div');
    lights.style.cssText = 'position:fixed;top:15px;left:16px;display:flex;gap:8px;z-index:9999;pointer-events:none';
    for (const c of ['#ff5f57', '#febc2e', '#28c840']) {
      const dot = document.createElement('span');
      dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${c}`;
      lights.append(dot);
    }
    document.body.append(lights);
    await until(byText('[role="tab"]', /List payments/), 10000);
    await document.fonts.ready;
    await STEPS[view]?.();
    document.documentElement.dataset.demoReady = view ?? 'home';
  });
})();
window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
  invoke: (cmd, args) => {
    if (cmd.startsWith('plugin:event|')) return Promise.resolve(0);
    const h = H[cmd];

    if (h && Q.get('delay') && cmd.startsWith('git_')) return new Promise((res) => setTimeout(() => res(h(args)), Number(Q.get('delay'))));
    if (h) return Promise.resolve(h(args));
    console.warn('shim miss', cmd, args);
    return Promise.resolve(null);
  },
  transformCallback: (cb) => {
    const id = Math.floor(Math.random() * 1e9);
    window['_' + id] = cb;
    return id;
  },
};

window.snap = (name) => {
  const h = document.documentElement;
  const doc = `<!doctype html>
<html class="${h.className}" data-theme="${h.dataset.theme || ''}">
<head><meta charset="utf-8"><link rel="stylesheet" href="./assets/index-DoZkjrIa.css"><style>html,body{width:1440px;height:900px;overflow:hidden;margin:0}#app{height:900px}</style></head>
<body class="${document.body.className}">${document.getElementById('app').outerHTML}</body></html>`;
  return fetch('http://localhost:1426/?name=' + name, { method: 'POST', body: doc }).then((r) => r.text()).then(() => name + ':' + doc.length);
};


