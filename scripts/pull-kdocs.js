#!/usr/bin/env node
/**
 * 第一分公司数据云台 · 定时拉取器（零依赖）
 *
 * 两步走，既及时又省流量：
 *   1) 用金山文档公开的分享元数据接口（约 0.5KB）比对 mtime/fver/fsha，判断表格是否真的更新；
 *   2) 确认更新后，用你本机已登录的浏览器打开下载地址，浏览器把文件下载下来，
 *      再交给 sync-agent 解析 → 清洗 → 写入云数据库。页面 60 秒内自动刷新。
 *
 * 用法：
 *   node pull-kdocs.js              正常一轮（供定时任务调用）
 *   node pull-kdocs.js --force      忽略"是否更新"判断，强制拉取一次
 *   node pull-kdocs.js --test       只处理第一个链接，详细输出
 *   node pull-kdocs.js --check      只查元数据，不下文件（验证链接是否可用）
 *   node pull-kdocs.js --list       查看配置
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const HOME = os.homedir();
const CFG_FILE = path.join(HOME, '.dp-sync', 'config.json');
const STATE_FILE = path.join(HOME, '.dp-sync', 'pull-state.json');
const LOG_FILE = path.join(HOME, '.dp-sync', 'pull.log');
const INBOX = path.resolve(__dirname, '..', 'data', 'inbox');
const ARCHIVE = path.join(INBOX, 'archive');

function ts() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    fs.appendFileSync(LOG_FILE, line + '\r\n', 'utf8');
  } catch (e) { /* ignore */ }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHEET_EXT = ['.csv', '.xlsx', '.xlsm'];

function loadCfg() {
  if (!fs.existsSync(CFG_FILE)) throw new Error('缺少配置文件：' + CFG_FILE);
  const cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  cfg.watchDirs = (cfg.watchDirs || [path.join(HOME, 'Downloads')]).map((d) => path.resolve(d));
  cfg.pull = Object.assign({ waitSeconds: 180, sizeLimitMB: 600, links: [] }, cfg.pull || {});
  return cfg;
}
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return { links: {} }; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8'); } catch (e) { log('状态写入失败：' + e.message); }
}

// 记录失败次数：同一链接连续失败 3 次后自动暂停，避免反复弹浏览器窗口
function markFail(state, id, msg) {
  if (!state.links) state.links = {};
  const rec = state.links[id] || {};
  rec.fail = (rec.fail || 0) + 1;
  rec.lastError = msg;
  rec.at = new Date().toISOString();
  state.links[id] = rec;
  saveState(state);
  if (rec.fail >= 3) log('  该链接已连续失败 ' + rec.fail + ' 次，自动暂停；修好后运行 测试拉取.bat 或加 --force 重试。');
}

