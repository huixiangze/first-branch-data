#!/usr/bin/env node
/**
 * 第一分公司数据云台 · 本地同步助手（零依赖）
 *
 * 作用：自动把「从金山文档导出的表格」送进云端数据库。
 *  你只需把表格下载/导出到监视目录（默认 Downloads 和 data/inbox），
 *  助手会自动：识别属于哪个模块 → 把 xlsx/csv 解析清洗成标准 CSV
 *             → 调 /api/upload-csv 写入云数据库 → 页面刷新即见真实数据。
 *
 * 用法：
 *   node sync-agent.js                  常驻监视（默认）
 *   node sync-agent.js --once           扫一次就退出
 *   node sync-agent.js --file a.xlsx --module forecast    手动指定文件与模块
 *   node sync-agent.js --status         查看已同步记录
 *
 * 配置文件：%USERPROFILE%\.dp-sync\config.json（首次运行自动生成）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const HOME = os.homedir();
const ROOT_DIR = path.join(__dirname, '..');
const CFG_DIR = path.join(HOME, '.dp-sync');
const CFG_FILE = path.join(CFG_DIR, 'config.json');
const STATE_FILE = path.join(CFG_DIR, 'state.json');
const LOG_FILE = path.join(CFG_DIR, 'sync.log');

const DEFAULT_CFG = {
  _说明: '第一分公司数据云台本地同步助手配置。routes 按顺序匹配文件名，命中即上传到对应模块。',
  server: 'https://shujuzhongtai2026-340768-12-1524191834.sh.run.tcloudbase.com',
  username: 'zhangxiaotong',
  password: '',
  pollSeconds: 15,
  watchDirs: [path.join(HOME, 'Downloads'), path.join(__dirname, '..', 'data', 'inbox')],
  routes: [
    { match: '预估结算|结算预估', module: 'rongpin' },
    { match: '售卖', module: 'anchorPerformance' },
    { match: '昨日结算|主播榜单|结算数据|主播.*结算', module: 'anchorRank' },
    { match: '业绩预估|预估.*业绩|业绩.*预估', module: 'forecast' }
  ],
  minDataRows: 3,
  maxUploadMB: 18
};

// ---------------------------------------------------------------- 日志
function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(CFG_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    }
    fs.appendFileSync(LOG_FILE, line + '\r\n', 'utf8');
  } catch (e) { /* 日志失败不影响主流程 */ }
}

// ---------------------------------------------------------------- 配置 / 状态
function loadConfig() {
  fs.mkdirSync(CFG_DIR, { recursive: true });
  if (!fs.existsSync(CFG_FILE)) {
    fs.writeFileSync(CFG_FILE, JSON.stringify(DEFAULT_CFG, null, 2), 'utf8');
    log('已生成配置文件：' + CFG_FILE);
  }
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  } catch (e) {
    throw new Error('配置文件不是合法 JSON：' + CFG_FILE + ' -> ' + e.message);
  }
  const merged = Object.assign({}, DEFAULT_CFG, cfg);
  merged.routes = cfg.routes && cfg.routes.length ? cfg.routes : DEFAULT_CFG.routes;
  merged.watchDirs = (merged.watchDirs || []).map((d) => path.resolve(d));
  return merged;
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return null; }
}
function saveState(st) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), 'utf8'); } catch (e) { log('状态写入失败：' + e.message); }
}

// ---------------------------------------------------------------- 通用工具
function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function colNum(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function numCol(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function isNumericCell(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return /^-?[\d,]+(?:\.\d+)?%?$/.test(s);
}
function textRatio(row) {
  const ne = row.filter((c) => String(c == null ? '' : c).trim() !== '');
  if (!ne.length) return 1;
  const num = ne.filter(isNumericCell).length;
  return 1 - num / ne.length;
}

// ---------------------------------------------------------------- ZIP / XLSX
function unzip(buf) {
  let eocd = -1;
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx/zip 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff) throw new Error('文件为 ZIP64 格式，暂不支持（请另存为普通 xlsx）');
  const entries = {};
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const fnLen = buf.readUInt16LE(p + 28);
    const exLen = buf.readUInt16LE(p + 30);
    const cmLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + fnLen);
    entries[name] = { method, csize, lho };
    p += 46 + fnLen + exLen + cmLen;
  }
  return {
    names: Object.keys(entries),
    has: (n) => Object.prototype.hasOwnProperty.call(entries, n),
    read(n) {
      const e = entries[n];
      if (!e) return null;
      const lfn = buf.readUInt16LE(e.lho + 26);
      const lex = buf.readUInt16LE(e.lho + 28);
      const start = e.lho + 30 + lfn + lex;
      const raw = buf.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) return zlib.inflateRawSync(raw);
      throw new Error('不支持的压缩方式 ' + e.method);
    }
  };
}

