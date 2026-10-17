import { createServer } from 'node:http';
import { writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = process.argv[2];
const HERE = dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.png': 'image/png',
};

createServer((req, res) => {

  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST') {
    const name = url.searchParams.get('name') || 'snap';
    // Snapshot names become file names in DIST: no paths, no traversal.
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      res.writeHead(400);
      return res.end('bad name');
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      writeFileSync(join(DIST, `${name}.html`), buf);
      console.log('wrote', name, buf.length);
      res.end('ok');
    });
    return;
  }

  if (url.pathname === '/shim.js') {
    res.setHeader('Content-Type', 'text/javascript');
    return res.end(readFileSync(join(HERE, 'shim.js')));
  }

  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(DIST, path);
  if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end('not found');

  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  if (path === '/index.html') {
    // Shim must run before main.js so app_state_load sees the seeded state.
    const html = readFileSync(file, 'utf8').replace('<head>', '<head><script type="module" src="/shim.js"></script>');
    return res.end(html);
  }
  res.end(readFileSync(file));
}).listen(Number(process.argv[3] ?? 1426), '127.0.0.1', () => console.log('snap server on', process.argv[3] ?? 1426, '->', DIST));
