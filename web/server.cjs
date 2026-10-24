const http = require('node:http');
const https = require('node:https');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream');

// The LINE extension is not part of this repository; see README.
const VENDOR = path.resolve(process.env.LINE_EXTENSION_DIR || path.join(__dirname, '../vendor/line'));
const UPSTREAMS = new Set(['line-chrome-gw.line-apps.com', 'legy-jp.line-apps.com', 'legy-backup.line-apps.com', 'obs.line-apps.com', 'obs.line-scdn.net', 'profile.line-scdn.net', 'shop.line-scdn.net', 'stickershop.line-scdn.net', 'static.line-scdn.net', 'ci.line-apps.com', 'cix.line-apps.com', 'uts-front.line-apps.com']);
const EXTENSION_ORIGIN = 'chrome-extension://ophjlpahpchlmihnnnihgmmeilfjmjjc';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function adaptSandboxSource(source) {
  // Version-specific host-environment import. Preserve the WASM/cipher code.
  const before = 'w:function(){var e=window.location.origin,t=k(e)+1,r=nr(t);';
  const after = 'w:function(){var e=window.origin,t=k(e)+1,r=nr(t);';
  if (source.split(before).length !== 2) throw new Error('Unrecognized LINE sandbox version');
  return source.replace(before, after);
}
function storeCookies(jar, host, values) {
  for (const raw of values) {
    const [first, ...attributes] = raw.split(';'); const equals = first.indexOf('=');
    if (equals < 1) continue;
    const name = first.slice(0, equals).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) continue;
    let cookiePath = '/', expires = Infinity, maxAge;
    for (const attribute of attributes) {
      const part = attribute.trim(), i = part.indexOf('='); const key = (i < 0 ? part : part.slice(0, i)).toLowerCase(), value = part.slice(i + 1);
      if (key === 'path' && value.startsWith('/')) cookiePath = value;
      if (key === 'max-age' && /^-?\d+$/.test(value)) maxAge = Number(value);
      if (key === 'expires' && Number.isFinite(Date.parse(value))) expires = Date.parse(value);
    }
    if (maxAge !== undefined) expires = Date.now() + maxAge * 1000;
    const key = JSON.stringify([host, cookiePath, name]);
    if (expires <= Date.now()) jar.delete(key);
    else jar.set(key, { host, path: cookiePath, name, value: first.slice(equals + 1), expires });
  }
}
function cookieHeader(jar, host, requestPath) {
  return [...jar.values()].filter(c => c.host === host && c.expires > Date.now() && (requestPath === c.path || requestPath.startsWith(c.path.endsWith('/') ? c.path : c.path + '/')))
    .sort((a, b) => b.path.length - a.path.length).map(c => `${c.name}=${c.value}`).join('; ');
}
function sameOrigin(req, origin, requireBrowser = false) {
  if (req.headers.host !== new URL(origin).host) return false;
  if (req.headers.origin && req.headers.origin !== origin) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  return !requireBrowser || req.headers.origin === origin || site === 'same-origin';
}
function createServer(requestUpstream = https.request, { instances, loginVault, now = Date.now } = {}) {
  const sessions = new Map();
  const restore = (origin, id) => {
    if (sessions.has(id)) {
      const state = sessions.get(id);
      if (now() - state.used <= (loginVault?.idleMs || 86400000)) return state;
      sessions.delete(id);
    }
    if (!loginVault || sessions.size >= 32) return null;
    const saved = loginVault.load(origin, id);
    if (!saved) return null;
    const state = { ...saved, epoch: 0, persisted: true, savedAt: saved.used };
    sessions.set(id, state); return state;
  };
  const persist = (origin, id, state, force = false) => {
    if (!loginVault || (!state.persisted && !state.jar.size && !state.persistenceError)) return;
    if (state.persistenceError) force = true;
    if (!force && state.savedAt && state.used - state.savedAt < 3600000) return;
    try { loginVault.save(origin, id, state); }
    catch (error) { state.persistenceError = true; throw error; }
    state.persistenceError = false; state.savedAt = state.used; state.persisted = state.jar.size > 0;
  };
  const clearLogin = (origin, id, state) => {
    state.epoch++; state.jar.clear(); state.used = now();
    persist(origin, id, state, true);
  };
  const server = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Cache-Control', 'no-store');
    // Cross-port links may open public pages, but never APIs or embedded frames.
    const pageNavigation = req.method === 'GET'
      && req.headers.host === new URL(origin).host
      && (!req.headers.origin || req.headers.origin === origin)
      && req.headers['sec-fetch-mode'] === 'navigate'
      && req.headers['sec-fetch-dest'] === 'document'
      && ['/', '/index.html'].includes(req.url.split('?')[0]);
    if (!sameOrigin(req, origin) && !pageNavigation) { res.writeHead(403); res.end('Local origin required'); return; }
    let url;
    try { url = new URL(req.url, origin); } catch { res.writeHead(400); res.end(); return; }
    if (url.origin !== origin) { res.writeHead(400); res.end(); return; }
    if (url.pathname === '/__health' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ app: 'line-web-research', mode: 'local-browser', port: server.address().port })); return;
    }
    const deleteInstance = /^\/__instances\/([1-9][0-9]*)$/.exec(url.pathname);
    if (deleteInstance) {
      if (!sameOrigin(req, origin, true) || req.headers.origin !== origin || req.headers['x-line-web-action'] !== 'delete-instance') { res.writeHead(403); res.end(); return; }
      if (req.method !== 'DELETE') { res.writeHead(405); res.end(); return; }
      if (!instances) { res.writeHead(503); res.end(); return; }
      if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) !== 0) { res.writeHead(400); res.end(); return; }
      instances.remove(deleteInstance[1], origin).then(() => { res.writeHead(204); res.end(); }, () => {
        res.writeHead(409); res.end('Cannot delete the main/current instance, or save settings');
      });
      return;
    }
    if (url.pathname === '/__instances') {
      // Only our own page may allocate listeners; never accept form/foreign requests.
      if (!sameOrigin(req, origin, true)) { res.writeHead(403); res.end(); return; }
      if (!instances) { res.writeHead(503); res.end('Use the background launcher for multiple instances'); return; }
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET') { res.end(JSON.stringify(instances.list())); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      if (req.headers.origin !== origin || req.headers['x-line-web-action'] !== 'create-instance') { res.writeHead(403); res.end(); return; }
      if (req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) !== 0) { res.writeHead(400); res.end(); return; }
      instances.create().then(item => { res.writeHead(201); res.end(JSON.stringify(item)); }, () => {
        res.writeHead(409); res.end(JSON.stringify({ error: 'Cannot add an instance (8 at most). Check the background service.' }));
      });
      return;
    }
    if (url.pathname === '/__session') {
      if (req.method !== 'POST' || req.headers.origin !== origin) { res.writeHead(403); res.end(); return; }
      const currentTime = now();
      for (const [id, state] of sessions) if (currentTime - state.used > (loginVault?.idleMs || 86400000)) sessions.delete(id);
      let id = req.headers['x-line-web-session'];
      try { restore(origin, id); }
      catch { res.writeHead(503); res.end('Saved login unavailable'); return; }
      if (!sessions.has(id)) {
        if (sessions.size >= 32) { res.writeHead(429); res.end(); return; }
        id = randomBytes(32).toString('hex'); sessions.set(id, { used: currentTime, jar: new Map(), epoch: 0 });
      }
      const state = sessions.get(id); state.used = currentTime;
      try { persist(origin, id, state); }
      catch { res.writeHead(503); res.end('Cannot save login'); return; }
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id })); return;
    }
    if (url.pathname === '/__clear-login-cookie') {
      if (req.method !== 'POST' || req.headers.origin !== origin) { res.writeHead(403); res.end(); return; }
      const id = req.headers['x-line-web-session'];
      let state;
      try { state = restore(origin, id); }
      catch { res.writeHead(503); res.end('Saved login unavailable'); return; }
      if (!state) { res.writeHead(403); res.end(); return; }
      try { clearLogin(origin, id, state); }
      catch { res.writeHead(503); res.end('Cannot clear saved login'); return; }
      res.writeHead(204); res.end(); return;
    }
    if (url.pathname.startsWith('/proxy/')) {
      if (!sameOrigin(req, origin, true) || !['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(req.method)) { res.writeHead(403); res.end(); return; }
      const match = /^\/proxy\/([^/]+)(\/.*)$/.exec(url.pathname);
      if (!match || !UPSTREAMS.has(match[1])) { res.writeHead(403); res.end('Destination not allowed'); return; }
      const sessionId = req.headers['x-line-web-session'] || (req.method === 'GET' && match[2] === '/api/operation/receive' ? url.searchParams.get('__lw_session') : null);
      let state;
      try { state = restore(origin, sessionId); }
      catch { res.writeHead(503); res.end('Saved login unavailable'); return; }
      if (!state) { res.writeHead(401); res.end('Local session required'); return; }
      state.used = now(); url.searchParams.delete('__lw_session');
      // Once persistence has failed, repair it before any next upstream request.
      // Do not perform a LINE operation first and only then report that failure.
      try { persist(origin, sessionId, state); }
      catch { res.writeHead(503); res.end('Cannot save login'); return; }
      const host = match[1], headers = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (name !== 'x-line-web-session' && /^(accept|accept-language|content-type|content-length|range|user-agent|x-hmac|x-lal|x-lst|x-legy-host|x-line-[a-z0-9-]+|x-talk-meta|x-obs-[a-z0-9-]+)$/i.test(name)) headers[name] = value;
      }
      headers.origin = EXTENSION_ORIGIN;
      const cookie = cookieHeader(state.jar, host, match[2]);
      if (cookie) headers.cookie = cookie;
      let epoch = state.epoch;
      // Clear the local snapshot before logout reaches LINE. Pending responses
      // from before logout must not resurrect credentials after a restart.
      if (host === 'line-chrome-gw.line-apps.com' && req.method === 'POST'
        && match[2] === '/api/talk/thrift/Talk/AuthService/logoutV2') {
        try { clearLogin(origin, sessionId, state); }
        catch { res.writeHead(503); res.end('Cannot clear saved login'); return; }
      }
      const upstream = requestUpstream({ hostname: host, port: 443, method: req.method, path: match[2] + url.search, headers }, response => {
        // Do not follow redirects to arbitrary hosts or return remote HTML as local code.
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume(); res.writeHead(502); res.end('Upstream redirect requires adapter support'); return;
        }
        if (/text\/html|application\/xhtml\+xml/i.test(response.headers['content-type'] || '')) {
          response.resume(); res.writeHead(502); res.end('Unexpected upstream document'); return;
        }
        for (const name of ['content-type', 'content-length', 'content-encoding', 'content-range', 'accept-ranges', 'content-disposition', 'x-obs-oid']) {
          if (response.headers[name]) res.setHeader(name, response.headers[name]);
        }
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        try {
          if (state.epoch === epoch) {
            const updates = response.headers['set-cookie'] || [];
            storeCookies(state.jar, host, updates);
            persist(origin, sessionId, state, updates.length > 0);
          }
        } catch {
          response.resume(); res.writeHead(503); res.end('Cannot save login'); return;
        }
        res.writeHead(response.statusCode || 502);
        pipeline(response, res, () => {});
      });
      upstream.setTimeout(120000, () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('LINE connection unavailable'); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => upstream.destroy());
      req.pipe(upstream); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    let filename;
    if (url.pathname === '/') filename = path.join(__dirname, 'portal.html');
    else if (url.pathname === '/web-adapter.js') filename = path.join(__dirname, 'web-adapter.js');
    else if (url.pathname === '/portal.js') filename = path.join(__dirname, 'portal.js');
    else if (url.pathname === '/sandbox-env.js') filename = path.join(__dirname, 'sandbox-env.js');
    else {
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
      filename = path.resolve(VENDOR, '.' + decoded);
      if (!filename.startsWith(VENDOR + path.sep) || decoded.includes('\0')) { res.writeHead(403); res.end(); return; }
    }
    const type = MIME[path.extname(filename)];
    if (!type || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Security-Policy', "default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.line-scdn.net https://*.line-apps.com https://*.line.me; media-src 'self' blob: https://*.line-scdn.net https://*.line-apps.com; connect-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
    if (req.method === 'HEAD') { res.end(); return; }
    if (url.pathname === '/static/js/ltsmSandbox.js') {
      try { res.end(adaptSandboxSource(fs.readFileSync(filename, 'utf8'))); }
      catch { res.writeHead(503); res.end('Unsupported LINE sandbox version'); }
      return;
    }
    if (['index.html', 'popup.html', 'ltsmSandbox.html'].includes(path.basename(filename))) {
      const adapter = path.basename(filename) === 'ltsmSandbox.html' ? 'sandbox-env.js' : 'web-adapter.js';
      let html = fs.readFileSync(filename, 'utf8').replace('<head>', `<head><script defer src="/${adapter}"></script>`);
      if (adapter === 'web-adapter.js') html = html.replace(/<script defer="defer" src="\/static\/js\/(main|popup)\.js"><\/script>/, '');
      res.end(html);
    } else fs.createReadStream(filename).pipe(res);
  });
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 0);
  if (!Number.isInteger(port) || (port !== 0 && port < 1024) || port > 65535) throw new Error('Invalid PORT');
  const server = createServer();
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use.` : 'Local server could not start.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    const actualPort = server.address().port;
    console.log(`line-web-research: http://127.0.0.1:${actualPort}\nStop with Ctrl+C. Browser prototype; account functions require validation.`);
    if (process.argv.includes('--open')) require('node:child_process').execFile('open', [`http://127.0.0.1:${actualPort}`], () => {});
  });
}
module.exports = { createServer, sameOrigin, storeCookies, cookieHeader, UPSTREAMS, adaptSandboxSource };