function httpGet(url, timeout) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': 'application/json' },
      timeout: timeout || 20000
    }, (res) => {
      const buf = [];
      res.on('data', (c) => buf.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(buf).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('元数据请求超时')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchMeta(sid) {
  const r = await httpGet('https://drive.kdocs.cn/api/v5/links/' + encodeURIComponent(sid) + '?t=' + Date.now());
  if (r.status !== 200) throw new Error('元数据 HTTP ' + r.status);
  const j = JSON.parse(r.body);
  if (!j || j.result !== 'ok') throw new Error('元数据返回异常：' + r.body.slice(0, 120));
  const fi = j.fileinfo || {};
  const li = j.linkinfo || {};
  if (li.status && li.status !== 'open') throw new Error('分享链接已关闭（status=' + li.status + '）');
  return {
    fname: fi.fname || '',
    fsize: fi.fsize || 0,
    mtime: fi.mtime || 0,
    fver: fi.fver || 0,
    fsha: fi.fsha || '',
    status: li.status || '',
    downloadAllowed: (j.user_acl && j.user_acl.download) ? true : false
  };
}
function fmtTime(unix) {
  if (!unix) return '-';
  const d = new Date(unix * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function snapshot(dirs) {
  const map = {};
  for (const d of dirs) {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of ents) {
      if (!e.isFile()) continue;
      if (SHEET_EXT.indexOf(path.extname(e.name).toLowerCase()) < 0) continue;
      const full = path.join(d, e.name);
      try { const st = fs.statSync(full); map[full] = { size: st.size, mtimeMs: st.mtimeMs }; } catch (err) { /* ignore */ }
    }
  }
  return map;
}

function openInBrowser(url) {
  const child = spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => log('  ⚠️ 无法唤起浏览器：' + e.message));
  child.unref();
}

async function waitForDownload(dirs, before, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(2500);
    const now = snapshot(dirs);
    for (const full of Object.keys(now)) {
      const st = now[full];
      const old = before[full];
      if (old && old.size === st.size && old.mtimeMs === st.mtimeMs) continue;
      const dir = path.dirname(full);
      const base = path.basename(full);
      let pending = false;
      try {
        pending = fs.readdirSync(dir).some((n) => n !== base && n.indexOf(base) === 0 && (n.endsWith('.crdownload') || n.endsWith('.part')));
      } catch (e) { /* ignore */ }
      if (pending) continue;
      if (last && last.full === full && last.size === st.size) return { full, size: st.size };
      last = { full, size: st.size };
      break;
    }
  }
  return null;
}

function runSyncAgent(file, module) {
  const args = [path.join(__dirname, 'sync-agent.js'), '--file', file];
  if (module) args.push('--module', module);
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  return r.status === 0;
}

function archiveFile(file) {  try {
    fs.mkdirSync(ARCHIVE, { recursive: true });
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    fs.renameSync(file, path.join(ARCHIVE, `${stamp}_${path.basename(file)}`));
    return true;
  } catch (e) { log('  归档失败（不影响数据）：' + e.message); return false; }
}

function candidateUrls(link) {
  const out = [];
  if (link.url) out.push(link.url);
  if (link.fileid) {
    out.push('https://www.kdocs.cn/api/v3/office/file/' + link.fileid + '/download?isblocks=false');
    out.push('https://www.kdocs.cn/api/v3/office/file/' + link.fileid + '/download?isblocks=false&support_checksum=1');
    out.push('https://drive.kdocs.cn/api/v3/office/file/' + link.fileid + '/download?isblocks=false');
  }
  return out.filter((v, i) => out.indexOf(v) === i);
}

async function handleLink(cfg, state, link, opts) {
  const name = link.label || link.module || link.sid;
  if (!link.sid && !link.fileid) { log('⚠️ 链接缺少 sid/fileid，跳过：' + name); return false; }

  // 1) 先查元数据（匿名、极轻量）
  let meta = null;
  if (link.sid) {
    try {
      meta = await fetchMeta(link.sid);
    } catch (e) {
      log('⚠️ ' + name + ' 元数据查询失败：' + e.message);
      if (!opts.force) return false;
    }
  }

  let key = (meta && meta.fsha) ? ('v' + meta.fver + ':' + meta.mtime + ':' + meta.fsha) : null;
  if (meta) {
    log('· ' + name + ' ｜' + meta.fname + ' ｜' + (meta.fsize / 1048576).toFixed(1) + 'MB ｜最后修改 ' + fmtTime(meta.mtime));
    if (opts.check) return true;
  }

  const id = link.sid || link.fileid;
  const prev = (state.links && state.links[id]) || null;
  if (!opts.force && prev && prev.fail >= 3) {
    log('  ⏸ 该链接已暂停（连续失败 ' + prev.fail + ' 次：' + (prev.lastError || '') + '）');
    log('     修好后运行 测试拉取.bat 即可恢复。');
    return false;
  }
  if (!opts.force && key && prev && prev.key === key) {
    log('  内容无变化，跳过下载');
    return true;
  }
  if (meta && meta.fsize / 1048576 > cfg.pull.sizeLimitMB) {
    log('  ❌ 文件 ' + (meta.fsize / 1048576).toFixed(0) + 'MB 超过上限 ' + cfg.pull.sizeLimitMB + 'MB');
    log('     建议在金山文档里改用「导出为 CSV」（只导出需要的那个工作表），体积会小很多。');
    if (key) { state.links[id] = { key, skipped: 'too-large', at: new Date().toISOString() }; saveState(state); }
    markFail(state, id, 'too-large');
    return false;
  }

  // 2) 用浏览器会话下载（多候选地址，优先用上次成功过的那个）
  let cands = candidateUrls(link);
  if (!cands.length) { log('  ❌ 没有可用的下载地址（缺 fileid/url）'); return false; }
  if (prev && prev.goodUrl) {
    cands = [prev.goodUrl].concat(cands.filter((u) => u !== prev.goodUrl));
  }
  log('  检测到更新，准备下载（最多尝试 ' + cands.length + ' 个地址）');

  let got = null;
  let usedUrl = null;
  for (const u of cands) {
    log('  → 打开：' + u);
    const before = snapshot(cfg.watchDirs);
    openInBrowser(u);
    const wait = Math.min(cfg.pull.waitSeconds, 90);
    log('    等待文件落地（最多 ' + wait + ' 秒）…');
    got = await waitForDownload(cfg.watchDirs, before, wait);
    if (got) { usedUrl = u; break; }
    log('    · 这个地址没有触发下载，换下一个');
  }
  if (!got) {
    log('  ❌ 所有下载地址都没能触发下载。排查顺序：');
    log('     1) Edge 里金山文档是否仍登录（在该浏览器打开一次表格确认）；');
    log('     2) Edge 设置→下载 是否开着"每次下载都询问保存位置"（需关闭）；');
    log('     3) 该下载地址在你账号下是否被禁止下载（元数据 user_acl.download）。');
    markFail(state, id, 'no-download');
    return false;
  }
  const mb = got.size / 1048576;
  log('  ✅ 已下载：' + path.basename(got.full) + '（' + mb.toFixed(1) + 'MB）');
  if (mb > cfg.pull.sizeLimitMB) {
    log('  ❌ 超过体积上限，未上传，文件保留在下载目录');
    markFail(state, id, 'too-large-after-download');
    return false;
  }

  // 3) 交给同步助手解析并写云库
  const ok = runSyncAgent(got.full, link.module);
  if (ok) {
    archiveFile(got.full);
    if (key) { state.links[id] = { key, at: new Date().toISOString(), name: meta ? meta.fname : path.basename(got.full), goodUrl: usedUrl }; saveState(state); }
    else { state.links[id] = { at: new Date().toISOString(), goodUrl: usedUrl }; saveState(state); }
    log('  ✔ 完成：' + name + ' 已更新到云端，页面 60 秒内自动刷新');
  } else {
    markFail(state, id, 'sync-failed');
  }
  return ok;
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = {
    force: argv.indexOf('--force') >= 0,
    test: argv.indexOf('--test') >= 0,
    check: argv.indexOf('--check') >= 0,
    list: argv.indexOf('--list') >= 0
  };
  const cfg = loadCfg();
  let links = (cfg.pull && cfg.pull.links) || [];

  if (opts.list) {
    console.log('配置中的拉取链接（' + links.length + ' 条）：');
    links.forEach((l, i) => console.log(`  ${i + 1}. [${l.module || '?'}] ${l.label || ''} sid=${l.sid || '-'} fileid=${l.fileid || '-'}`));
    if (!links.length) console.log('  （空）请编辑 ' + CFG_FILE + ' 的 pull.links');
    return;
  }
  if (!links.length) { log('❌ 没有配置 pull.links：' + CFG_FILE); return; }
  if (opts.test) links = links.slice(0, 1);

  const state = loadState();
  if (!state.links) state.links = {};
  log('=== 拉取开始（' + links.length + ' 个链接' + (opts.check ? '，仅检查元数据' : '') + '）===');

  let okCount = 0;
  for (const l of links) {
    try { if (await handleLink(cfg, state, l, opts)) okCount++; }
    catch (e) { log('  ❌ 处理异常：' + e.message); }
  }
  saveState(state);
  state.lastRunAt = new Date().toISOString();
  log('=== 结束：成功 ' + okCount + '/' + links.length + ' ===');
}

main().catch((e) => { log('启动失败：' + e.message); process.exitCode = 1; });
