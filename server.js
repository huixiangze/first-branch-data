'use strict';
// 第一分公司数据中台 —— 后端服务（纯 Node，零依赖）
// 功能：登录门禁（屏蔽段）/ 静态资源 / 数据聚合接口 / 手动刷新 / 每20分钟自动取数

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const store = require('./src/store');
const cloudDb = require('./src/cloudDb');
const kdocsMeta = require('./src/kdocsMeta');
const fetcher = require('./src/wpsFetcher');
const accounts = require('./src/accounts');

const PORT = process.env.PORT || 8090;

// ---- 账号：由 src/accounts 统一管理（云库持久化 / 本地文件兜底 / 环境变量种子）----
const BASE_CFG = accounts.loadBaseConfig() || {};
const SECRET = BASE_CFG.sessionSecret || process.env.DP_SESSION_SECRET || 'default-secret';
const SESSION_HOURS = Number(BASE_CFG.sessionHours || 12);
if (!accounts.loadBaseConfig()) {
  console.error('[config] 未找到账号配置，且没有任何可用种子账号。');
  console.error('[config] 云托管请设置环境变量 DP_ADMIN_USER + DP_ADMIN_PASS，或用 DP_USERS_JSON 传整段 JSON；');
  console.error('[config] 本地开发可从 config/users.example.json 复制一份为 config/users.json。');
}

// ---- 启动自检：把「配置从哪来」打进日志，避免云端排查靠猜 ----
function logSelfCheck() {
  const st = accounts.stats();
  const names = accounts.all().map(function (x) { return x.username; }).join(', ');
  console.log('[config] 账号来源：' + accounts.storageMode() + '（' + st.total + ' 个账号：' + names + '）');
  console.log('[config] 会话密钥：' + (BASE_CFG.sessionSecret || process.env.DP_SESSION_SECRET ? '已设置' : '未设置，使用默认值（不安全）') +
    '；有效期 ' + SESSION_HOURS + ' 小时');
  const c = cloudDb.describe();
  if (c.enabled) {
    console.log('[cloud] 云数据库：已启用 · 来源 ' + c.source + ' · ' + c.endpoint + ' · 表 ' + c.table);
  } else {
    console.log('[cloud] 云数据库：未启用（来源 ' + c.source + '）→ 页面将没有数据。');
    console.log('[cloud] 请在环境变量里设置 DP_CLOUD_ENDPOINT + DP_CLOUD_KEY + DP_CLOUD_TABLE，或提供 config/cloud.json');
  }
}

// 按 CSV 表头识别“表型”，用于在上传时拦住传错的表（例如把商品明细传进主播榜单，覆盖掉正确数据）
function detectCsvShape(headers) {
  const h = (headers || []).join('|');
  if (/商品名称|卖家昵称|商品一级类目|卖家ID|商品二级类目/.test(h)) {
    return {
      type: 'commodity',
      label: '商品明细表（数据来源）',
      hint: '这类明细请用整本 xlsx 导入（放到「下载」文件夹由同步助手自动处理），页面上的「商品结构」页展示的就是它的聚合结果。'
    };
  }
  if (/直播日期|分成系数|主播ID|风控后结算GMV/.test(h) && !/预估结算GMV累计/.test(h)) {
    return {
      type: 'dailySheet',
      label: '单日明细表（1日 / 2日 …）',
      hint: '主播榜单要用「汇总」sheet：含 所属公司 / 主播名 / 下播GMV累计 / 预估结算GMV累计 / 结算率。单日明细属于「主播业绩」，不要传到这里。'
    };
  }
  if (/场次|开播时间|下播时间/.test(h) && !/所属公司|所属机构/.test(h)) {
    return { type: 'liveDetail', label: '场次明细表', hint: '该表不是主播汇总表，请改用含「主播名 / 所属公司 / 下播GMV」的汇总 sheet 导出的 CSV。' };
  }
  return null;
}

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

