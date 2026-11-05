'use strict';
// 第一分公司数据中台 —— 数据缓存与刷新编排

const fs = require('fs');
const path = require('path');
const fetcher = require('./wpsFetcher');
const cloudDb = require('./cloudDb');

const ROOT = path.join(__dirname, '..');
const CACHE_DIR = path.join(ROOT, 'data', 'cache');
const CACHE_FILE = path.join(CACHE_DIR, 'data.json');
const WPS_CONFIG = path.join(ROOT, 'config', 'wps.json');

function ensureDirs() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const imports = path.join(ROOT, 'data', 'imports');
  if (!fs.existsSync(imports)) fs.mkdirSync(imports, { recursive: true });
}

// 容器/云托管里通常没有 wps.json（数据以云库为准），缺失时返回 null 而不是抛错
function loadWpsConfig() {
  try {
    return JSON.parse(fs.readFileSync(WPS_CONFIG, 'utf8'));
  } catch (e) {
    return null;
  }
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
  if (!cfg || !cfg.modules) {
    // 没有 wps.json：云端部署的正常形态（数据走云数据库），跳过抓取，不算失败
    console.log('[refresh] 未找到 config/wps.json，跳过金山文档抓取（云端以云数据库为准）');
    return getModules();
  }
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

function laterOf(a, b) {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  if (!ta && !tb) return null;
  return new Date(Math.max(ta, tb)).toISOString();
}

// 云库优先、本地缓存兜底：云库存在的模块覆盖本地同名模块
async function getModulesMerged() {
  const local = readCache() || { updatedAt: null, modules: {} };
  let cloud = { modules: {}, updatedAt: null };
  if (cloudDb.isEnabled()) {
    try {
      cloud = await cloudDb.listModules();
    } catch (e) {
      console.error('[cloud] 读取云库失败，回退本地缓存：' + e.message);
    }
  }
  const modules = Object.assign({}, local.modules || {}, cloud.modules || {});
  delete modules.__probe__;
  return {
    updatedAt: laterOf(local.updatedAt, cloud.updatedAt),
    modules: modules,
    cloudModules: Object.keys(cloud.modules || {})
  };
}

module.exports = {
  refreshAll: refreshAll,
  getModules: getModules,
  getModulesMerged: getModulesMerged,
  readCache: readCache,
  writeCache: writeCache,
  loadWpsConfig: loadWpsConfig,
  ensureDirs: ensureDirs,
  CACHE_FILE: CACHE_FILE
};
