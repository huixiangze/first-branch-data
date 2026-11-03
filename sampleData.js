'use strict';
// 第一分公司数据中台 —— 示例数据生成器
// 当 config/wps.json 中某模块 source="sample" 时，由此处提供演示数据。
// 一旦接通真实 WPS 数据，本文件仅作为兜底。

function rnd(min, max) {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

function buildHome() {
  return {
    kpis: [
      { title: '截止现在已完成月度累计', value: '1166.7', unit: '万', sub: '目标 2188.7万', trend: 'up' },
      { title: '差额（目标-完成值）', value: '-1022.0', unit: '万', sub: '需加快进度', trend: 'down' },
      { title: '日销完成率（周-目标）', value: '619.8', unit: '万', sub: '周目标 980万', trend: 'up' },
      { title: '月均GMV完成', value: '144.7', unit: '万', sub: '日均口径', trend: 'up' },
      { title: '结束率汇总', value: '39.95', unit: '%', sub: '全口径', trend: 'flat' }
    ],
    anomaly: {
      updated: '2024-09-12',
      title: '日进度差率 > 70% 商品',
      bars: [
        { label: '总部', value: 1, color: '#ff8c3b' }
      ],
      note: '11月3日 暂无主场战报记录'
    },
    notices: [
      { title: '关于第一分公司 11 月经营例会的通知', time: '11-03 09:30', level: 'info' },
      { title: '双十一大促备货清单已下发', time: '11-02 18:00', level: 'warn' },
      { title: 'WPS 共享表格字段口径变更提醒', time: '11-01 10:12', level: 'info' }
    ],
    clock: { time: '13:09', weekday: '周二', daysLeft: 27 }
  };
}

function buildAnchorRank() {
  const rows = [
    ['林多多', '潮客星创', '杨梅', 291.6, 187.6, 200.0, 4.2, 26.9, 20],
    ['林二少', '潮客星创', '杨梅', 219.1, 166.6, 800.0, 6.3, 30.4, 10],
    ['马晓迪', '潮客星创', '优优', 64.6, 27.8, 1000.0, 2.1, 41.9, 19],
    ['杨幂', '潮客星创', '大美', 54.0, 24.0, 120.0, 2.8, 44.3, 18],
    ['孙子伦', '电客', '大溪', 20.0, 11.6, 900.0, 2.2, 29.4, 16],
    ['亚文', '电客', '落苏树', 19.6, 16.7, 200.0, 5.3, 35.2, 14],
    ['忆春', '电客', '汇嘉', 22.5, 10.6, 200.0, 5.0, 44.3, 13],
    ['泰吉', '潮客星创', '优优', 22.5, 9.6, 200.0, 3.2, 42.9, 15],
    ['灵山', '潮客星创', '灵山', 19.4, 7.7, 90.0, 1.3, 69.2, 17],
    ['苏晨', '电客', '大溪', 6.6, 2.4, 150.0, 1.7, 35.1, 12]
  ].map(function (r) {
    return { anchor: r[0], org: r[1], category: r[2], gmv: r[3], avg: r[4], target: r[5], rate: r[6], aov: r[7], rank: r[8] };
  });
  return { rows: rows, updated: '11月', source: 'sample' };
}

function buildAnchorPerformance() {
  const rows = [
    ['11月3日', '桃二岁', 1.07, 8.7, -1.3, -11.4, '未达标', '否'],
    ['11月3日', '林宝菜', 1.02, 7.9, -0.9, -9.1, '未达标', '否'],
    ['11月3日', '展信佳', 0.98, 9.2, 1.1, 12.0, '已完成', '是'],
    ['11月3日', '顾少杰', 0.91, 6.4, -0.3, -4.2, '未达标', '否'],
    ['11月3日', '上官晓晓', 0.86, 8.1, 0.6, 8.0, '已完成', '是'],
    ['11月3日', '何欣月', 0.79, 5.7, 0.2, 3.5, '未达标', '否'],
    ['11月3日', '范晓', 0.74, 4.9, -0.1, -2.0, '未达标', '否'],
    ['11月3日', '天下无双', 0.68, 4.1, 0.3, 7.3, '已完成', '是']
  ].map(function (r) {
    return { date: r[0], anchor: r[1], est: r[2], actual: r[3], diff: r[4], diffRate: r[5], status: r[6], tag: r[7] };
  });
  return {
    kpis: [
      { title: '预估GMV', value: '1178.2', unit: '万', sub: '环比 +27%', trend: 'up' },
      { title: '实际成交金额', value: '14.9', unit: '万', sub: '环比 -43.4%', trend: 'down' },
      { title: '退款金额', value: '-1163.3', unit: '万', sub: '签收 0.1%', trend: 'down' },
      { title: '退款率分析', value: '-98.7', unit: '%', sub: '退款率 98.7%', trend: 'down' }
    ],
    categories: [
      { name: '已卖货主播', count: 29, amount: '¥86.4万', tag: 'green' },
      { name: '未卖货主播', count: 9, amount: '¥0.0', tag: 'gray' },
      { name: '本日未成交主播', count: 4, amount: '—', tag: 'red' }
    ],
    detail: { tabs: ['主播业绩 7', '未成交主播 29', '退款业绩 16'], rows: rows },
    updated: '11月3日'
  };
}

function buildProductInsight() {
  const attention1 = [
    ['茅台酒 53% 500ml', '酒类', 7079.0, 1, 7079.0, 0, 0.0, 100.0],
    ['五粮液 普五 第八代', '酒类', 1349.91, 5, 6749.55, 1, 1349.91, 80.0],
    ['国窖1573 52度 500ml', '酒类', 1540.0, 4, 6160.0, 0, 0.0, 75.0],
    ['洋河 梦之蓝 M6+', '酒类', 2011.0, 2, 4022.0, 0, 0.0, 71.4],
    ['汾酒 青花30 复兴版', '酒类', 7999.0, 1, 3999.0, 1, 1999.0, 71.4],
    ['剑南春 水晶剑 52度', '酒类', 3938.0, 1, 3938.0, 1, 3938.0, 68.8]
  ].map(function (r) {
    return { name: r[0], category: r[1], price: r[2], sales: r[3], amount: r[4], momVol: r[5], momAmt: r[6], trend: r[7] };
  });
  const attention2 = [
    ['【微醺晚安酒】', '椰子', 999.0, 9, 8991.0, 2, 1998.0, 77.8],
    ['【大满贯】', '茶饮', 399.0, 10, 3990.0, 2, 798.0, 75.0],
    ['【威士忌】', '威士忌', 3999.0, 2, 7998.0, 1, 3999.0, 75.0],
    ['【精酿啤酒】', '黑啤', 399.0, 8, 3192.0, 4, 1596.0, 73.7],
    ['【白啤】', '啤酒', 399.0, 3, 1197.0, 0, 0.0, 73.3],
    ['【果酒】', '果酒', 1299.0, 3, 3897.0, 0, 0.0, 71.4]
  ].map(function (r) {
    return { name: r[0], category: r[1], price: r[2], sales: r[3], amount: r[4], momVol: r[5], momAmt: r[6], trend: r[7] };
  });
  return {
    topProducts: [
      { badge: 'G', name: '白酒', tag: '预警提醒', rate: 48.8, count: 50, core: { amount: 177287.11, priceWarn: [0, 31, 53, 0, 46], saleWarn: [488.9, 0.0, 56.6], profitWarn: 17 }, attention: attention1 },
      { badge: 'M', name: '林家铺', tag: '预警提醒', rate: 42.1, count: 17, core: { amount: 197743.36, priceWarn: [0, 15, 184, 0], saleWarn: [154, 0.0], profitWarn: 17 }, attention: attention2 }
    ],
    updated: '11月'
  };
}

function buildProductData() {
  return {
    kpis: [
      { title: '商品数', value: '4002', unit: '个', sub: '全量收录', trend: 'flat' },
      { title: '7日营收', value: '7894.2', unit: '万', sub: '环比 +12.4%', trend: 'up' },
      { title: '7日转化率', value: '23.7', unit: '%', sub: '行业均值 18%', trend: 'up' },
      { title: '营收贡献', value: '76.3', unit: '万', sub: '头部商品', trend: 'up' },
      { title: '爆品数', value: '43', unit: '个', sub: '增速 >50%', trend: 'up' }
    ],
    categoryRank: [
      { name: '户外出照明', value: 90 }, { name: '汽车用品', value: 82 }, { name: '家用电器', value: 75 },
      { name: '数码配件', value: 68 }, { name: '家居生活', value: 60 }, { name: '食品饮料', value: 55 }
    ],
    topGmv: [
      { name: '户外出照明', value: 1044.8 }, { name: '汽车用品', value: 908.4 }, { name: '家用电器', value: 821.0 },
      { name: '数码配件', value: 763.2 }, { name: '家居生活', value: 690.5 }
    ],
    hot: [
      { name: '户外出照明', change: 13.4, revenue: '1044.8万' },
      { name: '数码配件', change: 21.1, revenue: '763.2万' },
      { name: '家用电器', change: 9.8, revenue: '821.0万' }
    ],
    rising: [
      { name: '珠宝/玉石', change: 88.2, revenue: '312.6万' },
      { name: '手表', change: 87.5, revenue: '288.1万' },
      { name: '箱包', change: 76.3, revenue: '254.0万' }
    ],
    updated: '2026-11-03 13:06:18'
  };
}

function buildProductDept() {
  return {
    kpis: [
      { title: '竞品总收录', value: '4572', unit: '条', sub: '占比 8.5%', trend: 'flat' },
      { title: '平均毛利率', value: '46.8', unit: '%', sub: '全流量口径', trend: 'up' },
      { title: '低毛利率款', value: '0', unit: '条', sub: '毛利率<15%', trend: 'flat' },
      { title: '优先测品表', value: '17', unit: '条', sub: '占 0.4%', trend: 'up' },
      { title: '潜力品数', value: '281', unit: '条', sub: '占 6.1%', trend: 'up' }
    ],
    yieldByCategory: [
      { category: '酒类', yield: 52 }, { category: '面点', yield: 51 }, { category: '生鲜冻品', yield: 50 },
      { category: '咖啡', yield: 49 }, { category: '茶饮', yield: 48 }, { category: '乳品', yield: 47 },
      { category: '粮油', yield: 46 }, { category: '烘焙', yield: 45 }, { category: '调味品', yield: 48 },
      { category: '休闲零食', yield: 44 }, { category: '母婴', yield: 43 }, { category: '纸品', yield: 43 },
      { category: '日化', yield: 42 }, { category: '家纺', yield: 42 }, { category: '服饰', yield: 42 },
      { category: '其它', yield: 42 }
    ],
    pools: {
      priority: [
        { name: '柴火', margin: 71.9, videos: 12 }, { name: '一次性用品', margin: 71.8, videos: 9 },
        { name: '抽纸', margin: 71.6, videos: 21 }, { name: '含乳', margin: 71.5, videos: 6 },
        { name: '美食', margin: 71.4, videos: 15 }
      ],
      potential: [
        { name: '医疗链接', margin: 71.4, videos: 4 }, { name: '个护定制', margin: 71.4, videos: 7 },
        { name: '个性定制/软体', margin: 71.4, videos: 3 }, { name: '玩具', margin: 71.4, videos: 8 },
        { name: '金饰', margin: 71.4, videos: 2 }
      ],
      restrict: []
    },
    updated: '11月'
  };
}

function buildRongpin() {
  return {
    kpis: [
      { title: '新签人数', value: '13', unit: '人', sub: '', trend: 'up' },
      { title: '在播主播', value: '38', unit: '人', sub: '', trend: 'flat' },
      { title: '下单GMV累计', value: '792.6', unit: '万', sub: '', trend: 'up' },
      { title: '预估结算累计', value: '290.0', unit: '万', sub: '', trend: 'up' },
      { title: '预估总目标', value: '1.30', unit: '亿', sub: '', trend: 'flat' },
      { title: '整体完成率', value: '2.2', unit: '%', sub: '', trend: 'down' },
      { title: '已达标主播', value: '2', unit: '人', sub: '', trend: 'up' },
      { title: '零产出主播', value: '16', unit: '人', sub: '', trend: 'down' }
    ],
    settlement: [
      { name: '桃二岁', value: 175.2 }, { name: '林宝菜', value: 142.0 }, { name: '展信佳', value: 98.4 },
      { name: '顾少杰', value: 76.1 }, { name: '上官晓晓', value: 52.3 }, { name: '何欣月', value: 31.0 }, { name: '范晓', value: 14.6 }
    ],
    completion: [
      { name: '桃二岁', value: 5.5 }, { name: '林宝菜', value: 4.8 }, { name: '展信佳', value: 4.2 },
      { name: '顾少杰', value: 3.6 }, { name: '上官晓晓', value: 3.0 }, { name: '何欣月', value: 2.4 }, { name: '范晓', value: 1.8 }
    ],
    distribution: [
      { anchor: '桃二岁', gmv: 300.0, commission: 33.4, dept: '一部', growth: 12.0 },
      { anchor: '林宝菜', gmv: 220.0, commission: 29.0, dept: '二部', growth: 8.5 },
      { anchor: '展信佳', gmv: 160.0, commission: 21.2, dept: '一部', growth: 6.0 },
      { anchor: '顾少杰', gmv: 120.0, commission: 15.8, dept: '三部', growth: -2.1 },
      { anchor: '上官晓晓', gmv: 95.0, commission: 12.4, dept: '二部', growth: 4.3 }
    ],
    updated: '11月2日'
  };
}

function buildDeputy() {
  return {
    kpis: [
      { title: '副总团队数', value: '6', unit: '个', sub: '', trend: 'flat' },
      { title: '团队总目标', value: '2188.7', unit: '万', sub: '', trend: 'flat' },
      { title: '团队已完成', value: '1166.7', unit: '万', sub: '', trend: 'up' },
      { title: '总完成率', value: '53.3', unit: '%', sub: '', trend: 'up' }
    ],
    rows: [
      { name: '王副总', target: 420.0, done: 268.4, rate: 63.9, status: '领先' },
      { name: '李副总', target: 380.0, done: 221.0, rate: 58.2, status: '正常' },
      { name: '赵副总', target: 360.0, done: 198.6, rate: 55.2, status: '正常' },
      { name: '陈副总', target: 340.0, done: 176.3, rate: 51.9, status: '预警' },
      { name: '刘副总', target: 348.7, done: 164.2, rate: 47.1, status: '预警' },
      { name: '孙副总', target: 340.0, done: 138.2, rate: 40.6, status: '落后' }
    ],
    chart: [
      { name: '王副总', value: 63.9 }, { name: '李副总', value: 58.2 }, { name: '赵副总', value: 55.2 },
      { name: '陈副总', value: 51.9 }, { name: '刘副总', value: 47.1 }, { name: '孙副总', value: 40.6 }
    ],
    updated: '11月3日'
  };
}

function buildPreference() {
  return {
    byCategory: [
      { category: '酒类', likes: 92, buyers: 1840 },
      { category: '休闲零食', likes: 85, buyers: 1620 },
      { category: '茶饮', likes: 78, buyers: 1450 },
      { category: '美妆护肤', likes: 71, buyers: 1230 },
      { category: '家居生活', likes: 64, buyers: 980 },
      { category: '数码配件', likes: 58, buyers: 860 }
    ],
    top: [
      { name: '茅台 1935', likes: 1240 }, { name: '五粮液 第八代', likes: 980 }, { name: '三只松鼠大礼包', likes: 870 },
      { name: '东方树叶', likes: 760 }, { name: '花西子散粉', likes: 690 }
    ],
    updated: '11月'
  };
}

function buildForecast() {
  return {
    months: [
      { month: '11月', est: 2188.7, actual: 1166.7, confidence: 92 },
      { month: '12月', est: 2450.0, actual: null, confidence: 88 },
      { month: '1月', est: 1980.0, actual: null, confidence: 80 },
      { month: '2月', est: 1760.0, actual: null, confidence: 75 },
      { month: '3月', est: 2100.0, actual: null, confidence: 70 }
    ],
    summary: { est: 2188.7, actual: 1166.7, confidence: 92 },
    updated: '11月3日'
  };
}

function buildAll() {
  return {
    home: buildHome(),
    anchorRank: buildAnchorRank(),
    anchorPerformance: buildAnchorPerformance(),
    productInsight: buildProductInsight(),
    productData: buildProductData(),
    productDept: buildProductDept(),
    rongpin: buildRongpin(),
    deputy: buildDeputy(),
    preference: buildPreference(),
    forecast: buildForecast()
  };
}

module.exports = { buildAll: buildAll };