// 令牌有效 + 账号仍存在且未被停用，才算登录态（删号/停用立即失效）
function currentUser(req) {
  const username = verifyToken(getCookie(req, 'dp_token'));
  if (!username) return null;
  const u = accounts.find(username);
  if (!u || u.status !== 'active') return null;
  return u;
}

// ---- 同步状态（页面顶部「上次拉取时间」的数据源）----
const MODULE_LABELS = {
  home: '经营驾驶舱', anchorRank: '主播榜单', anchorPerformance: '主播业绩',
  commodity: '商品结构', forecast: '业绩预估', rongpin: '预估结算'
};

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

// 本机同步助手的拉取记录（云托管环境没有这个目录，返回 null 即可）
function readPullState() {
  const dir = path.join(os.homedir(), '.dp-sync');
  const st = readJsonSafe(path.join(dir, 'pull-state.json'));
  if (!st || !st.links) return null;
  const links = Object.keys(st.links).map(function (id) {
    const v = st.links[id] || {};
    return {
      id: id,
      name: v.name || id,
      at: v.at || null,
      fail: Number(v.fail || 0),
      error: v.lastError || ''
    };
  });
  const stamps = links.filter(function (l) { return l.at && !l.fail; })
    .map(function (l) { return new Date(l.at).getTime(); })
    .filter(function (t) { return t > 0; });
  return {
    dir: dir,
    at: stamps.length ? new Date(Math.max.apply(null, stamps)).toISOString() : null,
    links: links
  };
}

async function buildSyncReport() {
  const merged = await store.getModulesMerged();
  let times = {};
  if (cloudDb.isEnabled()) {
    try { times = await cloudDb.listTimes(); } catch (e) { times = {}; }
  }
  const cloudKeys = Object.keys(times);
  const mods = Object.keys(merged.modules || {}).filter(function (k) { return k.indexOf('__') !== 0; }).map(function (k) {
    const m = merged.modules[k] || {};
    if (!m || !Object.keys(m).length) return null;                    // 空模块（历史占位）不展示
    if (cloudKeys.length && cloudKeys.indexOf(k) < 0) return null;    // 只报云库里真实存在的模块
    return {
      module: k,
      label: MODULE_LABELS[k] || k,
      updatedAt: times[k] || null,
      asOf: m.asOf || null,
      source: m.source || null
    };
  }).filter(Boolean).sort(function (a, b) { return String(a.updatedAt || '').localeCompare(String(b.updatedAt || '')); });

  const seen = mods.map(function (x) { return x.updatedAt ? new Date(x.updatedAt).getTime() : 0; })
    .filter(function (t) { return t > 0; });
  const latest = seen.length ? new Date(Math.max.apply(null, seen)).toISOString() : null;

  // 本机同步助手上报的「检查心跳」：它每次拉取完都会写一条，即使内容没变。
  // 云端容器读不到本机的 pull-state.json，所以要靠这条记录才知道"刚才有没有拉过"。
  let hb = null;
  if (cloudDb.isEnabled()) {
    try { hb = await cloudDb.getModule('__sync'); } catch (e) { hb = null; }
  }

  const pull = readPullState();
  // 「上次检查」优先用心跳；没有心跳再退到本机 pull-state / 云库最后写入时间
  const checkAt = (hb && hb.at) ? hb.at : (pull && pull.at ? pull.at : null);
  const candidates = [latest, checkAt]
    .map(function (x) { return x ? new Date(x).getTime() : 0; })
    .filter(function (t) { return t > 0; });

  return {
    ok: true,
    now: new Date().toISOString(),
    lastCheckAt: checkAt,
    lastPullAt: candidates.length ? new Date(Math.max.apply(null, candidates)).toISOString() : null,
    latestWriteAt: latest,
    check: hb,
    pull: pull,
    modules: mods,
    cloudEnabled: cloudDb.isEnabled(),
    refreshMinutes: 20
  };
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
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(html);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // HTML 绝不缓存；JS/CSS 每次都要回源校验，避免浏览器/边缘节点拿旧脚本
    const cc = (ext === '.html') ? 'no-store' : 'no-cache, must-revalidate';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cc });
    res.end(data);
  });
}

