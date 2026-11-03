'use strict';
// 第一分公司数据中台 —— 取数适配器（可插拔）
// 支持三种来源：sample（示例）/ wps（金山文档共享表格）/ csv（本地导出）
// 当 wps 来源暂未配置或取数失败时，自动回退到 sample，保证网站始终可运行。

const fs = require('fs');
const path = require('path');
const sample = require('./sampleData');

const IMPORT_DIR = path.join(__dirname, '..', 'data', 'imports');

// ---- 简易 CSV 解析（支持引号包裹、逗号转义） ----
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

function csvToRows(modCfg) {
  const file = path.join(IMPORT_DIR, modCfg.csv || (modCfg.label + '.csv'));
  if (!fs.existsSync(file)) {
    console.warn('[csv] 文件不存在，回退示例数据: ' + file);
    return null;
  }
  const text = fs.readFileSync(file, 'utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(function (h) { return h.trim(); });
  const fm = modCfg.wps ? modCfg.wps.fieldMap || {} : {};
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = {};
    headers.forEach(function (h, idx) {
      // 通过 fieldMap 反查：输出字段 = 来源列
      let outKey = h;
      Object.keys(fm).forEach(function (k) { if (fm[k] === h) outKey = k; });
      r[outKey] = (rows[i][idx] || '').trim();
    });
    out.push(r);
  }
  return out;
}

// ---- WPS 共享表格取数（待接通） ----
// 说明：金山文档共享表格的自动取数需要以下任一方式，待你提供后在此实现：
//   1) WPS 开放平台「在线表格 / 智能表格(轻维表)」API：需 appKey/appSecret + 文件 fileId；
//   2) 共享链接 + 导出 token：调用金山文档内部导出接口（需登录态）。
// 当前先返回 null，由调用方回退到示例数据，并在控制台给出明确提示。
async function fetchWps(modCfg, globalCfg) {
  const w = modCfg.wps || {};
  if (!w.url && !(globalCfg && globalCfg.appKey)) {
    console.warn('[wps] 模块「' + modCfg.label + '」未配置 url/appKey，回退示例数据。请在 config/wps.json 填写。');
    return null;
  }
  try {
    // ===== 在此实现真实取数（示例骨架） =====
    // 方式A（开放平台）：
    //   const token = await getWpsToken(globalCfg.appKey, globalCfg.appSecret);
    //   const raw = await callWpsApi(token, w.url /* fileId */, w.sheet);
    //   return mapToModule(modCfg, raw);
    // 方式B（共享链接导出）：
    //   const raw = await fetch(w.url + '/export?format=csv').then(r=>r.text());
    //   return mapCsvToModule(modCfg, raw);
    console.warn('[wps] 真实取数逻辑待接入（模块「' + modCfg.label + '」）。当前返回示例数据。');
    return null;
  } catch (e) {
    console.error('[wps] 取数失败，回退示例: ' + e.message);
    return null;
  }
}

async function fetchModule(key, modCfg, globalCfg) {
  const src = (modCfg.source || 'sample').toLowerCase();
  if (src === 'csv') {
    const rows = csvToRows(modCfg);
    if (rows) return { rows: rows, updated: new Date().toISOString(), source: 'csv' };
    return sample.buildAll()[key];
  }
  if (src === 'wps') {
    const data = await fetchWps(modCfg, globalCfg);
    if (data) return data;
    return sample.buildAll()[key];
  }
  // 默认 sample
  return sample.buildAll()[key];
}

module.exports = { fetchModule: fetchModule, parseCsv: parseCsv };
