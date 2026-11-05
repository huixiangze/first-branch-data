'use strict';
// 第一分公司数据中台 —— 取数适配器（可插拔）
// 支持三种来源：
//   sample（示例数据）/ csv（本地导出文件）/ wps（金山文档共享表格 · 通过 WPS 开放平台 v7 API 读取）
//
// WPS 读取流程（零依赖，仅用内置 https 模块）：
//   1) 取令牌：POST https://openapi.wps.cn/oauth2/token  (client_credentials: appId + appKey)
//   2) 分享链接 -> file_id：GET /v7/links/{link_id}/meta
//   3) 枚举工作表：GET /v7/sheets/{file_id}/worksheets
//   4) 按矩形区域读单元格：GET /v7/sheets/{file_id}/worksheets/{sheet_id}/range_data
// 以上均需要 WPS 开放平台的应用凭证（appId/appKey）。未配置凭证或读取失败时，自动回退 sample。

const https = require('https');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const sample = require('./sampleData');

const IMPORT_DIR = path.join(__dirname, '..', 'data', 'imports');

// ---------------------------------------------------------------------------
// 通用 HTTP 请求（零依赖，支持跟随重定向）
// ---------------------------------------------------------------------------
function httpRequest(method, urlStr, opts) {
  opts = opts || {};
  const headers = opts.headers || {};
  const body = opts.body || null;
  return new Promise(function (resolve, reject) {
    function doReq(u, redirects) {
      if (redirects > 5) { reject(new Error('重定向次数过多')); return; }
      const parsed = url.parse(u);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;
      const reqOpts = {
        method: method,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.path,
        headers: headers
      };
      const req = lib.request(reqOpts, function (res) {
        const status = res.statusCode;
        if (status === 301 || status === 302 || status === 307 || status === 308) {
          const loc = res.headers.location;
          if (!loc) { reject(new Error('重定向但无 Location')); return; }
          const next = url.resolve(u, loc);
          res.resume();
          doReq(next, redirects + 1);
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { data += c; });
        res.on('end', function () {
          let json = null;
          try { json = JSON.parse(data); } catch (e) { json = null; }
          resolve({ status: status, body: data, json: json });
        });
      });
      req.on('error', function (e) { reject(e); });
      req.setTimeout(25000, function () { req.destroy(new Error('请求超时')); });
      if (body) req.write(body);
      req.end();
    }
    doReq(urlStr, 0);
  });
}

// ---------------------------------------------------------------------------
// 令牌管理（带缓存，2 小时有效）
// ---------------------------------------------------------------------------
let tokenCache = { token: null, exp: 0 };
async function getAccessToken(globalCfg) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.exp > now + 60000) return tokenCache.token;
  // 优先使用环境变量（CloudBase 等平台注入，避免把密钥写进镜像/仓库）
  const env = process.env;
  const accessToken = env.WPS_ACCESS_TOKEN || globalCfg.accessToken;
  const appId = env.WPS_APP_ID || globalCfg.appId || '';
  const appKey = env.WPS_APP_KEY || globalCfg.appKey || '';
  if (accessToken) { tokenCache = { token: accessToken, exp: now + 3600 * 1000 }; return accessToken; }
  if (!appId || !appKey) return null;
  const apiBase = globalCfg.apiBase || 'https://openapi.wps.cn';
  const tokenUrl = (globalCfg.tokenUrl || apiBase + '/oauth2/token');
  const scope = globalCfg.scope || 'kso.file_link.readwrite kso.sheets.read kso.file.read';
  const postBody = 'grant_type=client_credentials&client_id=' + encodeURIComponent(appId) + '&client_secret=' + encodeURIComponent(appKey) + '&scope=' + encodeURIComponent(scope);
  const res = await httpRequest('POST', tokenUrl, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: postBody
  });
  // 兼容 POST 表单与上送 JSON 两种；部分环境要求 JSON
  let json = res.json;
  if (!json || (!json.access_token && json.result !== 0 && !json.token)) {
    // 重试为 JSON 形式
    const res2 = await httpRequest('POST', tokenUrl, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_id: appId, client_secret: appKey })
    });
    json = res2.json;
  }
  if (!json) throw new Error('获取 WPS 令牌失败：无响应');
  const token = json.access_token || (json.token && json.token.access_token);
  if (!token) throw new Error('获取 WPS 令牌失败：' + (json.msg || JSON.stringify(json).slice(0, 200)));
  const expires = (json.expires_in || 7200) * 1000;
  tokenCache = { token: token, exp: now + expires * 1000 };
  return token;
}