function parseSharedStrings(xml) {
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let txt = '';
    const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tre.exec(m[1]))) txt += decodeXml(t[1]);
    out.push(txt);
  }
  return out;
}

function parseSheetXml(xml, ss) {
  const rows = [];
  let maxc = 0;
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = {};
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cRe.exec(rm[1]))) {
      const attrs = cm[1] || '';
      const inner = cm[2] || '';
      const rAttr = /\br="([A-Z]+)\d+"/.exec(attrs);
      if (!rAttr) continue;
      const col = colNum(rAttr[1]);
      const tAttr = /\bt="([^"]+)"/.exec(attrs);
      const t = tAttr ? tAttr[1] : '';
      let val = '';
      if (t === 's') {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if (v) { const idx = parseInt(v[1], 10); val = ss[idx] !== undefined ? ss[idx] : ''; }
      } else if (t === 'inlineStr') {
        let txt = '';
        const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tt;
        while ((tt = tre.exec(inner))) txt += decodeXml(tt[1]);
        val = txt;
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        val = v ? (t === 'str' ? decodeXml(v[1]) : v[1]) : '';
      }
      cells[col] = val;
      if (col > maxc) maxc = col;
    }
    rows.push(cells);
  }
  return rows.map((c) => {
    const arr = new Array(maxc).fill('');
    for (const k of Object.keys(c)) arr[Number(k) - 1] = c[k];
    return arr;
  });
}

function pickSheet(z, wantName) {
  let sheetPath = null;
  let sheetName = '';
  try {
    const wb = z.read('xl/workbook.xml').toString('utf8');
    const rels = z.read('xl/_rels/workbook.xml.rels').toString('utf8');
    const relMap = {};
    const rre = /<Relationship\b([^>]*)\/?>/g;
    let r;
    while ((r = rre.exec(rels))) {
      const id = /\bId="([^"]+)"/.exec(r[1]);
      const tg = /\bTarget="([^"]+)"/.exec(r[1]);
      if (id && tg) relMap[id[1]] = tg[1];
    }
    const sheets = [];
    const sre = /<sheet\b([^>]*)\/?>/g;
    let s;
    while ((s = sre.exec(wb))) {
      const nm = /\bname="([^"]*)"/.exec(s[1]);
      const rid = /\br:id="([^"]+)"/.exec(s[1]);
      if (rid && relMap[rid[1]]) {
        let tg = relMap[rid[1]];
        if (!tg.startsWith('xl/')) tg = 'xl/' + tg.replace(/^\//, '');
        sheets.push({ name: nm ? decodeXml(nm[1]) : '', path: tg });
      }
    }
    if (sheets.length) {
      const hit = wantName ? sheets.find((x) => x.name && x.name.indexOf(wantName) >= 0) : null;
      const pick = hit || sheets[0];
      sheetPath = pick.path;
      sheetName = pick.name;
    }
  } catch (e) { /* 回退到按文件名猜 */ }
  if (!sheetPath || !z.has(sheetPath)) {
    const cand = z.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
    if (!cand.length) throw new Error('xlsx 中找不到工作表');
    sheetPath = cand[0];
    sheetName = sheetName || '(第一个工作表)';
  }
  return { sheetPath, sheetName };
}

function readXlsx(buf, wantSheet) {
  const z = unzip(buf);
  const ss = z.has('xl/sharedStrings.xml') ? parseSharedStrings(z.read('xl/sharedStrings.xml').toString('utf8')) : [];
  const { sheetPath, sheetName } = pickSheet(z, wantSheet);
  const rows = parseSheetXml(z.read(sheetPath).toString('utf8'), ss);
  return { rows, sheetName };
}

