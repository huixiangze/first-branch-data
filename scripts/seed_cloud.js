'use strict';
// 一次性种子脚本：把本地 data/imports 下已有的 CSV 计算成模块 payload 写入云数据库。
// 用法（在项目根）： node scripts/seed_cloud.js anchorRank [forecast ...]
// 不传参数时默认只种 anchorRank（主播榜单，已有真实 CSV）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'wps.json'), 'utf8'));
const fetcher = require(path.join(ROOT, 'src', 'wpsFetcher'));
const cloud = require(path.join(ROOT, 'src', 'cloudDb'));

(async function () {
  if (!cloud.isEnabled()) {
    console.log('云数据库未启用（config/cloud.json enabled=false 或缺少配置）');
    process.exit(1);
  }
  const keys = process.argv.slice(2);
  const targets = keys.length ? keys : ['anchorRank'];

  for (const key of targets) {
    const modCfg = cfg.modules && cfg.modules[key];
    if (!modCfg) { console.log('跳过未知模块:', key); continue; }
    const csvName = modCfg.csv || (key + '.csv');
    const csvPath = path.join(ROOT, 'data', 'imports', csvName);
    if (!fs.existsSync(csvPath)) {
      console.log('无本地 CSV，跳过:', key, '（需先导出到 data/imports/' + csvName + '）');
      continue;
    }
    // 强制走本地 CSV，避免触发 WPS 网络请求
    const csvCfg = Object.assign({}, modCfg, { source: 'csv', csv: csvName });
    let payload = null;
    try {
      payload = await fetcher.fetchModule(key, csvCfg, cfg.wpsGlobal);
    } catch (e) {
      console.log('计算失败', key, '：', e.message);
      continue;
    }
    if (!payload) { console.log('无有效数据，跳过:', key); continue; }
    payload.source = 'cloud';
    await cloud.upsertModule(key, payload);
    const rows = (payload.rows && payload.rows.length) || (payload.rawRows && payload.rawRows.length) || 0;
    console.log('已写入云库:', key, '| source=cloud | 行数=', rows);
  }
  console.log('DONE');
})().catch(function (e) {
  console.error('失败:', e.message);
  process.exit(1);
});