// ---------------------------------------------------------------------------
// file_id 解析缓存
// ---------------------------------------------------------------------------
const fileIdCache = {};
async function resolveFileId(linkId, token, globalCfg) {
  if (fileIdCache[linkId]) return fileIdCache[linkId];
  const apiBase = globalCfg.apiBase || 'https://openapi.wps.cn';
  const res = await httpRequest('GET', apiBase + '/v7/links/' + encodeURIComponent(linkId) + '/meta', {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
  const j = res.json;
  if (!j) throw new Error('解析分享链接失败：无响应');
  const fid = j.data && (j.data.file_id || j.data.fileId);
  if (!fid) throw new Error('解析分享链接失败：' + (j.msg || JSON.stringify(j).slice(0, 200)));
  fileIdCache[linkId] = String(fid);
  return fileIdCache[linkId];
}

async function getWorksheets(fileId, token, globalCfg) {
  const apiBase = globalCfg.apiBase || 'https://openapi.wps.cn';
  const res = await httpRequest('GET', apiBase + '/v7/sheets/' + encodeURIComponent(fileId) + '/worksheets', {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
  });
  const j = res.json;
  if (!j || j.code !== 0) throw new Error('枚举工作表失败：' + (j && j.msg || JSON.stringify(j).slice(0, 200)));
  return (j.data && j.data.sheets) || [];
}

async function readRange(fileId, sheetId, token, globalCfg, rowTo, colTo) {
  rowTo = rowTo || 2000; colTo = colTo || 80;
  const apiBase = globalCfg.apiBase || 'https://openapi.wps.cn';
  const base = apiBase + '/v7/sheets/' + encodeURIComponent(fileId) + '/worksheets/' + encodeURIComponent(sheetId);
  // 方法一：GET range_data（按矩形区域读，传统表格 et）
  try {
    const q = 'row_from=0&row_to=' + rowTo + '&col_from=0&col_to=' + colTo;
    const res = await httpRequest('GET', base + '/range_data?' + q, {
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    });
    const j = res.json;
    if (j && j.code === 0 && j.data) return j.data;
  } catch (e) { /* 落到方法二 */ }
  // 方法二：POST range_data/find（官方文档推荐的读单元格方式）
  const res2 = await httpRequest('POST', base + '/range_data/find', {
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      range: { row_from: 0, row_to: rowTo, col_from: 0, col_to: colTo },
      filter: { condition: [], search: [], duplicates: { col: [] } }
    })
  });
  const j2 = res2.json;
  if (!j2 || j2.code !== 0) throw new Error('读取单元格失败：' + (j2 && j2.msg || JSON.stringify(j2).slice(0, 200)));
  return j2.data;
}

// ---------------------------------------------------------------------------
// 单元格 -> 行列数据
// ---------------------------------------------------------------------------
function cellText(c) {
  if (c == null) return '';
  if (typeof c === 'object') {
    if (c.display != null && c.display !== '') return String(c.display);
    if (c.value != null && c.value !== '') return String(c.value);
    if (c.v != null) return String(c.v);
    return '';
  }
  return String(c);
}

