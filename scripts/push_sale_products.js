'use strict';
// 把 import_sale_products.py 生成的 saleProducts.json 推送到云数据库
// 用法: node scripts/push_sale_products.js [json 路径]
const fs = require('fs');
const path = require('path');
const cloudDb = require('../src/cloudDb');

const ROOT = path.join(__dirname, '..');
const FILE = process.argv[2] || path.join(ROOT, 'data', 'imports', 'saleProducts.json');

(async function () {
  if (!fs.existsSync(FILE)) {
    console.error('找不到文件：' + FILE);
    process.exit(2);
  }
  const payload = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const s = payload.summary || {};
  console.log('[saleProducts] 商品 ' + (payload.products || []).length + ' 个 · ' +
    '主播 ' + (payload.anchors || []).length + ' 位 · 明细 ' + (payload.items || []).length + ' 行 · ' +
    s.dateFrom + '~' + s.dateTo + ' · 销售额 ' + Math.round(s.sales / 10000) + ' 万');

  if (!cloudDb.isEnabled()) {
    console.log('[saleProducts] 云库未启用，仅保留本地文件');
    return;
  }
  await cloudDb.upsertModule('saleProducts', payload);
  console.log('[saleProducts] 已写入云库 module=saleProducts');
})().catch(function (e) {
  console.error('[saleProducts] 推送失败：' + e.message);
  process.exit(1);
});