// ---------------------------------------------------------------- CSV
function decodeText(buf) {
  let s = buf.toString('utf8');
  if (s.indexOf('\uFFFD') >= 0) {
    try { s = new TextDecoder('gbk').decode(buf); } catch (e) { /* 保持 utf8 结果 */ }
  }
  return s.replace(/^\uFEFF/, '');
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQ = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  row.push(field);
  rows.push(row);
  return rows;
}
function csvCell(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

// ---------------------------------------------------------------- 清洗
// 找"表头块"与"数据区"的分界：从数据区整体看，若已有足够比例整列都是数值，说明从这一行起是数据
function findHeaderSplit(rows) {
  const limit = Math.min(8, rows.length - 1);
  for (let j = 1; j <= limit; j++) {
    const data = rows.slice(j);
    if (!data.length) break;
    const ncol = data.reduce((m, r) => Math.max(m, r.length), 0);
    let numericCols = 0;
    let usedCols = 0;
    for (let c = 0; c < ncol; c++) {
      const vals = data.map((r) => (r[c] || '').trim()).filter((v) => v !== '');
      if (!vals.length) continue;
      usedCols++;
      if (vals.every(isNumericCell)) numericCols++;
    }
    if (usedCols && numericCols / usedCols >= 0.3) return j;
  }
  return -1;
}

function cleanRows(raw) {
  const rows = raw
    .map((r) => (r || []).map((c) => (c == null ? '' : String(c).trim())))
    .filter((r) => r.some((c) => c !== ''));
  if (rows.length < 2) return { rows: [], reason: '有效行不足' };

  const split = findHeaderSplit(rows);
  let headerBlock;
  let data;
  if (split > 0) {
    headerBlock = rows.slice(0, split);
    data = rows.slice(split);
  } else {
    headerBlock = [rows[0]];
    data = rows.slice(1);
  }
  if (headerBlock.length > 3) headerBlock = headerBlock.slice(-3);
  // 表头块里只有 1~2 个非空单元格的多半是报表标题行，丢掉
  const trimmed = headerBlock.filter((r) => {
    const ne = r.filter((c) => c !== '').length;
    return !(headerBlock.length > 1 && ne <= 2);
  });
  if (trimmed.length) headerBlock = trimmed;
  else headerBlock = [rows[Math.max(0, (split > 0 ? split : 1) - 1)]];

  const ncol = Math.max(...rows.map((r) => r.length), headerBlock[0].length);
  const names = [];
  for (let i = 0; i < ncol; i++) {
    const parts = [];
    for (const h of headerBlock) {
      const v = (h[i] || '').trim();
      if (v && parts.indexOf(v) < 0) parts.push(v);
    }
    names.push(parts.join('·'));
  }
  const out = [];
  const keep = [];
  for (let i = 0; i < ncol; i++) {
    const colVals = data.map((r) => r[i] || '');
    const hasVal = colVals.some((v) => v !== '');
    if (!names[i] && !hasVal) continue;
    keep.push(i);
    if (!names[i]) names[i] = '列' + (i + 1);
  }
  out.push(keep.map((i) => names[i]));
  for (const r of data) {
    const line = keep.map((i) => r[i] || '');
    if (line.some((v) => v !== '')) out.push(line);
  }
  return { rows: out, header: out[0], dataRows: out.length - 1 };
}

// ---------------------------------------------------------------- HTTP
function request(urlStr, opts, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      timeout: opts.timeout || 45000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时（' + (opts.timeout || 45000) + 'ms）')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function login(cfg) {
  if (!cfg.password) throw new Error('配置里没有填 password（' + CFG_FILE + '）');
  const payload = JSON.stringify({ username: cfg.username, password: cfg.password });
  const r = await request(cfg.server.replace(/\/+$/, '') + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' },
    timeout: 30000
  }, payload);
  if (r.status !== 200) throw new Error('登录失败 HTTP ' + r.status + ' ' + r.body.slice(0, 160));
  const sc = r.headers['set-cookie'];
  if (!sc || !sc.length) throw new Error('登录成功但没拿到会话 cookie');
  return sc.map((c) => c.split(';')[0]).join('; ');
}