function parseRangeToRows(data) {
  if (!data) return { headers: [], rows: [] };
  // 兼容多种返回结构
  let grid = data.range_data && data.range_data.values;
  if (!grid) grid = data.values;
  if (!grid || !Array.isArray(grid) || grid.length === 0) return { headers: [], rows: [] };
  // 找到第一个非空行作为表头（跳过纯空行）
  let headerIdx = 0;
  while (headerIdx < grid.length && grid[headerIdx].every(function (c) { return cellText(c).trim() === ''; })) headerIdx++;
  if (headerIdx >= grid.length) return { headers: [], rows: [] };
  const headers = grid[headerIdx].map(function (c) { return cellText(c).trim(); });
  const rows = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const line = grid[i];
    const obj = {};
    let empty = true;
    headers.forEach(function (h, idx) {
      const v = cellText(line[idx]);
      if (v !== '') empty = false;
      obj[h] = v;
    });
    if (!empty) rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

// ---------------------------------------------------------------------------
// 字段映射：把 WPS 真实表头 -> 模块规范字段
// ---------------------------------------------------------------------------
function buildHeaderMap(actualHeaders, fieldMap) {
  const map = {};
  Object.keys(fieldMap || {}).forEach(function (canonical) {
    const want = String(fieldMap[canonical]).trim();
    if (!want) return;
    // 精确匹配
    let hit = actualHeaders.find(function (h) { return h === want; });
    if (!hit) {
      const w = want.toLowerCase().replace(/\s/g, '');
      hit = actualHeaders.find(function (h) { return h.toLowerCase().replace(/\s/g, '') === w; });
    }
    // 包含匹配（忽略空格与大小写）
    if (!hit) {
      const w = want.toLowerCase().replace(/\s/g, '');
      hit = actualHeaders.find(function (h) { return h.toLowerCase().replace(/\s/g, '').indexOf(w) >= 0; });
    }
    if (hit) map[canonical] = hit;
  });
  return map;
}

function mapRows(rawHeaders, rawRows, fieldMap) {
  const hm = buildHeaderMap(rawHeaders, fieldMap);
  return rawRows.map(function (r) {
    const o = {};
    Object.keys(hm).forEach(function (canonical) {
      const v = r[hm[canonical]];
      o[canonical] = (v == null ? '' : String(v).trim());
    });
    return o;
  });
}

function num(v) { const n = parseFloat(String(v).replace(/[,，\s%]/g, '')); return isNaN(n) ? 0 : n; }

// ---------------------------------------------------------------------------
// 按模块把规范行转换为前端需要的对象
// ---------------------------------------------------------------------------
function moneyStr(n) {
  n = Number(n) || 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 把「汇总」表按真实列名装配成前端需要的结构（含汇总指标与排名）
// rm(rowMap) 形如 { anchor:'主播名', org:'所属公司', type:'主播类型', gmv:'下播GMV', gmvCum:'下播GMV累计', settleCum:'预估结算GMV累计', rate:'结算率' }
function buildAnchorRankRows(rawHeaders, rawRows, rm) {
  const idx = {};
  (rawHeaders || []).forEach(function (h) { idx[h] = true; });
  const get = function (row, name) {
    if (!name || !idx[name]) return '';
    const v = row[name];
    return v == null ? '' : String(v).trim();
  };
  const dayCols = [], rateCols = [];
  rawHeaders.forEach(function (h) {
    let m = /(\d{1,2})日结算率$/.exec(h);
    if (m) { rateCols.push({ h: h, d: parseInt(m[1], 10) }); return; }
    m = /(\d{1,2})日$/.exec(h);
    if (m) dayCols.push({ h: h, d: parseInt(m[1], 10) });
  });
  dayCols.sort(function (a, b) { return a.d - b.d; });
  rateCols.sort(function (a, b) { return a.d - b.d; });

  // 结算率有时是 0.394 小数、有时是 39.4 —— 统一成百分数
  const normRate = function (v) {
    let x = num(v);
    if (x > 0 && x <= 1.5) x = x * 100;
    return Math.round(x * 100) / 100;
  };

  const list = [];
  (rawRows || []).forEach(function (r) {
    const name = get(r, rm.anchor);
    if (!name || name === '合计' || name === '总计' || name === '主播名') return;
    list.push({
      anchor: name,
      org: get(r, rm.org),
      type: get(r, rm.type),
      gmv: moneyStr(num(get(r, rm.gmv))),
      gmvCum: moneyStr(num(get(r, rm.gmvCum))),
      settleCum: moneyStr(num(get(r, rm.settleCum))),
      rate: normRate(get(r, rm.rate)),
      daily: dayCols.map(function (c) { return Math.round(num(get(r, c.h)) * 100) / 100; }),
      rateDaily: rateCols.map(function (c) { return Math.round(num(get(r, c.h)) * 100) / 100; })
    });
  });

  list.slice().sort(function (a, b) { return num(b.gmvCum) - num(a.gmvCum); })
    .forEach(function (r, i) { r.rank = i + 1; });

  const sum = function (k) { return list.reduce(function (s, r) { return s + num(r[k]); }, 0); };
  const r2 = function (n) { return Math.round(n * 100) / 100; };
  const gmvToday = r2(sum('gmv')), gmvCum = r2(sum('gmvCum')), settleCum = r2(sum('settleCum'));
  const rates = list.map(function (r) { return r.rate; }).filter(function (v) { return v > 0; });
  const avgRate = rates.length
    ? Math.round(rates.reduce(function (a, b) { return a + b; }, 0) / rates.length * 100) / 100 : 0;
  const calcRate = gmvCum ? Math.round(settleCum / gmvCum * 10000) / 100 : 0;

  const t = new Date();
  return {
    _source: 'csv',
    source: 'csv',
    updated: t.toISOString(),
    asOf: t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2),
    rows: list,
    summary: {
      anchors: list.length, gmvToday: gmvToday, gmvCum: gmvCum,
      settleCum: settleCum, avgRate: avgRate, calcRate: calcRate
    }
  };
}

function transformModule(key, rawHeaders, rawRows, modCfg) {
  const fm = (modCfg.wps && modCfg.wps.fieldMap) || {};
  const rows = mapRows(rawHeaders, rawRows, fm);
  const out = { _source: 'wps', updated: new Date().toISOString() };

  if (key === 'anchorRank') {
    if (modCfg.rowMap) return buildAnchorRankRows(rawHeaders, rawRows, modCfg.rowMap);
    out.rows = rows.map(function (r, i) {
      return {
        anchor: r.anchor || '', org: r.org || '', category: r.category || '',
        gmv: r.gmv || '', avg: r.avg || '', target: r.target || '',
        rate: r.rate || '', aov: r.aov || '', rank: r.rank || (i + 1)
      };
    });
    return out;
  }

  if (key === 'forecast') {
    out.months = rows.map(function (r) {
      return {
        month: r.month || '',
        est: r.est || '',
        actual: r.actual || '',
        confidence: r.confidence || ''
      };
    });
    let est = 0, actual = 0, conf = 0, n = 0;
    out.months.forEach(function (m) { est += num(m.est); actual += num(m.actual); conf += num(m.confidence); n++; });
    out.summary = { est: n ? Math.round(est * 10) / 10 : '-', actual: n ? Math.round(actual * 10) / 10 : '-', confidence: n ? Math.round(conf / n) : '-' };
    return out;
  }

  if (key === 'anchorPerformance') {
    const det = rows.map(function (r) {
      const est = num(r.est), actual = num(r.actual);
      const diff = Math.round((actual - est) * 10) / 10;
      const diffRate = est ? Math.round((diff / est) * 1000) / 10 : 0;
      const status = diff >= 0 ? '已完成' : '未达标';
      return {
        date: r.date || '', anchor: r.anchor || '', est: r.est || '', actual: r.actual || '',
        diff: String(diff), diffRate: String(diffRate), status: status, tag: r.tag || '否'
      };
    });
    let totEst = 0, totAct = 0; det.forEach(function (r) { totEst += num(r.est); totAct += num(r.actual); });
    out.kpis = [
      { title: '主播数', value: det.length, unit: '人', sub: '参与主播', trend: 'flat' },
      { title: '总预估', value: Math.round(totEst * 10) / 10, unit: '万', sub: '预估合计', trend: 'flat' },
      { title: '总实际', value: Math.round(totAct * 10) / 10, unit: '万', sub: '实际合计', trend: totAct >= totEst ? 'up' : 'down' }
    ];
    // 按品类聚合
    const cats = {};
    det.forEach(function (r) { const c = r.category || '未分类'; cats[c] = cats[c] || { count: 0, amount: 0 }; cats[c].count++; cats[c].amount += num(r.est); });
    out.categories = Object.keys(cats).map(function (c) {
      return { name: c, count: cats[c].count, amount: Math.round(cats[c].amount * 10) / 10 + '万', tag: 'blue' };
    });
    out.detail = { rows: det };
    return out;
  }

  if (key === 'rongpin') {
    const dist = rows.map(function (r) {
      const gmv = num(r.gmv), commission = num(r.commission);
      return {
        anchor: r.anchor || '', gmv: r.gmv || '', commission: r.commission || '',
        dept: r.dept || '', growth: r.growth || ''
      };
    });
    let totGmv = 0, totComm = 0; dist.forEach(function (r) { totGmv += num(r.gmv); totComm += num(r.commission); });
    out.kpis = [
      { title: '分销主播', value: dist.length, unit: '人', sub: '参与分销', trend: 'flat' },
      { title: '总GMV', value: Math.round(totGmv * 10) / 10, unit: '万', sub: '直播间GMV', trend: 'up' },
      { title: '总佣金', value: Math.round(totComm * 10) / 10, unit: '万', sub: '预估佣金', trend: 'up' }
    ];
    // 预估结算 GMV 对比（按主播 Top）
    out.settlement = dist.slice().sort(function (a, b) { return num(b.gmv) - num(a.gmv); }).slice(0, 8)
      .map(function (r) { return { label: r.anchor, value: num(r.gmv), color: '#2f6fed' }; });
    // 完成度：若原始含 完成度/rate 列则使用，否则不生成（避免伪数据）
    const hm = buildHeaderMap(rawHeaders, fm);
    if (hm.rate) {
      out.completion = dist.map(function (r) { return { label: r.anchor, value: num(r.rate), color: '#2bbf7a' }; });
    } else {
      out.completion = [];
    }
    out.distribution = dist;
    return out;
  }

  // 其它模块：默认直接给 rows（前端若有表格视图即可用）
  out.rows = rows;
  return out;
}

// ---------------------------------------------------------------------------
// 读取单个 WPS 模块
// ---------------------------------------------------------------------------
async function fetchWps(key, modCfg, globalCfg) {
  const w = modCfg.wps || {};
  const link = w.url || '';
  if (!link) { console.warn('[wps] 模块「' + modCfg.label + '」未配置 wps.url，回退示例。'); return null; }
  const linkId = String(link).replace(/^https?:\/\//, '').split('/').filter(function (p) { return p; }).pop();
  if (!linkId) { console.warn('[wps] 模块「' + modCfg.label + '」链接无法解析 link_id。'); return null; }
  try {
    const token = await getAccessToken(globalCfg);
    if (!token) { console.warn('[wps] 未配置 WPS 凭证（appId/appKey 或 accessToken），回退示例数据。'); return null; }
    const fileId = await resolveFileId(linkId, token, globalCfg);
    const sheets = await getWorksheets(fileId, token, globalCfg);
    if (!sheets.length) throw new Error('该文件无工作表');
    // 选择工作表：优先 fieldMap 指定的 sheet 名，否则第一个
    let sheetId = sheets[0].sheet_id;
    if (w.sheet) {
      const hit = sheets.find(function (s) { return (s.name || '') === w.sheet; });
      if (hit) sheetId = hit.sheet_id;
    }
    const data = await readRange(fileId, sheetId, token, globalCfg);
    const parsed = parseRangeToRows(data);
    if (!parsed.rows.length) { console.warn('[wps] 模块「' + modCfg.label + '」读取到 0 行数据，回退示例。'); return null; }
    console.log('[wps] 模块「' + modCfg.label + '」读取成功：' + parsed.rows.length + ' 行，表头 ' + JSON.stringify(parsed.headers));
    return transformModule(key, parsed.headers, parsed.rows, modCfg);
  } catch (e) {
    console.error('[wps] 模块「' + modCfg.label + '」读取失败，回退示例：' + e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CSV（本地导出）：保留以支持离线/手动兜底
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function csvToRaw(modCfg) {
  const file = path.join(IMPORT_DIR, modCfg.csv || (modCfg.label + '.csv'));
  if (!fs.existsSync(file)) {
    return null;
  }
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const grid = parseCsv(text);
  if (grid.length < 2) return null;
  const headers = grid[0].map(function (h) { return h.trim(); });
  const rows = [];
  for (let i = 1; i < grid.length; i++) {
    const r = {};
    headers.forEach(function (h, idx) { r[h] = (grid[i][idx] || '').trim(); });
    rows.push(r);
  }
  return { headers: headers, rows: rows };
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------
async function fetchModule(key, modCfg, globalCfg) {
  const src = (modCfg.source || 'sample').toLowerCase();
  const fallbackToSample = function () { return sample.buildAll()[key]; };
  // 本地 CSV 导出（手动兜底：零依赖、立即可用，无需 WPS 高级版）
  const fromCsv = function () {
    const raw = csvToRaw(modCfg);
    if (!raw) return null;
    const t = transformModule(key, raw.headers, raw.rows, modCfg);
    t.rawHeaders = raw.headers;
    t.rawRows = raw.rows;
    t.source = 'csv';
    t.updated = new Date().toISOString();
    return t;
  };
  if (src === 'csv') {
    const t = fromCsv();
    return t || fallbackToSample();
  }
  if (src === 'wps') {
    const data = await fetchWps(key, modCfg, globalCfg);
    if (data) { data.source = 'wps'; return data; }
    // WPS 读取失败（如未开通高级版能力 / 链接已关闭）-> 尝试本地 CSV 兜底
    const t = fromCsv();
    if (t) return t;
    return fallbackToSample();
  }
  return fallbackToSample();
}

// 供诊断脚本使用
async function diagnoseModule(key, modCfg, globalCfg) {
  const w = modCfg.wps || {};
  const link = w.url || '';
  const linkId = String(link).replace(/^https?:\/\//, '').split('/').filter(function (p) { return p; }).pop();
  const token = await getAccessToken(globalCfg);
  if (!token) return { key: key, error: '无凭证' };
  const fileId = await resolveFileId(linkId, token, globalCfg);
  const sheets = await getWorksheets(fileId, token, globalCfg);
  const first = sheets[0];
  let headers = [], sampleRows = [];
  if (first) {
    const data = await readRange(fileId, first.sheet_id, token, globalCfg, 10, 60);
    const parsed = parseRangeToRows(data);
    headers = parsed.headers; sampleRows = parsed.rows.slice(0, 3);
  }
  return { key: key, fileId: fileId, sheets: sheets.map(function (s) { return s.name; }), headers: headers, sampleRows: sampleRows };
}

module.exports = { fetchModule: fetchModule, parseCsv: parseCsv, diagnoseModule: diagnoseModule, transformModule: transformModule, buildAnchorRankRows: buildAnchorRankRows };
