// 第一分公司数据中台 —— 智能洞察引擎（纯前端计算，零依赖）
// 输入 /api/data 的 modules 对象，输出可直接渲染的经营结论。
(function () {
  'use strict';

  var DAY_RE = /^(\d{1,2})日$/;

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/[,，%\s]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function wan(v) { return Math.round((num(v) / 10000) * 100) / 100; }
  function pct(v, d) {
    var n = Number(v);
    if (!isFinite(n)) return '0%';
    return (Math.round(n * 10) / 10).toFixed(d == null ? 1 : d) + '%';
  }
  function signed(v, unit) {
    var n = Math.round(Number(v) * 10) / 10;
    return (n >= 0 ? '+' : '') + n + (unit || '');
  }
  function avg(arr) {
    if (!arr.length) return 0;
    return arr.reduce(function (a, b) { return a + b; }, 0) / arr.length;
  }
  function std(arr) {
    if (arr.length < 2) return 0;
    var m = avg(arr);
    return Math.sqrt(avg(arr.map(function (x) { return (x - m) * (x - m); })));
  }

  // ---------- 基础派生数据 ----------
  // 注意口径：工作簿里每位主播的 daily[i] 存的是【每日预估结算额】，rateDaily[i] 是当日结算率。
  // 每日实际 GMV = 结算额 ÷ 结算率（仅在 0 < 率 ≤ 100 时换算，否则该日视为无产出）。
  function dayGmv(settle, rate) {
    var d = num(settle), r = num(rate);
    if (d <= 0 || r <= 0 || r > 100) return 0;
    return d / (r / 100);
  }

  // 返回 [{ idx, label, gmv, settle, rate }]
  function dailySeries(rows) {
    var len = 0;
    (rows || []).forEach(function (r) {
      var d = r.daily || [];
      if (d.length > len) len = d.length;
    });
    var out = [];
    for (var i = 0; i < len; i++) {
      var settle = 0, gmv = 0;
      (rows || []).forEach(function (r) {
        var d = num((r.daily || [])[i]);
        var rt = num((r.rateDaily || [])[i]);
        settle += d;
        gmv += dayGmv(d, rt);
      });
      out.push({
        idx: i, label: (i + 1) + '日',
        gmv: gmv, settle: settle,
        rate: gmv > 0 ? (settle / gmv) * 100 : 0
      });
    }
    return out;
  }
  // 兼容：只取结算额序列
  function dailyTotals(rows) {
    return dailySeries(rows).map(function (x) {
      return { idx: x.idx, label: x.label, value: x.settle, gmv: x.gmv };
    });
  }
  // 只保留有数据的天，key 指定判断字段（默认 gmv）
  function activeDays(series, key) {
    key = key || 'gmv';
    return (series || []).filter(function (x) { return num(x[key]) > 0; });
  }

  // 主播环比：最后两个有产出日的 GMV 对比
  function movers(rows) {
    var list = (rows || []).map(function (r) {
      var g = (r.daily || []).map(function (v, i) {
        return dayGmv(v, (r.rateDaily || [])[i]);
      });
      var last = -1;
      for (var i = g.length - 1; i >= 0; i--) { if (g[i] > 0) { last = i; break; } }
      if (last < 1) return null;
      var cur = g[last], prev = g[last - 1];
      var delta = cur - prev;
      var p = prev > 0 ? (delta / prev) * 100 : (cur > 0 ? 100 : 0);
      return {
        anchor: r.anchor, cur: cur, prev: prev, delta: delta, pct: p,
        cum: num(r.gmvCum), rate: num(r.rate), dayIdx: last
      };
    }).filter(Boolean);

    var risers = list.slice().filter(function (x) { return x.delta > 0 && x.cur >= 3000; })
      .sort(function (a, b) { return b.delta - a.delta; });
    var fallers = list.slice().filter(function (x) { return x.delta < 0 && x.prev >= 3000; })
      .sort(function (a, b) { return a.delta - b.delta; });
    return { all: list, risers: risers, fallers: fallers };
  }

  // ---------- 洞察规则 ----------
  function build(modules) {
    modules = modules || {};
    var out = [];
    var rank = modules.anchorRank || {};
    var rows = (rank.rows || []).filter(function (r) { return r.anchor; });
    var sum = rank.summary || {};
    var comm = modules.commodity || {};

    if (!rows.length) {
      return [{
        id: 'no-data', level: 'info', tag: '数据',
        title: '尚无主播数据',
        detail: '当前模块还没有拿到结算工作簿。确认同步助手在运行，或稍后刷新。',
        metric: null, action: null
      }];
    }

    // 1) 趋势：日 GMV 走势（口径已换算为实际成交额）
    var series = dailySeries(rows);
    var active = activeDays(series, 'gmv');
    if (active.length >= 2) {
      var first = active[0], last = active[active.length - 1];
      var growth = first.gmv > 0 ? ((last.gmv - first.gmv) / first.gmv) * 100 : 0;
      var up = 0, down = 0;
      for (var i = 1; i < active.length; i++) {
        if (active[i].gmv > active[i - 1].gmv) up++;
        else if (active[i].gmv < active[i - 1].gmv) down++;
      }
      if (up === active.length - 1 && active.length >= 3) {
        out.push({
          id: 'trend-up', level: 'good', tag: '增长',
          title: 'GMV 连续 ' + (active.length - 1) + ' 天上升',
          detail: active[0].label + ' ' + wan(first.gmv) + ' 万 → ' + last.label + ' ' + wan(last.gmv) +
            ' 万，累计增长 ' + pct(growth) + '。',
          metric: signed(growth, '%'),
          action: { view: 'anchorRank' }
        });
      } else if (down === active.length - 1 && active.length >= 3) {
        out.push({
          id: 'trend-down', level: 'risk', tag: '下滑',
          title: 'GMV 连续 ' + (active.length - 1) + ' 天下滑',
          detail: active[0].label + ' ' + wan(first.gmv) + ' 万 → ' + last.label + ' ' + wan(last.gmv) +
            ' 万，累计下降 ' + pct(Math.abs(growth)) + '，需要排查流量或排班。',
          metric: signed(-Math.abs(growth), '%'),
          action: { view: 'anchorRank' }
        });
      } else if (Math.abs(growth) >= 1) {
        out.push({
          id: 'trend-mixed', level: growth >= 0 ? 'good' : 'warn', tag: '趋势',
          title: (growth >= 0 ? '近期 GMV 上行 ' : '近期 GMV 回落 ') + pct(Math.abs(growth)),
          detail: '从 ' + active[0].label + ' 的 ' + wan(first.gmv) + ' 万，到 ' + last.label + ' 的 ' +
            wan(last.gmv) + ' 万；期间 ' + up + ' 天上升、' + down + ' 天下降。',
          metric: signed(growth, '%'),
          action: { view: 'anchorRank' }
        });
      }
    }

    // 2) 集中度：Top5 主播贡献占比
    var sortedCum = rows.slice().sort(function (a, b) { return num(b.gmvCum) - num(a.gmvCum); });
    var totalCum = sortedCum.reduce(function (a, r) { return a + num(r.gmvCum); }, 0);
    if (totalCum > 0) {
      var top5 = sortedCum.slice(0, 5).reduce(function (a, r) { return a + num(r.gmvCum); }, 0);
      var share5 = (top5 / totalCum) * 100;
      out.push({
        id: 'concentration', level: share5 >= 65 ? 'warn' : 'info', tag: '集中度',
        title: '前 5 位主播贡献 ' + pct(share5) + ' 的 GMV',
        detail: share5 >= 65
          ? '收入高度依赖头部，头部一旦断播对整体冲击明显：' + sortedCum.slice(0, 3).map(function (r) { return r.anchor; }).join('、') + ' 三人合计占 ' +
            pct((sortedCum.slice(0, 3).reduce(function (a, r) { return a + num(r.gmvCum); }, 0) / totalCum) * 100) + '。'
          : '头部与长尾结构相对均衡，' + rows.length + ' 位主播中有 ' + rows.filter(function (r) { return num(r.gmvCum) > 0; }).length + ' 位产生了 GMV。',
        metric: pct(share5),
        action: { view: 'anchorRank' }
      });
    }

    // 3) 零产出主播
    var zeros = rows.filter(function (r) { return num(r.gmvCum) <= 0; });
    if (zeros.length >= 3) {
      out.push({
        id: 'idle', level: 'warn', tag: '产能',
        title: zeros.length + ' 位主播本期没有产生 GMV',
        detail: '占在册主播的 ' + pct((zeros.length / rows.length) * 100) + '。若不是新签或休假，建议核查开播情况：' +
          zeros.slice(0, 5).map(function (r) { return r.anchor; }).join('、') + (zeros.length > 5 ? ' 等' : '') + '。',
        metric: zeros.length + ' 人',
        action: { view: 'anchorRank', filter: 'idle' }
      });
    }

    // 4) 结算率异常（低于均值 1 个标准差以上，且有规模）
    var rated = rows.filter(function (r) { return num(r.gmvCum) > 0 && num(r.rate) > 0; });
    var rates = rated.map(function (r) { return num(r.rate); });
    if (rated.length >= 5) {
      var mRate = avg(rates), sRate = std(rates);
      var lowThreshold = Math.max(0, mRate - sRate);
      var lows = rated.filter(function (r) { return num(r.rate) < lowThreshold && num(r.gmvCum) >= totalCum / rows.length; })
        .sort(function (a, b) { return num(a.rate) - num(b.rate); });
      if (lows.length) {
        out.push({
          id: 'low-rate', level: 'risk', tag: '效率',
          title: lows.length + ' 位规模主播的结算率明显偏低',
          detail: '全员平均结算率 ' + pct(mRate) + '，异常线 ' + pct(lowThreshold) + '。偏低：' +
            lows.slice(0, 3).map(function (r) { return r.anchor + ' ' + pct(num(r.rate)); }).join('、') +
            '。结算率低通常意味着退货、风控扣减或品类毛利结构问题。',
          metric: lows.length + ' 人',
          action: { view: 'anchorRank', filter: 'lowRate' }
        });
      }
    }

    // 5) 类目结算率洼地
    var cats = (comm.categories || []).filter(function (c) { return num(c.pay) > 0; });
    var totalRate = num((comm.total || {}).rate);
    if (cats.length >= 3 && totalRate > 0) {
      var totalPay = cats.reduce(function (a, c) { return a + num(c.pay); }, 0);
      var gap = cats.filter(function (c) {
        return num(c.rate) < totalRate * 0.65 && num(c.pay) / totalPay >= 0.06;
      }).sort(function (a, b) { return num(a.rate) - num(b.rate); });
      if (gap.length) {
        var g0 = gap[0];
        out.push({
          id: 'cat-gap', level: 'risk', tag: '结构',
          title: '「' + g0.name + '」结算率只有 ' + pct(num(g0.rate)) + '，远低于整体 ' + pct(totalRate),
          detail: '该类目吃掉了 ' + pct((num(g0.pay) / totalPay) * 100) + ' 的支付 GMV（' + wan(g0.pay) + ' 万），但结算只有 ' +
            wan(g0.settle) + ' 万。若属佣金结构问题，会直接拖低整体利润率。',
          metric: pct(num(g0.rate)),
          action: { view: 'commodity' }
        });
      }
    }

    // 6) 卖家集中度
    var sellers = (comm.sellers || []).filter(function (s) { return num(s.pay) > 0; });
    var commTotalPay = num((comm.total || {}).pay);
    if (sellers.length >= 3 && commTotalPay > 0) {
      var top1 = sellers[0];
      var share1 = (num(top1.pay) / commTotalPay) * 100;
      if (share1 >= 30) {
        out.push({
          id: 'seller-top1', level: 'warn', tag: '供应链',
          title: '单一店铺占了 ' + pct(share1) + ' 的支付 GMV',
          detail: '「' + top1.name + '」支付 ' + wan(top1.pay) + ' 万，结算率 ' + pct(num(top1.rate)) +
            '。供货端过于集中，议价与断供风险都压在同一个点上。',
          metric: pct(share1),
          action: { view: 'commodity' }
        });
      }
    }

    // 7) 增长最快主播
    var mv = movers(rows);
    if (mv.risers.length) {
      var r0 = mv.risers[0];
      if (r0.delta >= 10000) {
        out.push({
          id: 'riser', level: 'good', tag: '机会',
          title: r0.anchor + ' 单日增长 ' + wan(r0.delta) + ' 万',
          detail: '从 ' + wan(r0.prev) + ' 万涨到 ' + wan(r0.cur) + ' 万（' + signed(r0.pct, '%') +
            '），当前累计 ' + wan(r0.cum) + ' 万、结算率 ' + pct(r0.rate) + '。值得追加资源。',
          metric: signed(r0.pct, '%'),
          action: { view: 'anchorRank' }
        });
      }
    }

    // 8) 数据时效
    if (rank.asOf) {
      var asOf = String(rank.asOf);
      var today = new Date();
      var iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
      out.push({
        id: 'freshness', level: asOf === iso ? 'info' : 'info', tag: '数据',
        title: '数据截止 ' + asOf,
        detail: '覆盖 ' + rows.length + ' 位主播、' + (comm.total && comm.total.items ? comm.total.items : 0).toLocaleString('zh-CN') +
          ' 条商品明细。每日由同步助手自动拉取，无需手动导入。',
        metric: asOf,
        action: null
      });
    }

    return out;
  }

  window.Insights = {
    build: build,
    movers: movers,
    dailySeries: dailySeries,
    dailyTotals: dailyTotals,
    activeDays: activeDays,
    dayGmv: dayGmv,
    num: num,
    wan: wan,
    avg: avg,
    std: std
  };
})();
