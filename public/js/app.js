(function () {
  'use strict';

  // ---------- 图标 ----------
  var ICONS = {
    home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    anchorRank: 'M5 9h3v11H5zm5.5-5h3v16h-3zm5.5 7h3v9h-3z',
    anchorPerformance: 'M3 13h4v8H3zm7-6h4v14h-4zm7-9h4v23h-4z',
    productInsight: 'M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
    productData: 'M12 2 3 7v10l9 5 9-5V7zm0 2.2 6.5 3.6L12 11.5 5.5 7.8zM5 9.7l6 3.3v6.5l-6-3.3zm14 0v6.5l-6 3.3V13z',
    productDept: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
    rongpin: 'M3 6h18v3H3zm0 5h18v3H3zm0 5h12v3H3z',
    deputy: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z',
    preference: 'M12 21 4 13a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3z',
    forecast: 'M3 17l6-6 4 4 8-8'
  };
  function icon(key) {
    return '<svg viewBox="0 0 24 24"><path d="' + (ICONS[key] || ICONS.home) + '"/></svg>';
  }

  // ---------- 模块定义 ----------
  var MODULES = [
    { key: 'home', label: '首页' },
    { key: 'anchorRank', label: '主播榜单' },
    { key: 'anchorPerformance', label: '主播业绩' },
    { key: 'productInsight', label: '商品洞察' },
    { key: 'productData', label: '商品数据' },
    { key: 'productDept', label: '商品部' },
    { key: 'rongpin', label: '融品业绩' },
    { key: 'deputy', label: '副总业绩' },
    { key: 'preference', label: '商品喜好' },
    { key: 'forecast', label: '业绩预估' }
  ];

  var state = { user: null, data: null, current: 'home', lastUpdated: null, pollTimer: null };

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }
  function fmtNum(v) {
    if (v === null || v === undefined || v === '') return '-';
    return v;
  }
  function trendCls(t) { return t === 'up' ? 'green' : t === 'down' ? 'red' : 'gray'; }
  function trendArrow(t) { return t === 'up' ? '▲' : t === 'down' ? '▼' : '■'; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function statusTag(s) {
    var map = { '已完成': 'green', '未达标': 'red', '领先': 'green', '正常': 'blue', '预警': 'orange', '落后': 'red' };
    return '<span class="tag ' + (map[s] || 'gray') + '">' + esc(s) + '</span>';
  }

  function kpiRow(kpis) {
    var colors = ['#ff7aa8', '#7a5cff', '#2f6fed', '#2bbf7a', '#ff8c3b'];
    return '<div class="kpi-row">' + (kpis || []).map(function (k, i) {
      var c = colors[i % colors.length];
      return '<div class="kpi-card">' +
        '<div class="kpi-icon" style="background:' + c + '">' + (ICONS[k.title] ? icon(k.title) : '<svg viewBox="0 0 24 24"><path d="' + ICONS.home + '"/></svg>') + '</div>' +
        '<div class="kpi-body"><div class="k-title">' + esc(k.title) + '</div>' +
        '<div class="k-val">' + esc(k.value) + '<span class="unit">' + esc(k.unit || '') + '</span></div>' +
        '<div class="k-sub"><span class="tag ' + trendCls(k.trend) + '">' + trendArrow(k.trend) + '</span> ' + esc(k.sub || '') + '</div>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  function tableView(columns, rows) {
    var head = '<tr>' + columns.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr>' + columns.map(function (c) {
        var v = r[c.key];
        if (c.tag === 'status') return '<td>' + statusTag(v) + '</td>';
        if (c.cls) return '<td class="' + c.cls + '">' + esc(v) + '</td>';
        return '<td>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<table class="tbl"><thead>' + head + '</thead><tbody>' + (body || '<tr><td colspan="' + columns.length + '" class="empty">暂无数据</td></tr>') + '</tbody></table>';
  }

  // ---------- 各模块视图 ----------
  var VIEWS = {
    home: function (d) {
      var h = d.home || {};
      var html = '';
      html += '<div class="view-title">首页</div><div class="view-sub">核心经营总览 · 数据来源：WPS共享表格（示例）</div>';
      html += kpiRow(h.kpis);
      html += '<div class="grid-2">';
      // 异常数据追踪
      var an = h.anomaly || {};
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">异常数据追踪</div><div class="ph-sub">更新于 ' + esc(an.updated || '-') + '</div></div>';
      html += '<div class="empty">' + esc(an.note || '暂无记录') + '</div>';
      if (an.bars && an.bars.length) html += (window.chartHelpers ? window.chartHelpers.hBars(an.bars.map(function (b) { return { label: b.label, value: b.value, color: b.color }; }), { unit: ' 条' }) : '');
      html += '</div>';
      // 右栏
      html += '<div>';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">通知公告</div></div>';
      html += (h.notices || []).map(function (n) {
        return '<div class="list-item"><div><div class="li-name">' + esc(n.title) + '</div><div class="li-meta">' + esc(n.time) + '</div></div><span class="tag ' + (n.level === 'warn' ? 'orange' : 'blue') + '">' + (n.level === 'warn' ? '重要' : '通知') + '</span></div>';
      }).join('') + '</div>';
      var ck = h.clock || {};
      html += '<div class="panel clock-card"><div class="big">' + esc(ck.time || '--:--') + '</div><div class="wk">' + esc(ck.weekday || '') + '</div><div class="dl">距离月底还有 ' + esc(ck.daysLeft || '-') + ' 天</div></div>';
      html += '</div>';
      html += '</div>';
      return html;
    },

    anchorRank: function (d) {
      var m = d.anchorRank || {};
      var cols = [
        { key: 'anchor', label: '主播' }, { key: 'org', label: '所属机构' }, { key: 'category', label: '品类' },
        { key: 'gmv', label: '下播GMV累计(万)', cls: 'mono' }, { key: 'avg', label: '场均销售额(万)', cls: 'mono' },
        { key: 'target', label: '月销售目标(万)', cls: 'mono' }, { key: 'rate', label: '月目标完成度(%)', cls: 'mono' },
        { key: 'aov', label: '客单价', cls: 'mono' }, { key: 'rank', label: '完成排名', cls: 'mono' }
      ];
      var html = '<div class="view-title">主播榜单</div><div class="view-sub">主播销售明细 · 数据来源：WPS共享表格（示例）</div>';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">主播销售明细</div><div class="ph-sub">共 ' + (m.rows ? m.rows.length : 0) + ' 条</div></div>';
      html += tableView(cols, m.rows || []);
      html += '</div>';
      var top5 = (m.rows || []).slice(0, 5).map(function (r) { return { label: r.anchor, value: r.gmv, color: '#2f6fed' }; });
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">GMV Top5 主播</div></div>' + (window.chartHelpers ? window.chartHelpers.hBars(top5, { unit: ' 万' }) : '') + '</div>';
      return html;
    },

    anchorPerformance: function (d) {
      var m = d.anchorPerformance || {};
      var html = '<div class="view-title">主播业绩</div><div class="view-sub">主播业绩明细 · 数据来源：WPS共享表格（示例）</div>';
      html += kpiRow(m.kpis);
      html += '<div class="grid-3">';
      (m.categories || []).forEach(function (c) {
        html += '<div class="panel" style="text-align:center"><div class="k-val">' + esc(c.count) + ' <span class="unit">人</span></div><div class="k-title" style="margin-top:6px">' + esc(c.name) + '</div><div style="margin-top:8px"><span class="tag ' + (c.tag || 'gray') + '">' + esc(c.amount) + '</span></div></div>';
      });
      html += '</div>';
      var det = m.detail || {};
      var cols = [
        { key: 'date', label: '日期' }, { key: 'anchor', label: '主播' }, { key: 'est', label: '预估(万)', cls: 'mono' },
        { key: 'actual', label: '实际(万)', cls: 'mono' }, { key: 'diff', label: '差额(万)', cls: 'mono' },
        { key: 'diffRate', label: '差额率(%)', cls: 'mono' }, { key: 'status', label: '状态', tag: 'status' }, { key: 'tag', label: '是否打标' }
      ];
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">主播业绩明细</div><div class="ph-sub">' + (det.tabs ? det.tabs.join(' / ') : '') + '</div></div>';
      html += tableView(cols, det.rows || []);
      html += '</div>';
      return html;
    },

    productInsight: function (d) {
      var m = d.productInsight || {};
      var html = '<div class="view-title">商品洞察</div><div class="view-sub">TOP 商品预警 · 数据来源：WPS共享表格（示例）</div>';
      (m.topProducts || []).forEach(function (p) {
        html += '<div class="warn-card"><div class="warn-head"><div class="badge">' + esc(p.badge) + '</div><div><div class="w-name">' + esc(p.name) + '</div><span class="tag orange">' + esc(p.tag) + '</span></div><div class="w-rate">' + esc(p.rate) + '%</div></div>';
        var core = p.core || {};
        html += '<div class="k-val" style="font-size:20px">' + esc(core.amount != null ? '¥' + core.amount.toLocaleString() : '-') + '</div>';
        html += '<div class="chips"><span class="chip">价格预警 ' + esc((core.priceWarn || []).join('/')) + '</span><span class="chip">销售预警 ' + esc((core.saleWarn || []).join('/')) + '</span><span class="chip hl">利润预警 ' + esc(core.profitWarn != null ? core.profitWarn : '-') + '</span></div>';
        var acols = [
          { key: 'name', label: '商品名称' }, { key: 'category', label: '类目' }, { key: 'price', label: '价格', cls: 'mono' },
          { key: 'sales', label: '当月销量', cls: 'mono' }, { key: 'amount', label: '当月销售额', cls: 'mono' },
          { key: 'momVol', label: '环比销量', cls: 'mono' }, { key: 'momAmt', label: '环比销售额', cls: 'mono' }, { key: 'trend', label: '趋势率(%)', cls: 'mono' }
        ];
        html += '<div style="margin-top:12px"><div class="ph-sub" style="margin-bottom:8px;font-weight:600">高关注商品</div>' + tableView(acols, p.attention || []) + '</div>';
        html += '</div>';
      });
      return html;
    },

    productData: function (d) {
      var m = d.productData || {};
      var html = '<div class="view-title">商品数据</div><div class="view-sub">商品全景分析 · 数据来源：WPS共享表格（示例） · 更新于 ' + esc(m.updated || '-') + '</div>';
      html += kpiRow(m.kpis);
      html += '<div class="grid-2b">';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">品类排行</div></div>' + (window.chartHelpers ? window.chartHelpers.hBars(m.categoryRank || [], {}) : '') + '</div>';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">TOP 品类 GMV(万)</div></div>' + (window.chartHelpers ? window.chartHelpers.hBars(m.topGmv || [], { unit: ' 万' }) : '') + '</div>';
      html += '</div>';
      html += '<div class="grid-2b">';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">热门搜索（近7天）</div></div>' + listWithChange(m.hot || []) + '</div>';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">上升新星（近7天）</div></div>' + listWithChange(m.rising || []) + '</div>';
      html += '</div>';
      return html;
    },

    productDept: function (d) {
      var m = d.productDept || {};
      var html = '<div class="view-title">商品部</div><div class="view-sub">品类收益率与选品池 · 数据来源：WPS共享表格（示例）</div>';
      html += kpiRow(m.kpis);
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">品类收益率对比</div><div class="ph-sub">绿色=收益率</div></div>' + (window.chartHelpers ? window.chartHelpers.hBars((m.yieldByCategory || []).map(function (x) { return { label: x.category, value: x.yield, color: '#2bbf7a' }; }), { unit: '%' }) : '') + '</div>';
      var pools = m.pools || {};
      html += '<div class="grid-3">';
      html += poolPanel('优先池', 'green', pools.priority || [], '覆盖率 70%');
      html += poolPanel('潜力', 'yellow', pools.potential || [], '覆盖率 12%');
      html += poolPanel('提权/限流', 'red', pools.restrict || [], '覆盖率 0%');
      html += '</div>';
      return html;
    },

    rongpin: function (d) {
      var m = d.rongpin || {};
      var html = '<div class="view-title">融品业绩</div><div class="view-sub">主播业绩分成计划 · 数据来源：WPS共享表格（示例） · ' + esc(m.updated || '-') + '</div>';
      html += kpiRow(m.kpis);
      html += '<div class="grid-2b">';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">融品预估结算GMV对比(万)</div></div>' + (window.chartHelpers ? window.chartHelpers.vBars(m.settlement || [], { unit: ' 万' }) : '') + '</div>';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">融品月目标完成度(%)</div></div>' + (window.chartHelpers ? window.chartHelpers.vBars(m.completion || [], { unit: '%' }) : '') + '</div>';
      html += '</div>';
      var dcols = [
        { key: 'anchor', label: '主播昵称' }, { key: 'gmv', label: '直播间GMV(万)', cls: 'mono' },
        { key: 'commission', label: '预估佣金(万)', cls: 'mono' }, { key: 'dept', label: '部门' }, { key: 'growth', label: '环比增长(%)', cls: 'mono' }
      ];
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">分销播报（按商品）</div></div>' + tableView(dcols, m.distribution || []) + '</div>';
      return html;
    },

    deputy: function (d) {
      var m = d.deputy || {};
      var html = '<div class="view-title">副总业绩</div><div class="view-sub">各副总团队目标完成情况 · 数据来源：WPS共享表格（示例） · ' + esc(m.updated || '-') + '</div>';
      html += kpiRow(m.kpis);
      html += '<div class="grid-2b">';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">完成率对比(%)</div></div>' + (window.chartHelpers ? window.chartHelpers.vBars(m.chart || [], { unit: '%' }) : '') + '</div>';
      var dcols = [
        { key: 'name', label: '姓名' }, { key: 'target', label: '目标(万)', cls: 'mono' },
        { key: 'done', label: '完成(万)', cls: 'mono' }, { key: 'rate', label: '完成率(%)', cls: 'mono' }, { key: 'status', label: '状态', tag: 'status' }
      ];
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">副总团队明细</div></div>' + tableView(dcols, m.rows || []) + '</div>';
      html += '</div>';
      return html;
    },

    preference: function (d) {
      var m = d.preference || {};
      var html = '<div class="view-title">商品喜好</div><div class="view-sub">用户商品偏好分析 · 数据来源：WPS共享表格（示例） · ' + esc(m.updated || '-') + '</div>';
      html += '<div class="grid-2b">';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">品类喜好度</div></div>' + (window.chartHelpers ? window.chartHelpers.hBars((m.byCategory || []).map(function (x) { return { label: x.category, value: x.likes, color: '#ff7aa8' }; }), {}) : '') + '</div>';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">商品 TOP 喜好</div></div>';
      html += (m.top || []).map(function (t, i) { return '<div class="list-item"><div class="li-name">' + (i + 1) + '. ' + esc(t.name) + '</div><span class="pill" style="color:#ff7aa8">' + esc(t.likes) + ' 票</span></div>'; }).join('') + '</div>';
      html += '</div>';
      return html;
    },

    forecast: function (d) {
      var m = d.forecast || {};
      var html = '<div class="view-title">业绩预估</div><div class="view-sub">月度业绩预估与置信度 · 数据来源：WPS共享表格（示例） · ' + esc(m.updated || '-') + '</div>';
      var s = m.summary || {};
      html += kpiRow([
        { title: '预估业绩', value: s.est != null ? s.est : '-', unit: '万', sub: '目标口径', trend: 'flat' },
        { title: '实际完成', value: s.actual != null ? s.actual : '-', unit: '万', sub: '已发生', trend: 'up' },
        { title: '预估置信度', value: s.confidence != null ? s.confidence : '-', unit: '%', sub: '模型置信', trend: 'flat' }
      ]);
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">月度业绩预估(万)</div></div>' + (window.chartHelpers ? window.chartHelpers.vBars(m.months || [], { unit: ' 万' }) : '') + '</div>';
      var fcols = [
        { key: 'month', label: '月份' }, { key: 'est', label: '预估(万)', cls: 'mono' },
        { key: 'actual', label: '实际(万)', cls: 'mono' }, { key: 'confidence', label: '置信度(%)', cls: 'mono' }
      ];
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">预估明细</div></div>' + tableView(fcols, m.months || []) + '</div>';
      return html;
    }
  };

  function listWithChange(list) {
    return (list || []).map(function (x) {
      var up = x.change >= 0;
      return '<div class="list-item"><div><div class="li-name">' + esc(x.name) + '</div><div class="li-meta">' + esc(x.revenue || '') + '</div></div><span class="pill" style="color:' + (up ? '#2bbf7a' : '#ef5b5b') + '">' + (up ? '+' : '') + esc(x.change) + '%</span></div>';
    }).join('');
  }
  function poolPanel(title, color, rows, sub) {
    var colorMap = { green: '#e6f7ee', yellow: '#fff8e1', red: '#fdeaea' };
    var tcolor = { green: '#1f9d5b', yellow: '#b8860b', red: '#d64545' };
    var body = rows.length ? rows.map(function (r) {
      return '<div class="list-item"><div><div class="li-name">' + esc(r.name) + '</div><div class="li-meta">视频数 ' + esc(r.videos) + '</div></div><span class="pill" style="color:' + tcolor[color] + '">' + esc(r.margin) + '%</span></div>';
    }).join('') : '<div class="empty">无</div>';
    return '<div class="panel" style="background:' + colorMap[color] + '"><div class="panel-head"><div class="ph-title" style="color:' + tcolor[color] + '">' + title + ' (' + rows.length + ')</div><div class="ph-sub">' + esc(sub || '') + '</div></div>' + body + '</div>';
  }

  // ---------- 渲染 ----------
  function renderNav() {
    var nav = $('nav');
    nav.innerHTML = MODULES.map(function (m) {
      return '<div class="nav-item ' + (m.key === state.current ? 'active' : '') + '" data-key="' + m.key + '">' + icon(m.key) + '<span>' + m.label + '</span></div>';
    }).join('');
    Array.prototype.forEach.call(nav.querySelectorAll('.nav-item'), function (el) {
      el.onclick = function () { switchModule(el.getAttribute('data-key')); };
    });
  }

  function renderView() {
    var content = $('content');
    var fn = VIEWS[state.current] || VIEWS.home;
    var title = (MODULES.filter(function (m) { return m.key === state.current; })[0] || {}).label || '首页';
    var html = fn(state.data || {});
    // 顶部追加「上次更新」提示
    var upd = state.data && state.data.updatedAt ? new Date(state.data.updatedAt).toLocaleString('zh-CN') : '未知';
    html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span class="refresh-tip"><span class="dot"></span>数据每 20 分钟自动刷新 · 上次更新：' + upd + '</span><button class="btn-login" style="width:auto;padding:8px 16px" onclick="window.__refresh()">立即刷新</button></div>' + html;
    content.innerHTML = html;
    $('crumb').textContent = title;
  }

  function switchModule(key) {
    state.current = key;
    renderNav();
    renderView();
  }

  window.__refresh = function () {
    fetch('/api/refresh', { method: 'POST' }).then(function (r) { return r.json(); }).then(function () { return fetchData(true); });
  };

  // ---------- 数据 ----------
  function fetchData(force) {
    return fetch('/api/data').then(function (r) {
      if (r.status === 401) { location.reload(); return null; }
      return r.json();
    }).then(function (d) {
      if (!d) return;
      if (!force && state.lastUpdated && d.updatedAt === state.lastUpdated) return;
      state.data = d;
      state.lastUpdated = d.updatedAt;
      renderView();
    }).catch(function (e) { console.error(e); });
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(function () { fetchData(false); }, 60000);
  }

  function tickClock() {
    var now = new Date();
    var s = now.getFullYear() + '/' + String(now.getMonth() + 1).padStart(2, '0') + '/' + String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
    var el = $('topClock'); if (el) el.textContent = s;
  }

  // ---------- 登录 ----------
  function doLogin(e) {
    e.preventDefault();
    var u = $('username').value.trim();
    var p = $('password').value;
    $('loginErr').textContent = '';
    fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.ok) {
          if ($('remember').checked) { try { localStorage.setItem('dp_remember', JSON.stringify({ u: u, p: p })); } catch (e) {} }
          enterApp(res.j.user);
        } else {
          $('loginErr').textContent = (res.j && res.j.error) || '登录失败';
        }
      }).catch(function () { $('loginErr').textContent = '网络错误'; });
  }

  function enterApp(user) {
    state.user = user;
    $('loginWrap').style.display = 'none';
    $('app').classList.add('show');
    $('userName').textContent = user.name || user.username;
    $('avatar').textContent = (user.name || user.username || '?').charAt(0);
    renderNav();
    fetchData(true);
    startPolling();
  }

  function logout() {
    fetch('/api/logout', { method: 'POST' }).then(function () { location.reload(); });
  }

  // ---------- 初始化 ----------
  function init() {
    // 记住密码回填
    try {
      var rem = JSON.parse(localStorage.getItem('dp_remember') || 'null');
      if (rem) { $('username').value = rem.u || ''; $('password').value = rem.p || ''; $('remember').checked = true; }
    } catch (e) {}
    $('loginForm').addEventListener('submit', doLogin);
    $('logoutBtn').onclick = logout;
    $('collapseBtn').onclick = function () {
      var sb = document.querySelector('.sidebar');
      sb.style.width = sb.style.width === '64px' ? '220px' : '64px';
    };
    setInterval(tickClock, 1000); tickClock();

    fetch('/api/me').then(function (r) { return r.json(); }).then(function (j) {
      if (j.user) enterApp(j.user);
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
