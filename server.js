'use strict';
// 第一分公司数据中台 —— 后端服务（纯 Node，零依赖）
// 功能：登录门禁（屏蔽段）/ 静态资源 / 数据聚合接口 / 手动刷新 / 每20分钟自动取数

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const store = require('./src/store');

const PORT = process.env.PORT || 8090;
const users = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'users.json'), 'utf8'));
const SECRET = users.sessionSecret || 'default-secret';
const SESSION_HOURS = users.sessionHours || 12;

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function hmac(s) { return crypto.createHmac('sha256', SECRET).update(s).digest('hex'); }

function makeToken(username) {
  const exp = Date.now() + SESSION_HOURS * 3600 * 1000;
  const payload = Buffer.from(username + '|' + exp).toString('base64');
  return payload + '.' + hmac(payload);
}
function verifyToken(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  const payload = parts[0];
  const sig = parts[1];
  if (hmac(payload) !== sig) return null;
  let data;
  try { data = Buffer.from(payload, 'base64').toString().split('|'); } catch (e) { return null; }
  const username = data[0];
  const exp = Number(data[1]);
  if (!username || Date.now() > exp) return null;
  return username;
}

function findUser(username) {
  return (users.users || []).find(function (u) { return u.username === username; });
}

// ---- 客户端 IP（兼容反代 x-forwarded-for）----
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

// ---- 登录防爆破限流（公网暴露必备）----
const loginFails = new Map(); // ip -> { count, ts }
function loginRateLimited(ip) {
  const now = Date.now();
  const e = loginFails.get(ip);
  if (!e || now - e.ts > 10 * 60 * 1000) { loginFails.set(ip, { count: 0, ts: now }); return false; }
  return e.count >= 20;
}
function noteLoginFail(ip) { const e = loginFails.get(ip) || { count: 0, ts: Date.now() }; e.count++; e.ts = Date.now(); loginFails.set(ip, e); }
function noteLoginOk(ip) { loginFails.delete(ip); }

// ---- 动态 Cookie 头（HTTPS 下自动加 Secure）----
function cookieHeader(token, maxAge) {
  const secure = (process.env.FORCE_HTTPS === '1' || process.env.SECURE_COOKIE === '1') ? ' Secure;' : '';
  return 'dp_token=' + token + '; Path=/; HttpOnly; SameSite=Lax;' + secure + ' Max-Age=' + maxAge;
}