async function uploadModule(cfg, cookie, module, content) {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > cfg.maxUploadMB * 1024 * 1024) {
    throw new Error('内容过大（' + (bytes / 1048576).toFixed(1) + 'MB，上限 ' + cfg.maxUploadMB + 'MB），请在导出时只保留需要的 sheet/列');
  }
  const payload = JSON.stringify({ module, content });
  const r = await request(cfg.server.replace(/\/+$/, '') + '/api/upload-csv', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Cookie': cookie,
      'Cache-Control': 'no-store'
    },
    timeout: 90000
  }, payload);
  let j = null;
  try { j = JSON.parse(r.body); } catch (e) { /* ignore */ }
  if (r.status !== 200 || !j || !j.ok) {
    throw new Error('上传失败 HTTP ' + r.status + ' ' + r.body.slice(0, 200));
  }
  return j;
}

// ---------------------------------------------------------------- 模块匹配
function matchModule(cfg, filename) {
  for (const r of cfg.routes) {
    try {
      if (new RegExp(r.match, 'i').test(filename)) return r.module;
    } catch (e) { /* 正则写错就跳过 */ }
  }
  return null;
}

// ---------------------------------------------------------------- 处理单个文件
// 这几类模块的数据源是一整本多工作表工作簿（汇总 / 数据来源 / 1日 / 2日 …），
// 单表解析会丢信息，所以改走 import_workbook.py + push_bundle.js 全量导入。
const WORKBOOK_MODULES = { anchorRank: true };

function runCmd(cmd, args) {
  return new Promise(function (resolve, reject) {
    const child = spawn(cmd, args, { cwd: ROOT_DIR, windowsHide: true });
    let out = '';
    child.stdout.on('data', function (d) { out += d.toString(); });
    child.stderr.on('data', function (d) { out += d.toString(); });
    child.on('error', function (e) { reject(new Error('无法执行 ' + cmd + '：' + e.message)); });
    child.on('close', function (code) {
      if (code === 0) resolve(out);
      else reject(new Error(cmd + ' 退出码 ' + code + '：' + out.slice(-500)));
    });
  });
}

async function importWorkbook(file) {
  const py = process.env.PYTHON || 'python';
  const bundle = path.join(ROOT_DIR, 'data', 'imports', 'bundle.json');
  const out1 = await runCmd(py, [path.join(ROOT_DIR, 'scripts', 'import_workbook.py'), file, bundle]);
  String(out1).trim().split('\n').forEach(function (l) { if (l.trim()) log('  ' + l.trim()); });
  const out2 = await runCmd(process.execPath, [path.join(ROOT_DIR, 'scripts', 'push_bundle.js'), bundle]);
  String(out2).trim().split('\n').forEach(function (l) { if (l.trim()) log('  ' + l.trim()); });
  return { rows: 'workbook', cols: 67 };
}

