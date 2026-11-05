'use strict';
// 第一分公司数据中台 —— 云数据库客户端（WorkBuddy 托管 · PostgREST 数据面）
//
// 说明：
//   - 云库为 PostgreSQL + PostgREST。鉴权头为 x-wb-webapp-access-key: <publishableKey>
//     （这是官方 SDK 使用的头，服务端调用无需浏览器 Origin / 无需云登录）。
//   - 表结构：dashboard_module(module text PK, payload jsonb, updated_at timestamptz)
//   - 仅服务端使用；publishableKey 不下发前端。

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');

const CFG_PATH = path.join(__dirname, '..', 'config', 'cloud.json');
let _cfg = null;
let _src = '未配置';

function loadConfig() {
  if (_cfg) return _cfg;

  // 1) 整段 JSON（云托管环境变量里直接放）
  const inline = process.env.DP_CLOUD_JSON;
  if (inline && inline.trim()) {
    try {
      _cfg = JSON.parse(inline);
      _src = '环境变量 DP_CLOUD_JSON';
      return _cfg;
    } catch (e) {
      console.error('[cloud] 环境变量 DP_CLOUD_JSON 不是合法 JSON：' + e.message);
    }
  }

  // 2) 本地文件（开发机）
  try {
    _cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
    _src = 'config/cloud.json';
  } catch (e) {
    _cfg = { enabled: false };
    _src = '未配置';
  }

  // 3) 零散环境变量覆盖（控制台逐个填更省事）
  if (process.env.DP_CLOUD_ENDPOINT && process.env.DP_CLOUD_KEY) {
    _cfg = Object.assign({}, _cfg, {
      enabled: true,
      endpoint: process.env.DP_CLOUD_ENDPOINT,
      publishableKey: process.env.DP_CLOUD_KEY,
      table: process.env.DP_CLOUD_TABLE || _cfg.table || 'dashboard_module'
    });
    _src = '环境变量 DP_CLOUD_ENDPOINT / DP_CLOUD_KEY';
  }

  return _cfg;
}

// 启动自检用：不泄露密钥，只报来源与目标
function describe() {
  const c = loadConfig();
  return {
    enabled: isEnabled(),
    source: _src,
    endpoint: c.endpoint || '',
    table: c.table || '',
    hasKey: !!c.publishableKey
  };
}

function isEnabled() {
  const c = loadConfig();
  return !!(c && c.enabled && c.endpoint && c.publishableKey && c.table);
}

function request(method, query, body, extraHeaders) {
  const c = loadConfig();
  if (!isEnabled()) return Promise.reject(new Error('云数据库未配置或已关闭'));
  const base = String(c.endpoint).replace(/\/+$/, '');
  const rest = base + '/.cloud/database/rest/' + c.table + (query || '');
  const parsed = url.parse(rest);
  const isHttps = parsed.protocol === 'https:';
  const lib = isHttps ? https : http;
  const payload = body != null ? JSON.stringify(body) : null;

  const headers = Object.assign({
    'x-wb-webapp-access-key': c.publishableKey,
    'Accept': 'application/json'
  }, extraHeaders || {});
  if (payload != null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise(function (resolve, reject) {
    const req = lib.request({
      method: method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.path,
      headers: headers
    }, function (res) {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        let json = null;
        if (data) { try { json = JSON.parse(data); } catch (e) { json = data; } }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(json);
        } else {
          const msg = (typeof json === 'object' && json && (json.message || json.error_description || json.error)) || String(data).slice(0, 200);
          reject(new Error('云库请求失败 HTTP ' + res.statusCode + '：' + msg));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(Number(c.timeoutMs) || 20000, function () { req.destroy(new Error('云库请求超时')); });
    if (payload != null) req.write(payload);
    req.end();
  });
}

// 读取全部模块：{ modules: { key: payload }, updatedAt: ISO }
async function listModules() {
  const rows = await request('GET', '?select=module,payload,updated_at');
  const modules = {};
  let latest = null;
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || !r.module) return;
    modules[r.module] = r.payload;
    if (r.updated_at) {
      const t = new Date(r.updated_at).getTime();
      if (!latest || t > latest) latest = t;
    }
  });
  return {
    modules: modules,
    updatedAt: latest ? new Date(latest).toISOString() : null
  };
}

// 写入/覆盖单个模块（upsert by module 主键）
async function upsertModule(module, payload) {
  const body = {
    module: module,
    payload: payload,
    updated_at: new Date().toISOString()
  };
  return request('POST', '?on_conflict=module', body, {
    'Prefer': 'resolution=merge-duplicates,return=representation'
  });
}

// 只取单个模块的 payload（轻量，不把整库拉下来）
async function getModule(module) {
  const rows = await request('GET', '?select=payload&module=eq.' + encodeURIComponent(module) + '&limit=1');
  const r = Array.isArray(rows) ? rows[0] : null;
  return r ? r.payload : null;
}

// 删除单个模块（回退到本地数据）
async function deleteModule(module) {
  return request('DELETE', '?module=eq.' + encodeURIComponent(module));
}

// 只取各模块的更新时间（轻量，用于新鲜度判断）：{ module: ISO }
async function listTimes() {
  const rows = await request('GET', '?select=module,updated_at');
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (r && r.module && r.updated_at) out[r.module] = r.updated_at;
  });
  return out;
}

module.exports = {
  isEnabled: isEnabled,
  describe: describe,
  loadConfig: loadConfig,
  listModules: listModules,
  listTimes: listTimes,
  upsertModule: upsertModule,
  getModule: getModule,
  deleteModule: deleteModule
};
