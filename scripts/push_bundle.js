'use strict';
// 把 import_workbook.py 生成的 bundle.json 推送到云数据库
// 用法: node scripts/push_bundle.js [bundle.json 路径]
// 零依赖，复用 src/cloudDb.js

const fs = require('fs');
const path = require('path');
const cloudDb = require('../src/cloudDb');

const ROOT = path.join(__dirname, '..');
const BUNDLE = process.argv[2] || path.join(ROOT, 'data', 'imports', 'bundle.json');

function num(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[,，%\s]/g, ''));
  return isNaN(n) ? 0 : n;
}
function wan(v) { return Math.round(num(v) / 10000 * 100) / 100; }

function buildBanners(rank, commodity) {
  const s = rank.summary || {};
  return [
    {
      title: '下播GMV累计',
      value: wan(s.gmvCum), unit: '万',
      sub: '当日 ' + wan(s.gmvToday) + ' 万', trend: 'flat'
    },
    {
      title: '预估结算GMV',
      value: wan(s.settleCum), unit: '万',
      sub: '结算率 ' + s.avgRate + '%', trend: 'up'
    },
    {
      title: '在播主播',
      value: s.anchors, unit: '人',
      sub: '含电商团队', trend: 'flat'
    },
    {
      title: '平均结算率',
      value: s.avgRate, unit: '%',
      sub: '商品明细 ' + (commodity ? commodity.total.items : 0).toLocaleString('en-US') + ' 行', trend: 'up'
    }
  ];
}

async function main() {
  if (!fs.existsSync(BUNDLE)) {
    console.error('找不到 bundle: ' + BUNDLE);
    process.exit(1);
  }
  if (!cloudDb.isEnabled()) {
    console.error('云数据库未启用，请检查 config/cloud.json');
    process.exit(1);
  }
  const b = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
  const rank = b.anchorRank;
  const commodity = b.commodity;
  const now = new Date().toISOString();

  if (rank) {
    rank.refreshedAt = now;
    await cloudDb.upsertModule('anchorRank', rank);
    console.log('[ok] anchorRank  主播 ' + rank.rows.length + ' 人 / 原始 ' + rank.rawHeaders.length + ' 列');
  }

  if (commodity) {
    commodity.source = 'cloud';
    commodity.refreshedAt = now;
    await cloudDb.upsertModule('commodity', commodity);
    console.log('[ok] commodity   类目 ' + commodity.categories.length + ' 个 / 商品 ' + commodity.products.length + ' 个');
  }

  if (rank) {
    const home = {
      source: 'cloud',
      asOf: rank.asOf,
      refreshedAt: now,
      kpis: buildBanners(rank, commodity),
      notices: [
        { title: '数据已接入云数据库，页面 60 秒自动同步', time: rank.asOf || '', level: 'info' },
        { title: '数据源：《2026年11月第一分公司电商主播昨日结算数据.xlsx》汇总页', time: rank.title || '', level: 'info' }
      ],
      anomaly: { note: '本月暂无异常记录', updated: rank.asOf || '-' }
    };
    await cloudDb.upsertModule('home', home);
    console.log('[ok] home        4 项核心指标');
  }

  const dailies = b.dailies || [b.daily1, b.daily2].filter(Boolean);
  if (dailies.length) {
    const perf = {
      source: 'cloud',
      asOf: rank ? rank.asOf : '',
      refreshedAt: now,
      sheets: dailies.map(function (s) {
        return { name: s.name, date: s.date, headers: s.headers, rows: s.rows };
      })
    };
    await cloudDb.upsertModule('anchorPerformance', perf);
    console.log('[ok] anchorPerformance  ' + perf.sheets.length + ' 个日快照（' +
      perf.sheets.map(function (s) { return s.name; }).join('/') + '）');
  }

  // 其他模块（forecast / rongpin 等）：导入脚本写进 bundle 后原样 upsert，
  // 以后新增数据源不用再改这个文件。
  const HANDLED = {
    anchorRank: 1, commodity: 1, home: 1, anchorPerformance: 1,
    dailies: 1, daily1: 1, daily2: 1, generatedAt: 1
  };
  for (const key of Object.keys(b)) {
    if (HANDLED[key]) continue;
    const payload = b[key];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    payload.source = 'cloud';
    payload.refreshedAt = now;
    await cloudDb.upsertModule(key, payload);
    const n = (payload.rows || payload.months || []).length;
    console.log('[ok] ' + key + '  ' + n + ' 条');
  }

  console.log('全部完成，时间 ' + now);
}

main().catch(function (e) {
  console.error('推送失败: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