async function processFile(cfg, cookie, file, module, opts) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  log('发现待同步文件：' + path.basename(file) + '（' + (stat.size / 1024).toFixed(0) + 'KB，模块=' + module + '）');

  if (ext !== '.csv' && WORKBOOK_MODULES[module]) {
    log('  整本工作簿导入：汇总 / 数据来源 / 1日 / 2日 全部解析');
    if (opts.dry) {
      log('  [演练] 将执行 import_workbook.py → push_bundle.js（主播榜单·商品结构·首页·主播业绩）');
      return { rows: 0, cols: 0, dry: true };
    }
    return await importWorkbook(file);
  }

  let raw;
  if (ext === '.xls') {
    throw new Error('不支持老式 .xls，请在金山文档里导出为 CSV 或 xlsx');
  }
  if (ext === '.csv') {
    raw = parseCsv(decodeText(fs.readFileSync(file)));
  } else {
    const buf = fs.readFileSync(file);
    if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
      const out = readXlsx(buf, opts.sheetName);
      raw = out.rows;
      if (out.sheetName) log('  使用工作表：' + out.sheetName);
    } else {
      // 扩展名是 csv 但内容其实是 Excel 的情况，这里也兜住
      raw = parseCsv(decodeText(buf));
    }
  }

  const cleaned = cleanRows(raw);
  if (!cleaned.rows.length || cleaned.dataRows < cfg.minDataRows) {
    throw new Error('解析后有效数据只有 ' + cleaned.dataRows + ' 行（阈值 ' + cfg.minDataRows + '），已跳过以免覆盖云端好数据');
  }
  if (opts.dry) {
    log('  [演练] 行=' + cleaned.dataRows + ' 列=' + cleaned.header.length);
    log('  [演练] 表头：' + cleaned.header.slice(0, 12).join(' | ') + (cleaned.header.length > 12 ? ' ...' : ''));
    log('  [演练] 首行：' + (cleaned.rows[1] || []).slice(0, 8).join(' | '));
    return { rows: cleaned.dataRows, cols: cleaned.header.length, dry: true };
  }
  const content = toCsv(cleaned.rows);
  const res = await uploadModule(cfg, cookie, module, content);
  log('  ✅ 已写入云库：模块=' + module + ' 行=' + res.rows + ' 列=' + cleaned.header.length + ' 云端=' + (res.cloud ? '是' : '否'));
  if (res.cloudError) log('  ⚠️ 云库写入告警：' + res.cloudError);
  return { rows: res.rows, cols: cleaned.header.length };
}

// ---------------------------------------------------------------- 扫描
function listFiles(dirs) {
  const out = [];
  for (const d of dirs) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (!e.isFile()) continue;
      if (e.name.startsWith('~$') || e.name.startsWith('.')) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (['.csv', '.xlsx', '.xlsm', '.xls'].indexOf(ext) < 0) continue;
      out.push(path.join(d, e.name));
    }
  }
  return out;
}

async function scanOnce(cfg, state, opts) {
  const files = listFiles(cfg.watchDirs);
  if (!state.seen) state.seen = {};
  let pending = [];
  for (const f of files) {
    const st0 = (() => { try { return fs.statSync(f); } catch (e) { return null; } })();
    if (!st0) continue;
    const module = matchModule(cfg, path.basename(f));
    if (!module) {
      const rec0 = state.seen[f];
      if (!rec0 || rec0.size !== st0.size || rec0.mtimeMs !== st0.mtimeMs) {
        state.seen[f] = { size: st0.size, mtimeMs: st0.mtimeMs, unmatched: true, at: new Date().toISOString() };
        if (!opts.baseline && (Date.now() - st0.mtimeMs) < 24 * 3600 * 1000) {
          log('⚠️ 文件名没匹配到模块，已跳过：' + path.basename(f));
          log('   改名带上关键词即可自动归类（业绩预估 / 主播结算 / 售卖 / 预估结算），或用 --file 手动指定模块。');
        }
      }
      continue;
    }
    let st;
    try { st = fs.statSync(f); } catch (e) { continue; }
    const rec = state.seen[f];
    if (rec && rec.size === st.size && rec.mtimeMs === st.mtimeMs) continue;
    pending.push({ file: f, module, size: st.size, mtimeMs: st.mtimeMs });
  }
  if (!pending.length) return 0;

  if (opts.baseline) {
    for (const p of pending) {
      state.seen[p.file] = { size: p.size, mtimeMs: p.mtimeMs, module: p.module, skipped: 'baseline', at: new Date().toISOString() };
    }
    saveState(state);
    log('首次运行：已把 ' + pending.length + ' 个已有文件记为基线（不自动上传）。之后再导出/下载的文件才会自动同步。');
    return 0;
  }

  let cookie = null;
  let okCount = 0;
  for (const p of pending) {
    try {
      if (!cookie) cookie = await login(cfg);
      await processFile(cfg, cookie, p.file, p.module, opts);
      state.seen[p.file] = { size: p.size, mtimeMs: p.mtimeMs, module: p.module, ok: true, at: new Date().toISOString() };
      saveState(state);
      okCount++;
    } catch (e) {
      log('  ❌ ' + path.basename(p.file) + ' 同步失败：' + e.message);
      if (/登录失败|没拿到会话 cookie/.test(e.message)) cookie = null;
      state.seen[p.file] = { size: p.size, mtimeMs: p.mtimeMs, module: p.module, ok: false, error: e.message, at: new Date().toISOString() };
      saveState(state);
    }
  }
  return okCount;
}