// ---- 请求体解析 ----
function readBody(req) {
  return new Promise(function (resolve) {
    let body = '';
    req.on('data', function (c) { body += c; if (body.length > 20 * 1024 * 1024) req.destroy(); });
    req.on('end', function () { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve({}); } });
  });
}

function getCookie(req, name) {
  const ck = req.headers.cookie || '';
  const m = ck.match(new RegExp('(^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[2]) : null;
}
function getSessionUser(req) {
  const u = currentUser(req);
  return u ? u.username : null;
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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
    const r = accounts.verify(b.username, b.password);
    if (r && r.error) {
      sendJson(res, 403, { ok: false, error: r.error });
      return;
    }
    if (r && r.user) {
      noteLoginOk(ip);
      const u = r.user;
      const token = makeToken(u.username);
      accounts.markLogin(u.username);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': cookieHeader(token, SESSION_HOURS * 3600)
      });
      res.end(JSON.stringify({
        ok: true,
        user: { username: u.username, name: u.name, role: u.role, isAdmin: accounts.isAdmin(u) }
      }));
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
    const u = currentUser(req);
    sendJson(res, 200, {
      user: u ? { username: u.username, name: u.name, role: u.role, isAdmin: accounts.isAdmin(u) } : null
    });
    return;
  }

  // ===== 权限管理：账号列表与增删改（仅平台管理员）=====
  if (pathname === '/api/users' && req.method === 'GET') {
    const me = currentUser(req);
    if (!me) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    if (!accounts.isAdmin(me)) { sendJson(res, 403, { ok: false, error: '仅平台管理员可查看账号列表' }); return; }
    sendJson(res, 200, {
      ok: true,
      users: accounts.all().map(accounts.publicView),
      stats: accounts.stats(),
      storage: accounts.storageMode(),
      roles: accounts.roles(),
      me: me.username
    });
    return;
  }

  if (pathname === '/api/users' && req.method === 'POST') {
    const me = currentUser(req);
    if (!me) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    if (!accounts.isAdmin(me)) { sendJson(res, 403, { ok: false, error: '仅平台管理员可创建账号' }); return; }
    try {
      const b = await readBody(req);
      const u = await accounts.create(me, {
        username: b.username,
        name: b.name,
        password: b.password,
        role: b.role
      });
      sendJson(res, 200, { ok: true, user: u, stats: accounts.stats(), storage: accounts.storageMode() });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (pathname === '/api/users/update' && req.method === 'POST') {
    const me = currentUser(req);
    if (!me) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    if (!accounts.isAdmin(me)) { sendJson(res, 403, { ok: false, error: '仅平台管理员可修改账号' }); return; }
    try {
      const b = await readBody(req);
      const u = await accounts.update(me, {
        username: b.username,
        name: b.name,
        role: b.role,
        status: b.status,
        password: b.password
      });
      sendJson(res, 200, { ok: true, user: u, stats: accounts.stats() });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  if (pathname === '/api/users/delete' && req.method === 'POST') {
    const me = currentUser(req);
    if (!me) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    if (!accounts.isAdmin(me)) { sendJson(res, 403, { ok: false, error: '仅平台管理员可删除账号' }); return; }
    try {
      const b = await readBody(req);
      await accounts.remove(me, b.username);
      sendJson(res, 200, { ok: true, stats: accounts.stats() });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
    return;
  }

  // 本人修改密码（任何登录用户）
  if (pathname === '/api/users/password' && req.method === 'POST') {
    const me = currentUser(req);
    if (!me) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    try {
      const b = await readBody(req);
      await accounts.changeOwnPassword(me, b.oldPassword, b.newPassword);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: e.message });
    }
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
    const data = await store.getModulesMerged();
    sendJson(res, 200, data);
    return;
  }

  if (pathname === '/api/sync') {
    const username = getSessionUser(req);
    if (!username) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    try {
      sendJson(res, 200, await buildSyncReport());
    } catch (e) {
      sendJson(res, 200, { ok: false, error: e.message, modules: [] });
    }
    return;
  }

  if (pathname === '/api/freshness') {
    const username = getSessionUser(req);
    if (!username) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    try {
      const cfg = store.loadWpsConfig();
      let times = {};
      if (cloudDb.isEnabled()) {
        try { times = await cloudDb.listTimes(); } catch (e) { times = {}; }
      }
      const r = await kdocsMeta.checkFreshness(cfg, times);
      sendJson(res, 200, Object.assign({ ok: true }, r));
    } catch (e) {
      sendJson(res, 200, { ok: false, error: e.message, items: [] });
    }
    return;
  }

  if (pathname === '/api/refresh' && req.method === 'POST') {
    const username = getSessionUser(req);
    if (!username) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    const data = await store.refreshAll();
    sendJson(res, 200, { ok: true, updatedAt: data.updatedAt });
    return;
  }

  // 上传 CSV（登录后）：将导出的 WPS 表格写入 data/imports/<module>.csv 并刷新
  if (pathname === '/api/upload-csv' && req.method === 'POST') {
    const username = getSessionUser(req);
    if (!username) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    const b = await readBody(req);
    const moduleKey = String(b.module || '').trim();
    const cfg = store.loadWpsConfig();
    if (!moduleKey || !cfg.modules || !cfg.modules[moduleKey]) {
      sendJson(res, 400, { ok: false, error: '未知模块' }); return;
    }
    const content = String(b.content || '');
    if (!content.trim()) { sendJson(res, 400, { ok: false, error: '内容为空' }); return; }

    // —— 上传前先校验表头，防止把别的 sheet 传进来覆盖正确数据 ——
    const grid = fetcher.parseCsv(content.replace(/^\uFEFF/, ''));
    const csvHeaders = ((grid[0] || []).map(function (h) { return String(h || '').trim(); })).filter(Boolean);
    if (!csvHeaders.length) {
      sendJson(res, 400, { ok: false, error: 'CSV 表头为空，请确认导出时包含表头行。' });
      return;
    }
    const shape = detectCsvShape(csvHeaders);
    const modLabel = (cfg.modules[moduleKey] && cfg.modules[moduleKey].label) || moduleKey;
    // 单日明细表允许进「主播业绩」，其余一律拦截
    const shapeAllowed = shape && (shape.type === moduleKey || (shape.type === 'dailySheet' && moduleKey === 'anchorPerformance'));
    if (shape && !shapeAllowed) {
      sendJson(res, 400, {
        ok: false,
        detected: shape.type,
        headers: csvHeaders.slice(0, 6),
        error: '已拦截：这张表是「' + shape.label + '」，不属于「' + modLabel + '」。' +
          '为避免覆盖现有数据，本次没有写入。' + (shape.hint ? ' ' + shape.hint : '')
      });
      return;
    }
    const importsDir = path.join(ROOT, 'data', 'imports');
    fs.mkdirSync(importsDir, { recursive: true });
    const safeName = moduleKey.replace(/[^A-Za-z0-9_-]/g, '') + '.csv';
    try {
      // 先写临时文件试解析，校验通过再落到正式文件名，避免坏表污染本地 CSV
      const tmpName = '_upload_' + moduleKey + '.tmp.csv';
      fs.writeFileSync(path.join(importsDir, tmpName), '﻿' + content, 'utf8');
      const csvCfg = Object.assign({}, cfg.modules[moduleKey], { source: 'csv', csv: tmpName });
      const payload = await fetcher.fetchModule(moduleKey, csvCfg, cfg.wpsGlobal);
      const dropTmp = function () { try { fs.unlinkSync(path.join(importsDir, tmpName)); } catch (e) {} };

      if (!payload) { dropTmp(); sendJson(res, 400, { ok: false, error: 'CSV 解析后无有效数据，未写入。' }); return; }

      // 二次校验：主播类模块必须能识别出主播名，否则表型仍不对（如「复核」页）
      if (['anchorRank', 'anchorPerformance', 'rongpin'].indexOf(moduleKey) >= 0) {
        const rs = payload.rows || (payload.detail && payload.detail.rows) || [];
        const named = rs.filter(function (r) {
          const n = r && r.anchor ? String(r.anchor).trim() : '';
          return n && n !== '合计' && n !== '总计';
        }).length;
        if (!rs.length || named === 0) {
          dropTmp();
          sendJson(res, 400, {
            ok: false,
            error: '已拦截：这张表里没有识别到「主播名」列，不是「' + modLabel + '」需要的数据，未写入。'
          });
          return;
        }
      }

      fs.writeFileSync(path.join(importsDir, safeName), '﻿' + content, 'utf8');
      dropTmp();
      payload.source = 'cloud';
      let cloudOk = false, cloudErr = null;
      if (cloudDb.isEnabled()) {
        try { await cloudDb.upsertModule(moduleKey, payload); cloudOk = true; }
        catch (e) { cloudErr = e.message; }
      }
      // 同步刷新本地缓存（作为离线兜底，不阻塞响应）
      store.refreshAll().catch(function () {});
      const rowCount = (payload.rows && payload.rows.length) || (payload.rawRows && payload.rawRows.length) || 0;
      sendJson(res, 200, { ok: true, file: safeName, module: moduleKey, rows: rowCount, cloud: cloudOk, cloudError: cloudErr });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: '写入失败：' + e.message });
    }
    return;
  }

  // 云库模块清单（登录后）：供后台管理页展示
  if (pathname === '/api/cloud/modules' && req.method === 'GET') {
    const username = getSessionUser(req);
    if (!username) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    if (!cloudDb.isEnabled()) { sendJson(res, 200, { ok: true, enabled: false, modules: [] }); return; }
    try {
      const c = await cloudDb.listModules();
      const keys = Object.keys(c.modules || {}).filter(function (k) { return k.indexOf('__') !== 0; });
      const modules = keys.map(function (k) {
        const p = c.modules[k] || {};
        return {
          module: k,
          source: p.source || '',
          rows: (p.rows && p.rows.length) || (p.rawRows && p.rawRows.length) || 0
        };
      });
      sendJson(res, 200, { ok: true, enabled: true, updatedAt: c.updatedAt, modules: modules });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
    return;
  }

  // 重置某模块（登录后）：删除云库记录，回退到本地 CSV/示例
  if (pathname === '/api/cloud/reset' && req.method === 'POST') {
    const username = getSessionUser(req);
    if (!username) { sendJson(res, 401, { ok: false, error: '未登录' }); return; }
    const b = await readBody(req);
    const moduleKey = String(b.module || '').trim();
    if (!moduleKey) { sendJson(res, 400, { ok: false, error: '缺少模块' }); return; }
    try {
      if (cloudDb.isEnabled()) await cloudDb.deleteModule(moduleKey);
      sendJson(res, 200, { ok: true, module: moduleKey });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: e.message });
    }
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
  // 数据后台（云库模块管理）只对平台管理员开放
  if (pathname === '/admin.html' || pathname === '/admin') {
    const u = currentUser(req);
    if (!u || !accounts.isAdmin(u)) {
      res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
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
  try {
    await accounts.init(); // 账号表：云库为准，首次用配置种子初始化
  } catch (e) {
    console.error('[accounts] 初始化失败，服务继续启动：' + e.message);
  }
  try {
    await store.refreshAll(); // 启动时先取一次
  } catch (e) {
    console.error('[startup] 首次取数失败，服务继续启动：' + e.message);
  }
  const cfg = store.loadWpsConfig() || {};
  const minutes = (cfg.refreshMinutes || 20);

  logSelfCheck();
  setInterval(function () { store.refreshAll().catch(function (e) { console.error(e); }); }, minutes * 60 * 1000);

  const ssl = loadSslOptions();
  // 云托管/发布环境只会注入 PORT 并暴露单一端口，此时必须走 HTTP+PORT，
  // 不能用 443 证书模式，否则外部访问不到。
  const inCloud = !!process.env.PORT;
  if (ssl && !inCloud) {
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