// ---- 静态资源 ----
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res, urlPath) {
  let filePath = path.join(PUBLIC, urlPath === '/' ? 'index.html' : urlPath);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      // SPA 回退到 index.html
      fs.readFile(path.join(PUBLIC, 'index.html'), function (e2, html) {
        if (e2) { res.writeHead(404); res.end('Not Found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---- 请求体解析 ----
function readBody(req) {
  return new Promise(function (resolve) {
    let body = '';
    req.on('data', function (c) { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', function () { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); } });
  });
}

function getCookie(req, name) {
  const ck = req.headers.cookie || '';
  const m = ck.match(new RegExp('(^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}
function getSessionUser(req) {
  return verifyToken(getCookie(req, 'dp_token'));
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---- 路由 ----
async function handleApi(req, res, pathname) {
  if (pathname === '/api/login' && req.method === 'POST') {
    const ip = getClientIp(req);
    if (loginRateLimited(ip)) {
      sendJson(res, 429, { ok: false, error: '尝试过于频繁，请 10 分钟后再试' });
      return;
    }
    const b = await readBody(req);
    const u = findUser(b.username);
    if (u && sha256(b.password) === sha256(u.password)) {
      noteLoginOk(ip);
      const token = makeToken(u.username);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': cookieHeader(token, SESSION_HOURS * 3600)
      });
      res.end(JSON.stringify({ ok: true, user: { username: u.username, name: u.name, role: u.role } }));
    } else {
      noteLoginFail(ip);
      sendJson(res, 401, { ok: false, error: '账号或密码错误' });
    }
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': cookieHeader('', 0)
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === '/api/me') {
    const username = getSessionUser(req);
    const u = username ? findUser(username) : null;
    sendJson(res, 200, { user: u ? { username: u.username, name: u.name, role: u.role } : null });
    return;
  }

  if (pathname === '/api/status') {
    const cache = store.readCache();
    sendJson(res, 200, { updatedAt: cache ? cache.updatedAt : null });
    return;
  }

  // 以下接口需要登录（屏蔽段）
  if (pathname === '/api/data') {
    const username = getSessionUser(req);
    if (!username) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    sendJson(res, 200, store.getModules());
    return;
  }

  if (pathname === '/api/refresh' && req.method === 'POST') {
    const username = getSessionUser(req);
    if (!username) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    const data = await store.refreshAll();
    sendJson(res, 200, { ok: true, updatedAt: data.updatedAt });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not found' });
}

async function requestHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  if (pathname.startsWith('/api/')) {
    try { await handleApi(req, res, pathname); }
    catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }
  serveStatic(req, res, pathname);
}

// ---- SSL/HTTPS 支持：有证书走 HTTPS，无证书退回 HTTP ----
function loadSslOptions() {
  const sslDir = path.join(ROOT, 'ssl');
  const candidates = [];
  if (process.env.SSL_CERT && process.env.SSL_KEY) {
    candidates.push({ cert: process.env.SSL_CERT, key: process.env.SSL_KEY });
  }
  candidates.push(
    { cert: path.join(sslDir, 'cert.pem'), key: path.join(sslDir, 'key.pem') },
    { cert: path.join(sslDir, 'fullchain.pem'), key: path.join(sslDir, 'privkey.pem') }
  );
  for (const c of candidates) {
    try {
      if (fs.existsSync(c.cert) && fs.existsSync(c.key)) {
        return { cert: fs.readFileSync(c.cert), key: fs.readFileSync(c.key) };
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

// ---- 启动 + 定时刷新 ----
store.ensureDirs();
(async function () {
  await store.refreshAll(); // 启动时先取一次
  const cfg = store.loadWpsConfig();
  const minutes = (cfg.refreshMinutes || 20);
  setInterval(function () { store.refreshAll().catch(function (e) { console.error(e); }); }, minutes * 60 * 1000);

  const ssl = loadSslOptions();
  if (ssl) {
    process.env.FORCE_HTTPS = '1';
    const https = require('https');
    const httpsPort = Number(process.env.HTTPS_PORT || 443);
    const httpPort = Number(process.env.HTTP_PORT || 80);
    https.createServer(ssl, requestHandler).listen(httpsPort, '0.0.0.0', function () {
      console.log('HTTPS 已启动：https://0.0.0.0:' + httpsPort + ' （每 ' + minutes + ' 分钟自动刷新）');
    });
    // 80 端口把 HTTP 请求 301 重定向到 HTTPS
    http.createServer(function (req, res) {
      const host = (req.headers.host || 'localhost').split(':')[0];
      const portSuffix = (httpsPort === 443) ? '' : (':' + httpsPort);
      res.writeHead(301, { Location: 'https://' + host + portSuffix + req.url });
      res.end();
    }).listen(httpPort, '0.0.0.0', function () {
      console.log('HTTP 重定向已启动：http://0.0.0.0:' + httpPort + ' -> https');
    });
  } else {
    http.createServer(requestHandler).listen(PORT, '0.0.0.0', function () {
      console.log('HTTP 已启动：http://0.0.0.0:' + PORT + ' （每 ' + minutes + ' 分钟自动刷新）');
      console.log('（如需 HTTPS：把证书命名为 cert.pem / key.pem 放进 ssl/ 目录，或设置 SSL_CERT / SSL_KEY 环境变量）');
    });
  }
})();
