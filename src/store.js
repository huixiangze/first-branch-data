'use strict';
// 第一分公司数据中台 —— 数据缓存与刷新编排

const fs = require('fs');
const path = require('path');
const fetcher = require('./wpsFetcher');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'data.json');
const WPS_CONFIG = path.join(ROOT, 'config', 'wps.json');

function ensureDirs() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const imports = path.join(ROOT, 'data', 'imports');
  if (!fs.existsSync(imports)) fs.mkdirSync(imports, { recursive: true });
}

function loadWpsConfig() {
  return JSON.parse(fs.readFileSync(WPS_CONFIG, 'utf8'));
}

function readCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return null;
}

function writeCache(obj) {
  ensureDirs();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

async function refreshAll() {
  const cfg = loadWpsConfig();
  const modules = {};
  for (const key of Object.keys(cfg.modules)) {
    try {
      modules[key] = await fetcher.fetchModule(key, cfg.modules[key], cfg.wpsGlobal);
    } catch (e) {
      console.error('[refresh] 模块 ' + key + ' 异常: ' + e.message);
      modules[key] = null;
    }
  }
  const out = { updatedAt: new Date().toISOString(), modules: modules };
  try { writeCache(out); }
  catch (e) { console.error('[refresh] 缓存写入失败（不影响运行）：' + e.message); }
  console.log('[refresh] 数据已刷新，更新时间 ' + out.updatedAt);
  return out;
}

function getModules() {
  return readCache() || { updatedAt: null, modules: {} };
}

module.exports = {
  refreshAll: refreshAll,
  getModules: getModules,
  readCache: readCache,
  writeCache: writeCache,
  loadWpsConfig: loadWpsConfig,
  ensureDirs: ensureDirs,
  CACHE_FILE: CACHE_FILE
};
