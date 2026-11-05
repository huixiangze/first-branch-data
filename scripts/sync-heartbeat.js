'use strict';
/**
 * 拉取心跳上报（零依赖）
 *
 * 为什么需要它：
 *   页面部署在云端，它读不到本机的 ~/.dp-sync/pull-state.json，只能看到
 *   「云库最后一次写入时间」。而拉取器判断"源文档没变"时会跳过上传，
 *   于是云端时间一直不动 —— 看起来像"点了立即同步没反应"。
 *
 * 做法：
 *   每次拉取检查结束（无论是否真的写入数据），把「检查时间 + 每个链接的结果」
 *   写进云库的一行特殊记录 module = "__sync"。云端页面读它就知道：
 *   刚才有没有拉、拉到什么、为什么没更新。
 *
 * 这一行不参与业务模块展示（server 端 store.js 会过滤掉）。
 */

const cloudDb = require('../src/cloudDb');

const KEY = '__sync';
const MAX_HISTORY = 12;

function nowISO() { return new Date().toISOString(); }

/**
 * 上报一次检查结果。
 * @param {object} entry
 * @param {string} entry.status  written | unchanged | partial | failed
 * @param {Array}  entry.results [{ label, status, detail, at }]
 * @param {string} [entry.trigger] schedule | manual | watcher
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
async function report(entry) {
  if (!cloudDb.isEnabled()) return { ok: false, reason: '云库未配置，心跳未上报' };

  const payload = {
    at: nowISO(),
    status: entry.status || 'unknown',
    trigger: entry.trigger || 'schedule',
    results: Array.isArray(entry.results) ? entry.results.slice(0, 10) : [],
    by: '本机同步助手'
  };

  // 保留最近若干次记录，方便在面板里回看"到底跑了没"
  let prev = null;
  try { prev = await cloudDb.getModule(KEY); } catch (e) { prev = null; }
  const history = (prev && Array.isArray(prev.history)) ? prev.history.slice(0, MAX_HISTORY - 1) : [];
  payload.history = [{ at: payload.at, status: payload.status, trigger: payload.trigger }].concat(history);

  try {
    await cloudDb.upsertModule(KEY, payload);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/** 由多个链接结果推导整体状态 */
function summarize(results) {
  const list = results || [];
  if (!list.length) return 'unknown';
  const writtenN = list.filter(function (r) { return r.status === 'written'; }).length;
  const goodN = list.filter(function (r) { return r.status === 'written' || r.status === 'unchanged'; }).length;
  const badN = list.filter(function (r) { return r.status === 'failed' || r.status === 'paused'; }).length;
  if (writtenN) return badN ? 'partial' : 'written';
  if (goodN && badN) return 'partial';
  if (goodN) return 'unchanged';
  return 'failed';
}

module.exports = { report: report, summarize: summarize, KEY: KEY };
