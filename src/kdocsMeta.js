'use strict';
/**
 * 金山文档「链接元数据」探测（匿名可读，不需要登录）。
 * 用途：低成本判断云文档是否被改动，从而提示页面数据是否已过期。
 *   GET https://drive.kdocs.cn/api/v5/links/{sid}
 * 返回 fileinfo.mtime（秒）、fver、fsize、linkinfo.status 等。
 */
const https = require('https');

const TTL_MS = 5 * 60 * 1000; // 元数据缓存 5 分钟，避免频繁打对方接口
const cache = new Map(); // sid -> { at, data }

function httpGetJson(url, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'Accept': 'application/json,text/plain,*/*'
      }
    }, function (res) {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        if (res.statusCode !== 200) {
          return reject(new Error('HTTP ' + res.statusCode));
        }
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('返回非 JSON')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, function () { req.destroy(new Error('超时')); });
  });
}

function parseSid(url) {
  if (!url) return null;
  const m = String(url).match(/\/l\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** 取单个链接的元数据（带缓存） */
async function getMeta(sid) {
  if (!sid) return { ok: false, error: '无 sid' };
  const hit = cache.get(sid);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  let data;
  try {
    const j = await httpGetJson('https://drive.kdocs.cn/api/v5/links/' + encodeURIComponent(sid));
    const fi = j.fileinfo || {};
    const li = j.linkinfo || {};
    data = {
      ok: j.result === 'ok' && !!fi.id,
      sid: sid,
      fname: fi.fname || '',
      fileid: String(li.fileid || fi.id || ''),
      fsize: Number(fi.fsize || 0),
      mtime: Number(fi.mtime || 0) * 1000, // 秒 → 毫秒
      fver: Number(fi.fver || 0),
      linkOpen: li.status === 'open',
      canDownload: Number(li.download_perm || 0) > 0
    };
  } catch (e) {
    data = { ok: false, sid: sid, error: e.message };
  }
  cache.set(sid, { at: Date.now(), data: data });
  return data;
}

/**
 * 汇总所有配置了 kdocs 链接的模块的新鲜度。
 * @param {object} cfg  config/wps.json 内容
 * @param {object} moduleTimes  云库里各模块的 updated_at（ISO 字符串）
 */
async function checkFreshness(cfg, moduleTimes) {
  const modules = (cfg && cfg.modules) || {};
  const times = moduleTimes || {};
  const keys = Object.keys(modules).filter(function (k) {
    const u = modules[k] && modules[k].wps && modules[k].wps.url;
    return !!parseSid(u);
  });

  const items = [];
  for (const key of keys) {
    const m = modules[key];
    const sid = parseSid(m.wps.url);
    const meta = await getMeta(sid);
    const cloudAt = times[key] ? new Date(times[key]).getTime() : 0;
    items.push({
      module: key,
      label: m.label || key,
      sid: sid,
      url: m.wps.url,
      fname: meta.fname || '',
      fsize: meta.fsize || 0,
      mtime: meta.mtime || 0,
      linkOpen: meta.ok === false ? false : meta.linkOpen !== false,
      reachable: meta.ok !== false,
      unavailable: meta.ok === false,
      cloudAt: cloudAt || null,
      hasCloudData: !!times[key],
      // 表格有更新（或根本没有云端数据）→ 数据需要同步
      stale: meta.ok === false ? false : (!times[key] || meta.mtime > cloudAt + 60000)
    });
  }
  return { checkedAt: new Date().toISOString(), items: items };
}

module.exports = { getMeta: getMeta, checkFreshness: checkFreshness, parseSid: parseSid };
