import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, extname } from 'node:path';
import { createMonitor } from './monitor.mjs';
import { resolveAdb } from './desktop/adb.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const port = Number(process.env.PORT || 3210);
const monitor = createMonitor({ adbPath: await resolveAdb() });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const json = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(req.headers.host || '')) return json({ error: 'Local access only' }, 403);
  if (req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) return json({ error: 'Origin not allowed' }, 403);
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const unsubscribe = monitor.subscribe(send); send('init', monitor.state());
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    req.on('close', () => { unsubscribe(); clearInterval(heartbeat); }); return;
  }
  if (url.pathname.startsWith('/api/')) {
    try { const result = await monitor.request(url.pathname + url.search, req.method); return json(result.data, result.status); }
    catch { return json({ error: '采集请求失败' }, 500); }
  }
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  try {
    const path = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (path.split('/').some(p => p === '..') || path.includes('\\')) return json({ error: 'Not found' }, 404);
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { if (!res.headersSent) json({ error: 'Not found' }, 404); else res.end(); }
});
server.listen(port, '127.0.0.1', () => { console.log(`BKDeviceMonitor 手机性能面板 → http://localhost:${port}`); void monitor.start(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { monitor.stop(); server.closeAllConnections(); server.close(() => process.exit(0)); });
