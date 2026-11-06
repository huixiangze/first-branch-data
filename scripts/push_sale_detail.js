'use strict';
// 把 import_sale_detail.py 生成的 saleDetail.json 推送到云数据库
// 用法: node scripts/push_sale_detail.js [json 路径]
const fs = require('fs');
const path = require('path');
const cloudDb = require('../src/cloudDb');

const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, 'data', 'imports', 'saleDetail.json');

(async function () {
  if (!fs.existsSync(FILE)) {
    console.error('找不到文件：' + FILE);
    process.exit(2);
  }
  const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const s = payload.summary || {};
  console.log('[saleDetail] 明细 ' + (payload.rows || []).length + ' 条 · ' +
    s.dateFrom + '~' + s.dateTo + ' · ' + s.anchors + ' 位主播 · 销售额 ' +
    Math.round(s.sales / 10000) + ' 万');

  if (!cloudDb.isEnabled()) {
    console.log('[saleDetail] 云库未启用，仅保留本地文件');
    return;
  }
  await cloudDb.upsertModule('saleDetail', payload);
  console.log('[saleDetail] 已写入云库 module=saleDetail');
})().catch(function (e) {
  console.error('[saleDetail] 推送失败：' + e.message);
  process.exit(1);
});