// ---------------------------------------------------------------- 主流程
async function main() {
  const argv = process.argv.slice(2);
  const opts = {
    once: argv.indexOf('--once') >= 0,
    status: argv.indexOf('--status') >= 0,
    dry: argv.indexOf('--dry') >= 0,
    baseline: false,
    sheetName: null
  };
  const fi = argv.indexOf('--file');
  const mi = argv.indexOf('--module');
  const si = argv.indexOf('--sheet');

  const cfg = loadConfig();
  if (si >= 0 && argv[si + 1]) opts.sheetName = argv[si + 1];

  if (opts.status) {
    const st = loadState() || {};
    const recs = Object.entries(st.seen || {});
    if (!recs.length) { console.log('还没有同步记录。'); return; }
    console.log('已同步记录（最近 20 条）：');
    recs.sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 20).forEach(([f, r]) => {
      console.log(`  [${r.ok ? '成功' : (r.skipped || '失败')}] ${path.basename(f)} -> ${r.module}  ${r.at}${r.error ? '  ' + r.error : ''}`);
    });
    return;
  }

  log('=== 数据同步助手启动 ===');
  log('服务器：' + cfg.server);
  log('监视目录：' + cfg.watchDirs.join(' | '));
  log('模块规则：' + cfg.routes.map((r) => r.module + '<-' + r.match).join('  '));

  if (fi >= 0) {
    const file = path.resolve(argv[fi + 1] || '');
    if (!fs.existsSync(file)) throw new Error('文件不存在：' + file);
    const module = (mi >= 0 && argv[mi + 1]) ? argv[mi + 1] : matchModule(cfg, path.basename(file));
    if (!module) throw new Error('无法从文件名判断模块，请用 --module 指定（可填 forecast / anchorRank / anchorPerformance / rongpin）');
    const cookie = opts.dry ? null : await login(cfg);
    await processFile(cfg, cookie, file, module, opts);
    log('=== 完成 ===');
    return;
  }

  let state = loadState();
  let firstRun = false;
  if (!state) { state = { seen: {} }; firstRun = true; }
  if (firstRun) opts.baseline = true;

  await scanOnce(cfg, state, opts);
  opts.baseline = false;

  if (opts.once) {
    const n = await scanOnce(cfg, state, opts);
    log(n ? '本次同步 ' + n + ' 个文件' : '没有新的可同步文件');
    return;
  }

  log('已进入自动监视，每 ' + cfg.pollSeconds + ' 秒检查一次（关闭窗口即停止）');
  let busy = false;
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await scanOnce(cfg, state, opts); } catch (e) { log('扫描异常：' + e.message); }
    busy = false;
  }, Math.max(5, cfg.pollSeconds) * 1000);

  // 定时拉取：按 pull.links 检查金山文档是否有更新，有更新才下载并同步
  const links = (cfg.pull && cfg.pull.links) || [];
  if (!links.length) {
    log('未配置 pull.links，只监视本地文件夹（不做链接拉取）');
    return;
  }
  const intervalMin = Math.max(5, Number(cfg.pull.intervalMinutes) || 10);
  const pullScript = path.join(__dirname, 'pull-kdocs.js');
  let pulling = false;
  const runPull = function () {
    if (pulling) return;
    pulling = true;
    const child = spawn(process.execPath, [pullScript], { stdio: 'inherit' });
    const next = function (code) {
      pulling = false;
      if (code) log('拉取器退出码 ' + code + '（详见 ' + path.join(CFG_DIR, 'pull.log') + '）');
      setTimeout(runPull, intervalMin * 60000);
    };
    child.on('exit', next);
    child.on('error', function (e) { log('拉取器启动失败：' + e.message); next(-1); });
  };
  log('已启用链接定时拉取：每 ' + intervalMin + ' 分钟检查一次更新（' + links.length + ' 个链接）');
  setTimeout(runPull, 4000);
}

main().catch((e) => {
  log('启动失败：' + e.message);
  process.exitCode = 1;
});
