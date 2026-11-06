/* 第一分公司数据中台 · 前端应用层
 * 设计目标：从「报表堆」变成「决策台」——先给结论，再给证据，最后才是明细。
 */
(function () {
  'use strict';

  var RAWCH = window.chartHelpers;
  var IN = window.Insights;

  // ---------- 图表挂载层 ----------
  // 以前图表用固定 680 宽的 viewBox + preserveAspectRatio="none" 直接拉伸，
  // 容器一宽文字和圆点就被横向压扁。现在改成：先占位，DOM 落地后按容器实测宽度重画。
  var SVGNS = 'http://www.w3.org/2000/svg';
  var chartSpecs = {};
  var chartSeq = 0;

  function chartBox(kind, data, opts) {
    var id = 'c' + (++chartSeq);
    chartSpecs[id] = { kind: kind, data: data, opts: opts || {} };
    return '<div class="chart-mount" data-cid="' + id + '"></div>';
  }

  var CH = {
    line: function (d, o) { return chartBox('line', d, o); },
    multiLine: function (d, o) { return chartBox('multiLine', d, o); },
    scatter: function (d, o) { return chartBox('scatter', d, o); },
    hBars: function (d, o) { return chartBox('hBars', d, o); },
    vBars: function (d, o) { return chartBox('vBars', d, o); },
    donutChart: function (d, o) { return chartBox('donutChart', d, o); },
    donut: function (d, o) { return chartBox('donut', d, o); },
    spark: RAWCH.spark,
    fmtShort: RAWCH.fmtShort,
    niceMax: RAWCH.niceMax,
    PALETTE: RAWCH.PALETTE
  };

  // 按给定宽度画一张图（宽高比由 viewBox 决定，均匀缩放，不再变形）
  function drawSpec(spec, w, big) {
    var o = {};
    var k;
    for (k in spec.opts) if (Object.prototype.hasOwnProperty.call(spec.opts, k)) o[k] = spec.opts[k];
    if (w) o.w = w;
    if (big) {
      if (o.height) o.height = Math.max(o.height, 340);
      else if (spec.kind === 'line' || spec.kind === 'multiLine') o.height = 460;
      else if (spec.kind === 'scatter') o.height = 460;
      if (spec.kind === 'hBars') o.rowH = Math.max(38, o.rowH || 0);
      if (spec.kind === 'donutChart') { o.size = 380; o.stroke = 44; }
      o.showValue = spec.kind === 'line' && spec.data.length <= 12 ? true : o.showValue;
    }
    switch (spec.kind) {
      case 'line': return RAWCH.line(spec.data, o);
      case 'multiLine': return RAWCH.multiLine(spec.data, o);
      case 'scatter': return RAWCH.scatter(spec.data, o);
      case 'hBars': return RAWCH.hBars(spec.data, o);
      case 'vBars': return RAWCH.vBars(spec.data, o);
      case 'donutChart': return RAWCH.donutChart(spec.data, o);
      case 'donut': return RAWCH.donut(spec.data, o);
      default: return '';
    }
  }

  function bindCrosshair(el) {
    var svg = el.querySelector('svg.chart');
    if (!svg || svg.getAttribute('data-cx') === '1') return;
    var geo;
    try { geo = JSON.parse(svg.getAttribute('data-geo') || 'null'); } catch (e) { geo = null; }
    if (!geo || !geo.L || !geo.n) return;
    svg.setAttribute('data-cx', '1');
    var lo = geo.L, hi = geo.W - (geo.R || 0), n = geo.n;
    var line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('class', 'cx-line');
    line.setAttribute('y1', geo.T);
    line.setAttribute('y2', geo.H - (geo.B || 0));
    line.setAttribute('x1', lo); line.setAttribute('x2', lo);
    line.style.display = 'none';
    svg.appendChild(line);
    svg.addEventListener('mousemove', function (e) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var x = (e.clientX - r.left) * (geo.W / r.width);
      var i = n === 1 ? 0 : Math.round(((x - lo) / Math.max(1, hi - lo)) * (n - 1));
      if (i < 0) i = 0;
      if (i > n - 1) i = n - 1;
      var px = n === 1 ? (lo + hi) / 2 : lo + (i * (hi - lo)) / (n - 1);
      line.setAttribute('x1', px); line.setAttribute('x2', px);
      line.style.display = '';
    });
    svg.addEventListener('mouseleave', function () { line.style.display = 'none'; });
  }

  function drawMount(el, spec) {
    var w = Math.round(el.clientWidth || el.parentNode && el.parentNode.clientWidth || 680);
    if (w < 240) w = 680;
    el.setAttribute('data-w', String(w));
    var html = drawSpec(spec, w, false);
    if (!html) return;
    el.innerHTML = html;
    el.setAttribute('data-mounted', '1');
    bindCrosshair(el);
    if (!el.querySelector('.chart-zoom')) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chart-zoom';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5"/></svg><span>放大</span>';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openChartModal(el.getAttribute('data-cid'));
      });
      el.appendChild(btn);
    }
  }

  function mountCharts(root) {
    var list = (root || document).querySelectorAll('.chart-mount[data-cid]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var id = el.getAttribute('data-cid');
      var spec = chartSpecs[id];
      if (!spec) continue;
      if (el.getAttribute('data-mounted') === '1') continue;
      drawMount(el, spec);
    }
    // 清掉已经不在页面上的图表定义，长时间挂着也不会越攒越多
    var live = {};
    for (var j = 0; j < list.length; j++) live[list[j].getAttribute('data-cid')] = 1;
    if (cmState.cid) live[cmState.cid] = 1;
    for (var key in chartSpecs) {
      if (Object.prototype.hasOwnProperty.call(chartSpecs, key) && !live[key]) delete chartSpecs[key];
    }
  }

  var chartResizeTimer = null;
  function relayoutCharts() {
    var list = document.querySelectorAll('.chart-mount[data-mounted="1"]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var spec = chartSpecs[el.getAttribute('data-cid')];
      if (!spec) continue;
      var w = Math.round(el.clientWidth || 0);
      if (!w) continue;
      if (Math.abs(w - Number(el.getAttribute('data-w') || 0)) < 10) continue;
      el.removeAttribute('data-mounted');
      el.querySelectorAll('.chart-zoom').forEach(function (b) { b.remove(); });
      drawMount(el, spec);
    }
  }

  // ---------- 大图弹窗 ----------
  var cmState = { cid: null, hidden: {}, mode: 'chart' };

  function openChartModal(cid) {
    var spec = chartSpecs[cid];
    var mask = $('chartMask');
    if (!spec || !mask) return;
    cmState.cid = cid;
    cmState.hidden = {};
    cmState.mode = 'chart';
    var host = document.querySelector('.chart-mount[data-cid="' + cid + '"]');
    var panel = host ? (host.closest('.chart-panel') || host.closest('.panel')) : null;
    var title = panel ? panel.querySelector('.ph-title') : null;
    var main = title ? (title.childNodes[0] && title.childNodes[0].textContent || '') : '图表';
    var subEl = title ? title.querySelector('.ph-sub') : null;
    $('cmTitle').textContent = String(main).trim() || '图表';
    $('cmSub').textContent = subEl ? subEl.textContent.trim() : '';
    $('cmToggle').textContent = '数据表';
    mask.classList.add('show');
    document.body.classList.add('cm-open');
    renderChartModal();
  }

  function closeChartModal() {
    var mask = $('chartMask');
    if (mask) mask.classList.remove('show');
    document.body.classList.remove('cm-open');
    cmState.cid = null;
  }

  function seriesVisible(spec, i) {
    return !cmState.hidden[i];
  }

  function modalSpec() {
    var spec = chartSpecs[cmState.cid];
    if (!spec) return null;
    if (spec.kind !== 'multiLine') return spec;
    var series = spec.data.filter(function (s, i) { return seriesVisible(spec, i); });
    var copy = { kind: spec.kind, opts: spec.opts };
    copy.data = series.length ? series : [spec.data[0]];
    return copy;
  }

  function renderChartModal() {
    var spec = cmState.cid ? chartSpecs[cmState.cid] : null;
    var body = $('cmBody'), legendEl = $('cmLegend');
    if (!spec || !body) return;

    // 图例（多系列可点击切换）
    var lg = '';
    if (spec.kind === 'multiLine') {
      lg = spec.data.map(function (s, i) {
        var color = s.color || RAWCH.PALETTE[i % RAWCH.PALETTE.length];
        return '<button type="button" class="lg-chip' + (seriesVisible(spec, i) ? '' : ' off') +
          '" data-lg="' + i + '"><i style="background:' + color + '"></i>' + esc(s.name) + '</button>';
      }).join('');
    } else if (spec.kind === 'donutChart') {
      // 环形图没有坐标轴，颜色必须配图例才看得懂
      var tot = spec.data.reduce(function (a, b) { return a + b.value; }, 0) || 1;
      lg = spec.data.map(function (s, i) {
        var color = s.color || RAWCH.PALETTE[i % RAWCH.PALETTE.length];
        return '<span class="lg-chip static"><i style="background:' + color + '"></i>' + esc(s.label) +
          '<b>' + (s.value / tot * 100).toFixed(1) + '%</b></span>';
      }).join('');
    }
    legendEl.innerHTML = lg;
    legendEl.style.display = lg ? '' : 'none';

    if (cmState.mode === 'table') {
      body.innerHTML = specTableHTML(spec);
      return;
    }

    var w = Math.max(560, Math.min(1360, body.clientWidth || 1000));
    var view = modalSpec();
    body.innerHTML = '<div class="cm-chart" data-cw="' + w + '">' + drawSpec(view, w, true) + '</div>';
    var svgHost = body.querySelector('.cm-chart');
    if (svgHost) bindCrosshair(svgHost);
  }

  function specTableHTML(spec) {
    var rows = [], head = [];
    var fmt = spec.opts && spec.opts.fmt;
    function f(v) { return fmt ? fmt(v) : RAWCH.fmtShort(v); }
    if (spec.kind === 'multiLine') {
      var names = spec.data.map(function (s) { return s.name; });
      head = ['日期'].concat(names);
      var len = 0;
      spec.data.forEach(function (s) { if (s.points.length > len) len = s.points.length; });
      for (var i = 0; i < len; i++) {
        var r = [spec.data[0].points[i] ? spec.data[0].points[i].label : ('第 ' + (i + 1) + ' 项')];
        spec.data.forEach(function (s) { r.push(s.points[i] ? f(s.points[i].value) : '—'); });
        rows.push(r);
      }
    } else if (spec.kind === 'line') {
      head = ['日期', '数值'];
      spec.data.forEach(function (p) { rows.push([p.label, f(p.value)]); });
    } else if (spec.kind === 'scatter') {
      head = ['名称', (spec.opts.xLabel || 'X'), (spec.opts.yLabel || 'Y')];
      spec.data.forEach(function (p) { rows.push([p.label, RAWCH.fmtShort(p.x), p.y]); });
    } else if (spec.kind === 'hBars' || spec.kind === 'vBars') {
      head = ['名称', '数值'];
      spec.data.forEach(function (p) { rows.push([p.label, p.value + (spec.opts.unit || '')]); });
    } else if (spec.kind === 'donutChart') {
      head = ['名称', '数值', '占比'];
      var total = spec.data.reduce(function (a, b) { return a + b.value; }, 0) || 1;
      spec.data.forEach(function (p) { rows.push([p.label, RAWCH.fmtShort(p.value), (p.value / total * 100).toFixed(1) + '%']); });
    } else {
      return '<div class="empty">这类图表暂不支持表格视图</div>';
    }
    var html = '<div class="cm-table-wrap"><table class="tbl compact"><thead><tr>' +
      head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c, i) { return '<td' + (i ? ' class="mono"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    return html;
  }

  function bindChartModal() {
    var mask = $('chartMask');
    if (!mask) return;
    $('cmClose').onclick = closeChartModal;
    mask.onclick = function (e) { if (e.target === mask) closeChartModal(); };
    $('cmToggle').onclick = function () {
      cmState.mode = cmState.mode === 'chart' ? 'table' : 'chart';
      $('cmToggle').textContent = cmState.mode === 'chart' ? '数据表' : '看图表';
      renderChartModal();
    };
    $('cmLegend').onclick = function (e) {
      var chip = e.target.closest('[data-lg]');
      if (!chip) return;
      var i = chip.getAttribute('data-lg');
      if (cmState.hidden[i]) delete cmState.hidden[i];
      else cmState.hidden[i] = true;
      renderChartModal();
    };
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && mask.classList.contains('show')) closeChartModal();
    });
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (mask.classList.contains('show') && cmState.mode === 'chart') {
          clearTimeout(bindChartModal._t);
          bindChartModal._t = setTimeout(renderChartModal, 120);
        }
      }).observe($('cmBody'));
    }
  }

  // 监听 DOM 变化：任何视图重绘后自动把占位 div 画成图
  function observeCharts() {
    if (!window.MutationObserver) { mountCharts(document); return; }
    var pending = false;
    var mo = new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; mountCharts(document); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    var rt = null;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(relayoutCharts, 180);
    });
    mountCharts(document);
  }

  // ---------- 图标 ----------
  var ICONS = {
    home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
    anchorRank: 'M5 9h3v11H5zm5.5-5h3v16h-3zm5.5 7h3v9h-3z',
    anchorPerformance: 'M3 13h4v8H3zm7-6h4v14h-4zm7-9h4v23h-4z',
    commodity: 'M4 7h16l-1.5 13H5.5zM9 7V5a3 3 0 0 1 6 0v2',
    forecast: 'M3 17l6-6 4 4 8-8',
    rongpin: 'M3 6h18v3H3zm0 5h18v3H3zm0 5h12v3H3z',
    gmv: 'M12 2 3 7v10l9 5 9-5V7zm0 2.2 6.5 3.6L12 11.5 5.5 7.8zM5 9.7l6 3.3v6.5l-6-3.3zm14 0v6.5l-6 3.3V13z',
    settle: 'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22zm1 17h-2v-1.2a4 4 0 0 1-2.8-1.7l1.5-1.2c.4.7 1 1.1 1.8 1.1.7 0 1.1-.3 1.1-.8 0-.6-.5-.8-1.6-1.2-1.5-.5-2.7-1.2-2.7-2.9 0-1.4 1-2.4 2.7-2.7V6h2v1.4c1 .2 1.8.8 2.3 1.6l-1.5 1.2c-.4-.6-.9-1-1.6-1-.6 0-1 .3-1 .7 0 .5.5.7 1.7 1.1 1.6.5 2.6 1.3 2.6 3 0 1.5-1 2.5-2.5 2.8z',
    rate: 'M4 20h4V9H4zm6 0h4V4h-4zm6 0h4v-7h-4z',
    user: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z'
  };
  function icon(key) {
    return '<svg viewBox="0 0 24 24"><path d="' + (ICONS[key] || ICONS.home) + '"/></svg>';
  }

  // ---------- 模块 ----------
  var MODULES = [
    { key: 'home', label: '经营驾驶舱', group: '概览' },
    { key: 'anchorRank', label: '主播榜单', group: '经营' },
    { key: 'anchorPerformance', label: '主播业绩', group: '经营' },
    { key: 'forecast', label: '业绩预估', group: '经营' },
    { key: 'rongpin', label: '预估结算', group: '经营' },
    { key: 'commodity', label: '商品结构', group: '货品' }
  ];

  var state = {
    user: null, data: null, current: 'home', lastUpdated: null, pollTimer: null,
    search: {}, page: {}, sort: {}, pageSize: {},
    tableMeta: {},          // moduleKey -> { cols, rows, opts }
    filter: {},             // 主播榜快捷筛选
    cmdIndex: null,         // 命令面板索引
    _scroll: {},
    month: '',              // '' = 各页自动取最新月；'YYYY-MM' = 全局指定月份
    sync: null,             // /api/sync 返回的同步状态
    metric: {},             // 主播详情页的指标切换
    profile: null           // 当前查看的主播名
  };

  // ---------- 基础工具 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function num(v) { return IN ? IN.num(v) : parseFloat(String(v == null ? '' : v).replace(/[,，%\s]/g, '')) || 0; }
  function wan(v) { var n = num(v) / 10000; return n.toLocaleString('zh-CN', { maximumFractionDigits: n >= 100 ? 0 : 2 }); }
  function wanNum(v) { var n = Math.round((num(v) / 10000) * 100) / 100; return n; }
  // 金额自动进位：≥1亿用亿，≥1万用万，否则元
  function amountParts(v) {
    var n = num(v);
    var a = Math.abs(n);
    if (a >= 100000000) return { value: (n / 100000000).toFixed(2), unit: '亿' };
    if (a >= 10000) return { value: (n / 10000).toFixed(a >= 1000000 ? 0 : 2), unit: '万' };
    return { value: n.toLocaleString('zh-CN', { maximumFractionDigits: 0 }), unit: '元' };
  }
  function money(v) { return num(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
  // 数值本身已经是「万」时，坐标轴直接用纯数字，避免出现「1.0万」这种重复单位
  function plainNum(v) {
    var n = Number(v) || 0;
    return Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 10) / 10);
  }
  function pct1(v) { var n = Number(v); return (isFinite(n) ? (Math.round(n * 10) / 10) : 0) + '%'; }
  function modules() { return (state.data && state.data.modules) || {}; }
  function deltaHtml(v, unit) {
    var n = Number(v) || 0;
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    var arrow = n > 0 ? '▲' : n < 0 ? '▼' : '■';
    return '<span class="delta ' + cls + '">' + arrow + ' ' + (n > 0 ? '+' : '') + (Math.round(n * 10) / 10) + (unit || '%') + '</span>';
  }
  function statusTag(s) {
    var map = { '已完成': 'green', '未达标': 'red', '领先': 'green', '正常': 'blue', '预警': 'orange', '落后': 'red', '是': 'blue', '否': 'gray' };
    return '<span class="tag ' + (map[s] || 'gray') + '">' + esc(s) + '</span>';
  }
  function sourceLabel(src) {
    if (src === 'cloud') return '云数据库实时';
    if (src === 'wps') return 'WPS 直连';
    if (src === 'csv') return 'WPS 导出文件';
    return '示例数据';
  }
  function fmtTime(ms) {
    if (!ms) return '--';
    var d = new Date(ms);
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  // Excel 日期序列号（如 46330）转成 YYYY-MM-DD
  function fmtExcelDate(v) {
    var n = Number(v);
    if (!isFinite(n) || n < 20000 || n > 80000) return v;
    var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    return d.getUTCFullYear() + '-' + mm + '-' + dd;
  }

  // ---------- 时间与月份 ----------
  function relTime(iso) {
    if (!iso) return '--';
    var t = new Date(iso).getTime();
    if (!t || isNaN(t)) return '--';
    var diff = Date.now() - t;
    if (diff < 0) diff = 0;
    var m = Math.floor(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    var dd = Math.floor(h / 24);
    return dd < 30 ? dd + ' 天前' : '很久以前';
  }
  function fmtDateTime(iso) {
    if (!iso) return '--';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '--';
    return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function monthIdx(ym) { return Number(String(ym || '').slice(5, 7)) || 0; }
  function monthName(ym) {
    var y = String(ym || '').slice(0, 4), m = monthIdx(ym);
    if (!m) return ym || '';
    return (y ? y + '年' : '') + m + ' 月';
  }
  function ymOf(v) {
    var s = String(v == null ? '' : v);
    var m = s.match(/^(\d{4})-(\d{2})/);
    return m ? m[1] + '-' + m[2] : '';
  }

  // 全平台出现过的月份（用于顶部月份选择器）
  function allMonths() {
    var set = {};
    var d = modules();
    var rank = d.anchorRank || {};
    if (rank.asOf) set[ymOf(rank.asOf)] = 1;
    (((d.commodity || {}).days) || []).forEach(function (x) { if (x && x.date) set[ymOf(x.date)] = 1; });
    (((d.anchorPerformance || {}).sheets) || []).forEach(function (s) { if (s && s.date) set[ymOf(s.date)] = 1; });
    parseForecastRows(d.forecast || {}).forEach(function (r) { set[r.month] = 1; });
    if (state.month) set[state.month] = 1;
    return Object.keys(set).filter(function (k) { return /^\d{4}-\d{2}$/.test(k); }).sort();
  }

  // 某个视图实际可用的月份；选中的月份不在范围内时退回最新月并标记 fallback
  function pickMonth(cov) {
    cov = (cov || []).filter(function (x) { return /^\d{4}-\d{2}$/.test(x); }).sort();
    if (!cov.length) return { month: '', cov: [], fallback: false };
    if (state.month && cov.indexOf(state.month) >= 0) return { month: state.month, cov: cov, fallback: false };
    return { month: cov[cov.length - 1], cov: cov, fallback: !!state.month };
  }
  function monthNotice(p, what) {
    if (!p.fallback) return '';
    return '<div class="notice"><span class="ni">i</span><span>' + esc(what || '该模块') +
      '目前只有 <b>' + esc(monthName(p.month)) + '</b> 的明细（源表还没有按月归档历史数据），已自动切到该月。' +
      '要看 <b>' + esc(monthName(state.month)) + '</b> 需要先补齐那个月的数据。</span></div>';
  }
  function anchorMonths() {
    var rank = modules().anchorRank || {};
    return rank.asOf ? [ymOf(rank.asOf)] : [];
  }

  // ---------- CSV 导出 ----------
  function toCSV(columns, rows) {
    function cell(v) {
      v = (v == null ? '' : String(v));
      if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }
    var lines = [columns.map(function (c) { return cell(c.label); }).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return cell(r[c.key]); }).join(',')); });
    return '\ufeff' + lines.join('\r\n');
  }
  function downloadCSV(columns, rows, filename) {
    var blob = new Blob([toCSV(columns, rows)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
  }
  function exportSVGToPNG(svgEl, filename) {
    var xml = new XMLSerializer().serializeToString(svgEl);
    var svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(svgBlob);
    var img = new Image();
    img.onload = function () {
      var vb = svgEl.viewBox && svgEl.viewBox.baseVal;
      var w = (vb && vb.width) || 680, h = (vb && vb.height) || 300;
      var canvas = document.createElement('canvas');
      canvas.width = w * 2; canvas.height = h * 2;
      var ctx = canvas.getContext('2d');
      ctx.scale(2, 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (b) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 800);
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.onerror = function () { alert('图表导出失败'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  // ---------- 通用组件 ----------
  function viewHead(title, sub, actions) {
    return '<div class="view-head"><div><div class="view-title">' + esc(title) + '</div>' +
      '<div class="view-sub">' + sub + '</div></div>' +
      (actions ? '<div class="view-actions">' + actions + '</div>' : '') + '</div>';
  }
  function kpiCards(list) {
    var colors = ['#2f6fed', '#7a5cff', '#12a76c', '#f5871f', '#e5484d'];
    return '<div class="kpi-row">' + (list || []).map(function (k, i) {
      var c = k.color || colors[i % colors.length];
      var val = k.value, unit = k.unit || '';
      if (k.money != null) {
        var p = amountParts(k.money);
        val = p.value; unit = p.unit;
      }
      var spark = k.spark ? '<div class="kpi-spark">' + CH.spark(k.spark, { color: c }) + '</div>' : '';
      return '<div class="kpi-card' + (k.go ? ' clickable' : '') + (k.spark ? ' has-spark' : '') + '"' + (k.go ? ' data-goto="' + esc(k.go) + '"' : '') + '>' +
        '<div class="kpi-icon" style="background:' + c + '">' + icon(k.icon || 'home') + '</div>' +
        '<div class="kpi-body"><div class="k-title">' + esc(k.title) + '</div>' +
        '<div class="k-val">' + esc(val) + '<span class="unit">' + esc(unit) + '</span></div>' +
        '<div class="k-sub">' + (k.sub || '') + '</div></div>' + spark +
        (k.go ? '<span class="k-go">›</span>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function panel(title, sub, body, tools, cls) {
    return '<div class="panel ' + (cls || '') + '"><div class="panel-head"><div class="ph-title">' + esc(title) +
      (sub ? ' <span class="ph-sub">' + esc(sub) + '</span>' : '') + '</div>' +
      (tools ? '<div class="ph-tools">' + tools + '</div>' : '') + '</div>' + body + '</div>';
  }
  function chartPanel(title, sub, svg, opts) {
    opts = opts || {};
    return '<div class="panel chart-panel"><div class="panel-head"><div class="ph-title">' + esc(title) +
      (sub ? ' <span class="ph-sub">' + esc(sub) + '</span>' : '') + '</div>' +
      '<div class="ph-tools"><span class="ph-hint">点图表可放大</span><button class="tbtn sm" data-role="img">导出图片</button></div></div>' +
      (opts.legend || '') + svg + '</div>';
  }

  // ---------- 表格（分页 + 排序 + 搜索） ----------
  function rowKey(mod, r, i) {
    return mod + '|' + (r.anchor || r.name || r.sheet || r.date || r.month || i);
  }
  function sortRows(rows, key, dir, cols) {
    var col = null;
    for (var i = 0; i < cols.length; i++) if (cols[i].key === key) col = cols[i];
    var numeric = col && (col.cls === 'mono' || col.num);
    var arr = rows.slice();
    arr.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (numeric) { x = num(x); y = num(y); return dir === 'asc' ? x - y : y - x; }
      x = String(x == null ? '' : x); y = String(y == null ? '' : y);
      return dir === 'asc' ? x.localeCompare(y, 'zh') : y.localeCompare(x, 'zh');
    });
    return arr;
  }

  // 过滤 + 排序 + 分页
  function tableState(mod, cols, rows, opts) {
    var list = rows.slice();
    var q = (state.search[mod] || '').trim().toLowerCase();
    if (q) {
      list = list.filter(function (r) {
        return cols.some(function (c) {
          return String(r[c.key] == null ? '' : r[c.key]).toLowerCase().indexOf(q) >= 0;
        });
      });
    }
    var sk = state.sort[mod];
    if (sk) list = sortRows(list, sk.key, sk.dir, cols);
    var size = state.pageSize[mod] || opts.pageSize || 20;
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / size));
    var pg = Math.min(Math.max(1, state.page[mod] || 1), pages);
    state.page[mod] = pg;
    return { all: list, total: total, pages: pages, page: pg, size: size, rows: list.slice((pg - 1) * size, pg * size) };
  }

  function pagerHtml(mod, st) {
    if (st.pages <= 1 && st.total <= st.size) {
      return '<div class="pager"><span class="pg-info">共 ' + st.total + ' 条</span></div>';
    }
    var out = '<div class="pager"><span class="pg-info">共 ' + st.total + ' 条 · 第 ' + st.page + '/' + st.pages + ' 页</span>';
    out += '<button class="pg" data-pg="' + (st.page - 1) + '"' + (st.page <= 1 ? ' disabled' : '') + '>‹</button>';
    var start = Math.max(1, st.page - 2), end = Math.min(st.pages, start + 4);
    start = Math.max(1, end - 4);
    if (start > 1) out += '<button class="pg" data-pg="1">1</button>' + (start > 2 ? '<span class="pg-info">…</span>' : '');
    for (var i = start; i <= end; i++) {
      out += '<button class="pg' + (i === st.page ? ' on' : '') + '" data-pg="' + i + '">' + i + '</button>';
    }
    if (end < st.pages) out += (end < st.pages - 1 ? '<span class="pg-info">…</span>' : '') + '<button class="pg" data-pg="' + st.pages + '">' + st.pages + '</button>';
    out += '<button class="pg" data-pg="' + (st.page + 1) + '"' + (st.page >= st.pages ? ' disabled' : '') + '>›</button>';
    out += '</div>';
    return out;
  }

  function cellHtml(c, r, idx) {
    if (c.render) return '<td class="' + (c.cls || '') + '">' + c.render(r, idx) + '</td>';
    if (c.tag === 'status') return '<td>' + statusTag(r[c.key]) + '</td>';
    if (c.fmt) return '<td class="' + (c.cls || '') + '">' + c.fmt(r[c.key], r) + '</td>';
    return '<td class="' + (c.cls || '') + '">' + esc(r[c.key]) + '</td>';
  }

  // 只渲染表体（供局部刷新，避免整页重绘丢焦点）
  function buildTableInner(mod, cols, rows, opts) {
    var st = tableState(mod, cols, rows, opts);
    var sk = state.sort[mod];
    var head = '<tr>' + cols.map(function (c) {
      var ind = (sk && sk.key === c.key) ? (sk.dir === 'asc' ? ' <span style="color:#2f6fed">▲</span>' : ' <span style="color:#2f6fed">▼</span>') : '';
      var cls = 'sortable' + (c.cls === 'mono' ? ' num' : '');
      return '<th class="' + cls + '" data-col="' + c.key + '">' + esc(c.label) + ind + '</th>';
    }).join('') + '</tr>';

    var body = st.rows.map(function (r, i) {
      var globalIdx = (st.page - 1) * st.size + i;
      var clickable = opts.onRow ? ' drow' : '';
      return '<tr class="' + clickable + '" data-row="' + globalIdx + '">' +
        cols.map(function (c) { return cellHtml(c, r, globalIdx); }).join('') + '</tr>';
    }).join('');

    return '<div class="tbl-wrap"><table class="tbl"><thead>' + head + '</thead><tbody>' +
      (body || '<tr><td colspan="' + cols.length + '" class="empty">' + esc(opts.empty || '暂无数据') + '</td></tr>') +
      '</tbody></table></div>' + pagerHtml(mod, st);
  }

  function dataTable(mod, cols, rows, opts) {
    opts = opts || {};
    state.tableMeta[mod] = { cols: cols, rows: rows, opts: opts };

    var tools = '<div class="tbl-tools">';
    if (opts.exportName) tools += '<button class="tbtn" data-role="export" data-mod="' + mod + '">导出 CSV</button>';
    tools += '<span class="tlabel">搜索</span><input class="tinput" data-role="search" data-mod="' + mod +
      '" value="' + esc(state.search[mod] || '') + '" placeholder="' + esc(opts.searchPlaceholder || '输入关键词筛选…') + '"/>';
    tools += '<span class="tlabel">每页</span><select class="tselect" data-role="pagesize" data-mod="' + mod + '">' +
      [10, 20, 50, 100].map(function (n) {
        return '<option value="' + n + '"' + ((state.pageSize[mod] || opts.pageSize || 20) === n ? ' selected' : '') + '>' + n + '</option>';
      }).join('') + '</select>';
    if (opts.extraTools) tools += opts.extraTools;
    tools += '</div>';

    return '<div class="tbl-block" data-block="' + mod + '">' + tools +
      '<div data-tblroot="' + mod + '">' + buildTableInner(mod, cols, rows, opts) + '</div></div>';
  }

  // 局部刷新某张表（搜索/分页/排序时调用）
  function refreshTable(mod, resetPage) {
    var meta = state.tableMeta[mod];
    if (!meta) return;
    if (resetPage) state.page[mod] = 1;
    var el = document.querySelector('[data-tblroot="' + mod + '"]');
    if (el) el.innerHTML = buildTableInner(mod, meta.cols, meta.rows, meta.opts);
  }

  // ---------- 洞察卡 ----------
  function insightCards(list) {
    if (!list || !list.length) return '<div class="empty">暂无洞察</div>';
    return '<div class="insight-grid">' + list.map(function (it, i) {
      return '<div class="insight ' + it.level + '" data-insight="' + i + '">' +
        '<div class="insight-top"><span class="insight-tag">' + esc(it.tag) + '</span>' +
        (it.metric ? '<span class="insight-metric">' + esc(it.metric) + '</span>' : '') + '</div>' +
        '<div class="insight-title">' + esc(it.title) + '</div>' +
        '<div class="insight-detail">' + esc(it.detail) + '</div>' +
        (it.action ? '<div class="insight-go">查看明细 →</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  // ---------- 首页：经营驾驶舱 ----------
  function viewHome() {
    var d = modules();
    var rank = d.anchorRank || {};
    var comm = d.commodity || {};
    var rows = (rank.rows || []).filter(function (r) { return r.anchor; });
    var s = rank.summary || {};

    if (!rows.length) {
      return viewHead('经营驾驶舱', '等待数据接入') +
        panel('暂无数据', '', '<div class="empty">同步助手还没有把结算工作簿写进云库。确认助手在运行后，点击右上角「立即刷新」。</div>');
    }

    var series = IN.activeDays(IN.dailySeries(rows), 'gmv');
    var sparkVals = series.map(function (x) { return x.gmv; });
    var cur = series.length ? series[series.length - 1].gmv : 0;
    var prev = series.length > 1 ? series[series.length - 2].gmv : 0;
    var dod = prev > 0 ? ((cur - prev) / prev) * 100 : 0;
    var activeAnchors = rows.filter(function (r) { return num(r.gmvCum) > 0; }).length;
    var totalGmv = num(s.gmvCum) || sparkVals.reduce(function (a, b) { return a + b; }, 0);
    var pm = pickMonth(anchorMonths());

    var html = viewHead('经营驾驶舱',
      (rank.asOf ? '数据截止 <b>' + esc(rank.asOf) + '</b> · ' : '') +
      rows.length + ' 位主播在册，' + activeAnchors + ' 位本期有产出 · ' + sourceLabel(rank.source),
      '<span class="fresh-dot"><i></i>每 60 秒自动刷新</span>' +
      '<button class="tbtn" data-role="refresh">立即刷新</button>');

    html += monthNotice(pm, '主播结算数据');

    // KPI（点击可跳转到对应页面）
    html += kpiCards([
      { icon: 'gmv', color: '#2f6fed', title: '累计下播 GMV', money: totalGmv, sub: activeAnchors + ' 位主播有产出', spark: sparkVals, go: 'anchorRank' },
      { icon: 'anchorPerformance', color: '#7a5cff', title: '当日 GMV', money: cur, sub: deltaHtml(dod) + ' 环比', spark: sparkVals.slice(-4), go: 'anchorPerformance' },
      { icon: 'settle', color: '#12a76c', title: '预估结算 GMV', money: s.settleCum, sub: '整体 ' + pct1(s.calcRate), go: 'rongpin' },
      { icon: 'rate', color: '#f5871f', title: '平均结算率', value: pct1(s.avgRate), unit: '', sub: '主播算术均值' }
    ]);

    // 趋势
    var trendSvg = CH.line(series.map(function (x) { return { label: x.label, value: wanNum(x.gmv) }; }), {
      color: '#2f6fed', height: 250, fmt: function (v) { return v + '万'; }, yFmt: plainNum, showValue: series.length <= 8
    });

    // 结算榜：只按风控后结算GMV排序，与下播GMV榜区分开
    var bySettle = rows.filter(function (r) { return num(r.settleCum) > 0; })
      .sort(function (a, b) { return num(b.settleCum) - num(a.settleCum); });
    var mv = IN.movers(rows);
    var rated = rows.filter(function (r) { return num(r.gmvCum) > 0 && num(r.rate) > 0; });
    var avgRate = rated.length ? rated.reduce(function (a, r) { return a + num(r.rate); }, 0) / rated.length : 0;
    var watch = rated.slice().sort(function (a, b) { return num(a.rate) - num(b.rate); }).slice(0, 5);

    function rankRow(r, i, right, rightColor) {
      return '<div class="list-item"><div style="display:flex;align-items:center;gap:9px;min-width:0">' +
        '<span class="rank-badge ' + (i < 3 ? 'g' + (i + 1) : '') + '">' + (i + 1) + '</span>' +
        '<div style="min-width:0"><div class="li-name">' + esc(r.anchor) + '</div>' +
        '<div class="li-meta">' + esc(r.org || '') + (r.type ? ' · ' + esc(r.type) : '') + '</div></div></div>' +
        '<span class="pill" style="color:' + (rightColor || '#101828') + ';font-weight:700;white-space:nowrap">' + right + '</span></div>';
    }

    html += '<div class="grid-2">';
    html += '<div class="panel chart-panel"><div class="panel-head"><div class="ph-title">每日 GMV 走势 <span class="ph-sub">全员合计 · 万元</span></div>' +
      '<div class="ph-tools"><span class="ph-hint">点图表可放大</span><button class="tbtn sm" data-role="img">导出图片</button></div></div>' +
      '<div class="legend"><span><i style="background:#2f6fed"></i>日 GMV</span><span>峰值 ' + wan(Math.max.apply(null, sparkVals)) + ' 万</span><span>均值 ' +
      wan(sparkVals.reduce(function (a, b) { return a + b; }, 0) / (sparkVals.length || 1)) + ' 万</span></div>' + trendSvg + '</div>';

    html += '<div class="panel"><div class="panel-head"><div class="ph-title">结算 GMV 排行 ' +
      '<span class="ph-sub">风控后累计 · ' + bySettle.length + ' 位有结算</span></div>' +
      '<div class="ph-tools"><button class="tbtn sm" data-goto="anchorRank">查看全部</button></div></div>' +
      (bySettle.length
        ? bySettle.slice(0, 6).map(function (r, i) { return rankRow(r, i, wan(r.settleCum) + ' 万', '#12a76c'); }).join('')
        : '<div class="empty">本月还没有结算数据</div>') + '</div>';
    html += '</div>';

    // 智能洞察（全宽）
    var cards = IN.build(d);
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">智能洞察 <span class="ph-sub">基于当前数据自动计算 · ' + cards.length + ' 条</span></div></div>' +
      insightCards(cards) + '</div>';

    // 增长 / 关注
    html += '<div class="grid-2b">';
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">增长最快</div><span class="ph-sub">较前一日 GMV</span></div>' +
      (mv.risers.length ? mv.risers.slice(0, 5).map(function (r, i) {
        return rankRow(r, i, '+' + wan(r.delta) + ' 万', '#12a76c');
      }).join('') : '<div class="empty">本期无明显增长</div>') + '</div>';

    html += '<div class="panel"><div class="panel-head"><div class="ph-title">需要关注</div><span class="ph-sub">结算率由低到高</span></div>' +
      (watch.length ? watch.map(function (r, i) {
        return rankRow(r, i, pct1(r.rate), num(r.rate) < avgRate * 0.7 ? '#e5484d' : '#f5871f');
      }).join('') : '<div class="empty">暂无数据</div>') + '</div>';
    html += '</div>';

    // 类目结构
    var cats = (comm.categories || []).slice().sort(function (a, b) { return num(b.pay) - num(a.pay); }).slice(0, 7);
    if (cats.length) {
      var catTotal = num((comm.total || {}).pay) || 1;
      var ringItems = cats.map(function (c, i) { return { label: c.name, value: num(c.pay), color: CH.PALETTE[i % CH.PALETTE.length] }; });
      var legend = cats.map(function (c, i) {
        return '<div class="legend-row"><span class="lr-name"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' +
          CH.PALETTE[i % CH.PALETTE.length] + '"></i>' + esc(c.name.length > 16 ? c.name.slice(0, 16) + '…' : c.name) + '</span>' +
          '<span class="lr-val">' + pct1((num(c.pay) / catTotal) * 100) + '</span></div>';
      }).join('');
      var catParts = amountParts(catTotal);
      html += '<div class="grid-2b">';
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">支付 GMV 类目结构 <span class="ph-sub">TOP 7</span></div></div>' +
        '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
        CH.donutChart(ringItems, { size: 190, centerTop: catParts.value, centerSub: '支付 GMV(' + catParts.unit + ')' }) +
        '<div style="flex:1;min-width:180px">' + legend + '</div></div></div>';

      var scPoints = (comm.categories || []).map(function (c) {
        return {
          x: num(c.pay) / 10000, y: num(c.rate), label: c.name,
          r: Math.max(4, Math.min(13, Math.sqrt(num(c.pay) / 1e7) * 3.2)),
          color: num(c.rate) < num((comm.total || {}).rate) * 0.7 ? '#e5484d' : '#2f6fed'
        };
      });
      html += chartPanel('类目：规模 vs 结算率', '越靠右下规模越大 · 越靠上结算率越高',
        CH.scatter(scPoints, { height: 300, xLabel: '支付GMV(万)', yLabel: '结算率(%)', yAvg: num((comm.total || {}).rate) }));
      html += '</div>';
    }

    return html;
  }

  // ---------- 主播榜单 ----------
  function viewAnchorRank() {
    var m = modules().anchorRank || {};
    var rows = (m.rows || []).filter(function (r) { return r.anchor; });
    var s = m.summary || {};
    if (!rows.length) return viewHead('主播榜单', '暂无数据') + panel('', '', '<div class="empty">暂无主播数据</div>');

    var f = state.filter.anchorRank || 'all';
    var list = rows.slice();
    if (f === 'active') list = list.filter(function (r) { return num(r.gmvCum) > 0; });
    if (f === 'idle') list = list.filter(function (r) { return num(r.gmvCum) <= 0; });
    var rated = rows.filter(function (r) { return num(r.gmvCum) > 0 && num(r.rate) > 0; });
    var avgRate = rated.length ? rated.reduce(function (a, r) { return a + num(r.rate); }, 0) / rated.length : 0;
    if (f === 'lowRate') list = list.filter(function (r) { return num(r.gmvCum) > 0 && num(r.rate) > 0 && num(r.rate) < avgRate * 0.7; });

    var html = viewHead('主播榜单',
      (m.asOf ? '数据截止 <b>' + esc(m.asOf) + '</b> · ' : '') + rows.length + ' 位主播 · ' + sourceLabel(m.source),
      '<button class="tbtn" data-role="export-rank">导出全部</button>');

    html += monthNotice(pickMonth(anchorMonths()), '主播结算数据');

    // 默认按累计 GMV 降序，避免零产出主播排在最前面
    if (!state.sort.anchorRank) state.sort.anchorRank = { key: 'gmvCum', dir: 'desc' };

    html += kpiCards([
      { icon: 'gmv', color: '#2f6fed', title: '累计 GMV', money: s.gmvCum, sub: '全部主播合计' },
      { icon: 'anchorPerformance', color: '#7a5cff', title: '当日 GMV', money: s.gmvToday, sub: '最新一日' },
      { icon: 'settle', color: '#12a76c', title: '预估结算', money: s.settleCum, sub: '风控后口径' },
      { icon: 'rate', color: '#f5871f', title: '平均结算率', value: pct1(s.avgRate), unit: '', sub: '整体 ' + pct1(s.calcRate) }
    ]);

    // 筛选条
    var chips = [['all', '全部'], ['active', '有产出'], ['idle', '零产出'], ['lowRate', '低结算率']];
    html += '<div class="panel tight"><div class="chips">' + chips.map(function (c) {
      return '<button class="chip-btn' + (f === c[0] ? ' on' : '') + '" data-filter="' + c[0] + '">' + c[1] + '</button>';
    }).join('') + '<span class="tcount" style="margin-left:auto">当前 ' + list.length + ' 位</span></div></div>';
    // 图：Top10 + 散点
    var byCum = list.slice().sort(function (a, b) { return num(b.gmvCum) - num(a.gmvCum); }).slice(0, 10);
    if (byCum.length) {
      html += '<div class="grid-2">';
      html += chartPanel('累计 GMV Top 10', '万元', CH.hBars(byCum.map(function (r) {
        return { label: r.anchor, value: wanNum(r.gmvCum) };
      }), { unit: ' 万', labelW: 90, fmt: function (v) { return v + '万'; } }));
      var pts = list.filter(function (r) { return num(r.gmvCum) > 0; }).map(function (r) {
        return {
          x: wanNum(r.gmvCum), y: num(r.rate), label: r.anchor,
          r: 5, color: num(r.rate) < avgRate * 0.7 ? '#e5484d' : '#2bbf7a'
        };
      });
      html += chartPanel('规模 vs 结算率', '红点=结算率明显低于均值', CH.scatter(pts, {
        height: 300, xLabel: '累计GMV(万)', yLabel: '结算率(%)', yAvg: avgRate
      }));
      html += '</div>';
    }

    // 主表
    var baseRate = num(s.calcRate) || avgRate;   // 整体口径更适合做色阶基准
    var cols = [
      { key: 'rank', label: '#', cls: 'mono', render: function (r, i) { return i + 1; } },
      {
        key: 'anchor', label: '主播', render: function (r) {
          return '<b class="a-link" data-profile="' + esc(r.anchor) + '" title="打开完整分析页">' + esc(r.anchor) + '</b>';
        }
      },
      { key: 'org', label: '所属公司' },
      { key: 'type', label: '类型' },
      { key: 'gmv', label: '当日GMV(万)', cls: 'mono', render: function (r) { return wan(r.gmv); } },
      { key: 'gmvCum', label: '累计GMV(万)', cls: 'mono', render: function (r) { return wan(r.gmvCum); } },
      {
        key: 'trend', label: '近 4 日走势', render: function (r) {
          return CH.spark((r.daily || []).slice(0, 4), { w: 74, h: 22, color: '#2f6fed' });
        }
      },
      {
        key: 'rate', label: '结算率', cls: 'mono', render: function (r) {
          var v = num(r.rate);
          var col = v >= baseRate ? '#12a76c' : v >= baseRate * 0.75 ? '#f5871f' : '#e5484d';
          var bar = v > 0
            ? '<span class="rate-bar"><i style="width:' + Math.max(3, Math.min(100, v)) + '%;background:' + col + '"></i></span>'
            : '';
          return '<div class="rate-cell"><span>' + (v > 0 ? pct1(v) : '—') + '</span>' + bar + '</div>';
        }
      },
      { key: 'settleCum', label: '结算GMV(万)', cls: 'mono', render: function (r) { return wan(r.settleCum); } }
    ];
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">主播明细</div>' +
      '<span class="ph-sub">点主播名打开完整分析页 · 点行号任意处快速预览</span></div>' +
      dataTable('anchorRank', cols, list, {
        exportName: '主播榜单', pageSize: 20, empty: '当前筛选下没有主播',
        onRow: function (r) { openAnchor(r.anchor); }
      }) + '</div>';

    if (m.rawHeaders && m.rawHeaders.length) {
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">原始汇总表</div>' +
        '<span class="ph-sub">' + m.rawHeaders.length + ' 列 · ' + (m.rawRows || []).length + ' 行</span></div>' +
        dataTable('anchorRank_raw', m.rawHeaders.map(function (h) { return { key: h, label: h }; }), m.rawRows || [], {
          exportName: '主播榜单_原始', pageSize: 20
        }) + '</div>';
    }
    return html;
  }

  // ---------- 主播个人分析页 ----------
  var PROFILE_METRICS = {
    gmv: { name: '每日 GMV', color: '#2f6fed', conv: function (x) { return wanNum(x.gmv); }, fmt: function (v) { return v + '万'; } },
    settle: { name: '每日结算 GMV', color: '#12a76c', conv: function (x) { return wanNum(x.settle); }, fmt: function (v) { return v + '万'; } },
    rate: { name: '每日结算率', color: '#f5871f', conv: function (x) { return Math.round(x.rate * 10) / 10; }, fmt: function (v) { return v + '%'; } }
  };

  // 把 daily(结算额) + rateDaily(结算率) 还原成每日 GMV
  function anchorSeries(r) {
    var out = [];
    (r.daily || []).forEach(function (v, i) {
      var rate = Number((r.rateDaily || [])[i]) || 0;
      var g = IN.dayGmv(v, rate);
      if (g > 0 || num(v) > 0) out.push({ idx: i, label: (i + 1) + '日', gmv: g, settle: num(v), rate: rate });
    });
    return out;
  }

  function viewAnchorProfile() {
    var name = state.profile;
    var rank = modules().anchorRank || {};
    var rows = (rank.rows || []).filter(function (r) { return r.anchor; });
    if (!rows.length) {
      return viewHead('主播详情', '暂无数据') + panel('', '', '<div class="empty">还没有主播数据</div>');
    }
    var r = rows.filter(function (x) { return x.anchor === name; })[0];
    if (!r) {
      return viewHead('主播详情', '未找到「' + esc(name || '') + '」') +
        panel('', '', '<div class="empty">没有这位主播的数据，可能名字有误。<br/><br/>' +
          '<button class="tbtn" data-goto="anchorRank">← 返回主播榜单</button></div>');
    }

    var sorted = rows.slice().sort(function (a, b) { return num(b.gmvCum) - num(a.gmvCum); });
    var rankNo = sorted.map(function (x) { return x.anchor; }).indexOf(name) + 1;
    var rated = rows.filter(function (x) { return num(x.gmvCum) > 0 && num(x.rate) > 0; });
    var avgRate = rated.length ? rated.reduce(function (a, x) { return a + num(x.rate); }, 0) / rated.length : 0;
    var avgGmv = rows.reduce(function (a, x) { return a + num(x.gmvCum); }, 0) / (rows.length || 1);
    var top1 = sorted[0] || {};

    var series = anchorSeries(r);
    var mk = PROFILE_METRICS[state.metric[name]] ? state.metric[name] : 'gmv';
    var meta = PROFILE_METRICS[mk];

    var html = viewHead('主播详情 · ' + esc(r.anchor),
      esc(r.org || '') + (r.type ? ' · ' + esc(r.type) : '') +
      ' · 累计排名 <b>NO.' + rankNo + '</b> / ' + rows.length + ' 位' +
      (rank.asOf ? ' · 数据截止 <b>' + esc(rank.asOf) + '</b>' : ''),
      '<button class="tbtn" data-role="profile-back">← 返回榜单</button>' +
      '<button class="tbtn" data-role="profile-export">导出明细</button>');

    html += monthNotice(pickMonth(anchorMonths()), '主播结算数据');

    html += kpiCards([
      { icon: 'gmv', color: '#2f6fed', title: '累计下播 GMV', money: r.gmvCum, sub: '全员均值 ' + wan(avgGmv) + ' 万' },
      { icon: 'anchorPerformance', color: '#7a5cff', title: '当日 GMV', money: r.gmv, sub: '最新一日' },
      {
        icon: 'rate', color: num(r.rate) >= avgRate ? '#12a76c' : '#e5484d', title: '结算率',
        value: pct1(r.rate), unit: '', sub: '全员均值 ' + pct1(avgRate)
      },
      {
        icon: 'settle', color: '#f5871f', title: '累计结算 GMV', money: r.settleCum,
        sub: '占全公司 ' + pct1(num(r.settleCum) / (num((rank.summary || {}).settleCum) || 1) * 100)
      }
    ]);

    // 指标切换
    var mkChips = Object.keys(PROFILE_METRICS).map(function (k) {
      return '<button class="chip-btn' + (k === mk ? ' on' : '') + '" data-metric="' + k + '">' + PROFILE_METRICS[k].name + '</button>';
    }).join('');
    html += '<div class="panel tight"><div class="chips">' + mkChips +
      '<span class="tcount" style="margin-left:auto">共 ' + series.length + ' 天有数据</span></div></div>';

    // 主趋势
    if (series.length >= 2) {
      html += '<div class="panel chart-panel"><div class="panel-head"><div class="ph-title">' +
        esc(meta.name) + ' <span class="ph-sub">' + esc(r.anchor) + '</span></div>' +
        '<div class="ph-tools"><span class="ph-hint">点图表可放大</span><button class="tbtn sm" data-role="img">导出图片</button></div></div>' +
        CH.line(series.map(function (x) { return { label: x.label, value: meta.conv(x) }; }), {
          color: meta.color, height: 250, fmt: meta.fmt, yFmt: mk === 'rate' ? plainNum : plainNum, showValue: series.length <= 8
        }) + '</div>';
    } else {
      html += '<div class="panel"><div class="empty">这位主播目前只有 1 天数据，暂时画不出趋势</div></div>';
    }

    // 与团队对比：用「合计」而不是「人均」——人均只有本人的零头，线会全贴在底部看不出东西
    var cmpMetric = mk === 'settle' ? 'settle' : 'gmv';
    var myLine = [], allLine = [];
    for (var ci = 0; ci < (r.daily || []).length; ci++) {
      var tot = 0;
      rows.forEach(function (x) {
        var rr = Number((x.rateDaily || [])[ci]) || 0;
        var g = cmpMetric === 'settle' ? num((x.daily || [])[ci]) : IN.dayGmv((x.daily || [])[ci], rr);
        if (g > 0) tot += g;
      });
      var mineG = cmpMetric === 'settle' ? num((r.daily || [])[ci]) : IN.dayGmv((r.daily || [])[ci], Number((r.rateDaily || [])[ci]) || 0);
      myLine.push(wanNum(mineG));
      allLine.push(wanNum(tot));
    }
    var mySum = 0, allSum = 0;
    series.forEach(function (x) { mySum += myLine[x.idx] || 0; allSum += allLine[x.idx] || 0; });
    var share = allSum > 0 ? (mySum / allSum) * 100 : 0;

    if (series.length >= 2) {
      var cmpSeries = [
        {
          name: esc(r.anchor), color: meta.color,
          points: series.map(function (x) { return { label: x.label, value: myLine[x.idx] }; })
        },
        {
          name: '全员合计', color: '#b3bcc9', dashed: true,
          points: series.map(function (x) { return { label: x.label, value: allLine[x.idx] }; })
        }
      ];
      html += '<div class="panel chart-panel"><div class="panel-head"><div class="ph-title">' +
        (mk === 'rate' ? 'GMV 与团队对比' : '与团队对比') +
        ' <span class="ph-sub">单位万元 · 该主播在该区间占全员 ' + pct1(share) + '</span></div></div>' +
        '<div class="legend">' + cmpSeries.map(function (s2) {
          return '<span><i style="background:' + s2.color + '"></i>' + s2.name + '</span>';
        }).join('') +
        (mk === 'rate' ? '<span class="tip-inline">结算率是按天算的比率，与总量不同尺度，所以这里改看 GMV</span>' : '') + '</div>' +
        CH.multiLine(cmpSeries, { height: 250, fmt: function (v) { return v + '万'; }, yFmt: plainNum }) + '</div>';
    }

    // 与均值 / 头部的对比表
    var cmpRows = [
      { name: '该主播 · ' + r.anchor, gmv: num(r.gmvCum), rate: num(r.rate) },
      { name: '全员均值', gmv: avgGmv, rate: avgRate },
      { name: '第一名 · ' + (top1.anchor || '—'), gmv: num(top1.gmvCum), rate: num(top1.rate) }
    ];
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">位置对比</div>' +
      '<span class="ph-sub">累计 GMV 排名 NO.' + rankNo + ' / ' + rows.length + '</span></div>' +
      dataTable('profile_cmp', [
        { key: 'name', label: '对象', render: function (x) { return '<b>' + esc(x.name) + '</b>'; } },
        { key: 'gmv', label: '累计GMV(万)', cls: 'mono', render: function (x) { return wan(x.gmv); } },
        {
          key: 'rate', label: '结算率', cls: 'mono', render: function (x) {
            var v = num(x.rate);
            return '<span style="color:' + (v >= avgRate ? '#12a76c' : '#e5484d') + ';font-weight:700">' + (v > 0 ? pct1(v) : '—') + '</span>';
          }
        }
      ], cmpRows, { pageSize: 5 }) + '</div>';

    // 每日明细
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">每日明细</div>' +
      '<span class="ph-sub">GMV = 结算额 ÷ 当日结算率</span></div>' +
      dataTable('profile_daily_' + r.anchor, [
        { key: 'day', label: '日期' },
        { key: 'gmv', label: 'GMV(元)', cls: 'mono', render: function (x) { return money(x.gmv); } },
        { key: 'settle', label: '结算GMV(元)', cls: 'mono', render: function (x) { return money(x.settle); } },
        {
          key: 'rate', label: '结算率', cls: 'mono', render: function (x) {
            var v = num(x.rate);
            return '<div class="rate-cell"><span>' + (v > 0 ? pct1(v) : '—') + '</span>' +
              '<span class="rate-bar"><i style="width:' + Math.max(2, Math.min(100, v)) + '%;background:' +
              (v >= avgRate ? '#12a76c' : '#e5484d') + '"></i></span></div>';
          }
        }
      ], series.map(function (x) { return { day: x.label, gmv: x.gmv, settle: x.settle, rate: x.rate }; }),
        { pageSize: 15, exportName: '主播明细_' + r.anchor, searchPlaceholder: '筛选日期…' }) + '</div>';

    return html;
  }

  function openProfile(name) {
    if (!name) return;
    state.profile = name;
    state.current = 'anchor';
    try { history.replaceState(null, '', '#anchor/' + encodeURIComponent(name)); } catch (e) { }
    renderNav();
    renderView(false);
    closeDrawer();
  }

  // ---------- 主播详情抽屉 ----------
  function openAnchor(name) {
    var rank = modules().anchorRank || {};
    var rows = (rank.rows || []).filter(function (r) { return r.anchor; });
    var r = rows.filter(function (x) { return x.anchor === name; })[0];
    if (!r) return;

    var sorted = rows.slice().sort(function (a, b) { return num(b.gmvCum) - num(a.gmvCum); });
    var rankNo = sorted.map(function (x) { return x.anchor; }).indexOf(name) + 1;
    var rated = rows.filter(function (x) { return num(x.gmvCum) > 0 && num(x.rate) > 0; });
    var avgRate = rated.length ? rated.reduce(function (a, x) { return a + num(x.rate); }, 0) / rated.length : 0;
    var avgGmv = rows.reduce(function (a, x) { return a + num(x.gmvCum); }, 0) / (rows.length || 1);

    var days = (r.daily || []).map(function (v, i) {
      var rate = Number((r.rateDaily || [])[i]) || 0;
      return { label: (i + 1) + '日', gmv: IN.dayGmv(v, rate), settle: num(v), rate: rate };
    });
    var activeDaily = days.filter(function (x) { return x.gmv > 0; });
    var activeRate = activeDaily.filter(function (x) { return x.rate > 0; });

    var body = '<button class="tbtn primary" data-profile="' + esc(name) + '" style="margin-bottom:14px">打开完整分析页 →</button>' +
      '<div class="mini-kpis">' +
      '<div class="mini-kpi"><div class="mk-label">累计下播 GMV</div><div class="mk-val">' + wan(r.gmvCum) + '<span style="font-size:12px;color:#7b8798"> 万</span></div><div class="mk-sub">全员平均 ' + wan(avgGmv) + ' 万</div></div>' +
      '<div class="mini-kpi"><div class="mk-label">当日 GMV</div><div class="mk-val">' + wan(r.gmv) + '<span style="font-size:12px;color:#7b8798"> 万</span></div><div class="mk-sub">最新一日</div></div>' +
      '<div class="mini-kpi"><div class="mk-label">结算率</div><div class="mk-val" style="color:' + (num(r.rate) >= avgRate ? '#12a76c' : '#e5484d') + '">' + pct1(r.rate) + '</div><div class="mk-sub">全员均值 ' + pct1(avgRate) + '</div></div>' +
      '<div class="mini-kpi"><div class="mk-label">累计排名</div><div class="mk-val">NO.' + rankNo + '</div><div class="mk-sub">共 ' + rows.length + ' 位</div></div>' +
      '</div>';

    if (activeDaily.length >= 2) {
      body += '<div class="sec-title">每日 GMV（万元）</div>' +
        CH.line(activeDaily.map(function (x) { return { label: x.label, value: wanNum(x.gmv) }; }),
          { color: '#2f6fed', height: 190, fmt: function (v) { return v + '万'; }, showValue: activeDaily.length <= 8 });
    }
    if (activeRate.length >= 2) {
      body += '<div class="sec-title">每日结算率（%）</div>' +
        CH.line(activeRate.map(function (x) { return { label: x.label, value: Math.round(x.rate * 10) / 10 }; }),
          { color: '#12a76c', height: 170, fmt: function (v) { return v + '%'; }, showValue: activeRate.length <= 8 });
    }

    body += '<div class="sec-title">每日明细</div>' + dataTable('drawer_' + name, [
      { key: 'day', label: '日期' },
      { key: 'gmv', label: 'GMV(元)', cls: 'mono', render: function (x) { return money(x.gmv); } },
      { key: 'settle', label: '结算GMV(元)', cls: 'mono', render: function (x) { return money(x.settle); } },
      { key: 'rate', label: '结算率', cls: 'mono', render: function (x) { return x.rate > 0 ? pct1(x.rate) : '—'; } }
    ], activeDaily.map(function (x) {
      return { day: x.label, gmv: x.gmv, settle: x.settle, rate: x.rate };
    }), { pageSize: 10, searchPlaceholder: '筛选日期…' });

    $('drawerTitle').textContent = name;
    $('drawerSub').textContent = (r.org || '') + (r.type ? ' · ' + r.type : '') + ' · 数据截止 ' + (rank.asOf || '--');
    $('drawerBody').innerHTML = body;
    $('drawerMask').classList.add('show');
    $('drawer').classList.add('show');
  }
  function closeDrawer() {
    $('drawerMask').classList.remove('show');
    $('drawer').classList.remove('show');
  }

  // ---------- 商品结构 ----------
  function viewCommodity() {
    var m = modules().commodity || {};
    var allT = m.total || {};
    var cats = m.categories || [];
    var days = (m.days || []).slice().sort(function (a, b) { return String(a.date) < String(b.date) ? -1 : 1; });
    if (!cats.length && !(m.products || []).length && !days.length) {
      return viewHead('商品结构', '暂无数据') + panel('', '', '<div class="empty">商品明细尚未入库</div>');
    }

    // 月度口径：逐日明细有真实支付/结算，可以按月份精确汇总
    var dayMonths = [];
    days.forEach(function (x) { var k = ymOf(x.date); if (k && dayMonths.indexOf(k) < 0) dayMonths.push(k); });
    var pm = pickMonth(dayMonths);
    var scope = pm.month ? days.filter(function (x) { return ymOf(x.date) === pm.month; }) : days;
    var t = { pay: 0, settle: 0, items: 0, rate: 0 };
    scope.forEach(function (x) {
      t.pay += num(x.pay); t.settle += num(x.settle); t.items += num(x.items);
    });
    t.rate = t.pay > 0 ? (t.settle / t.pay) * 100 : 0;
    var scopeLabel = scope.length ? (monthName(pm.month) + ' · ' + scope[0].date + ' ~ ' + scope[scope.length - 1].date) : '全周期';

    // 类目 / 商品 / 店铺三张表是整表聚合，没有按日拆分，标注清楚避免误读
    var allRange = days.length ? (days[0].date + ' ~ ' + days[days.length - 1].date) : '';

    var html = viewHead('商品结构',
      scopeLabel + ' · 明细 ' + Math.round(t.items).toLocaleString('zh-CN') + ' 行 · ' + cats.length + ' 个一级类目',
      '<span class="tip-inline" title="类目/商品/店铺三张聚合表由整本工作簿汇总，无法按日拆分">聚合表口径：' + esc(allRange) + '</span>');

    html += monthNotice(pm, '商品明细');

    html += kpiCards([
      { icon: 'commodity', color: '#2f6fed', title: '支付 GMV', money: t.pay, sub: esc(monthName(pm.month)) + '合计' },
      { icon: 'settle', color: '#12a76c', title: '结算 GMV', money: t.settle, sub: '风控后' },
      { icon: 'rate', color: '#f5871f', title: '本月结算率', value: pct1(t.rate), unit: '', sub: '结算 / 支付' },
      { icon: 'gmv', color: '#7a5cff', title: '明细行数', value: Math.round(t.items).toLocaleString('zh-CN'), unit: '行', sub: '当月商品级明细' }
    ]);

    // 每日支付 / 结算走势（按月）
    if (scope.length >= 2) {
      html += '<div class="panel chart-panel"><div class="panel-head"><div class="ph-title">每日支付 vs 结算 <span class="ph-sub">万元 · ' +
        esc(monthName(pm.month)) + '</span></div><div class="ph-tools"><button class="tbtn sm" data-role="img">导出图片</button></div></div>' +
        '<div class="legend"><span><i style="background:#2f6fed"></i>支付 GMV</span><span><i style="background:#12a76c"></i>结算 GMV</span></div>' +
        CH.multiLine([
          { name: '支付', color: '#2f6fed', points: scope.map(function (x) { return { label: String(x.date).slice(5), value: Math.round(num(x.pay) / 1000) / 10 }; }) },
          { name: '结算', color: '#12a76c', dashed: true, points: scope.map(function (x) { return { label: String(x.date).slice(5), value: Math.round(num(x.settle) / 1000) / 10 }; }) }
        ], { height: 240, fmt: function (v) { return v + '万'; }, yFmt: plainNum }) + '</div>';
    }

    // 类目结构
    var catSorted = cats.slice().sort(function (a, b) { return num(b.pay) - num(a.pay); });
    var top = catSorted.slice(0, 8);
    var ring = top.map(function (c, i) { return { label: c.name, value: num(c.pay), color: CH.PALETTE[i % CH.PALETTE.length] }; });
    var legend = top.map(function (c, i) {
      return '<div class="legend-row"><span class="lr-name"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:' +
        CH.PALETTE[i % CH.PALETTE.length] + '"></i>' + esc(c.name.length > 15 ? c.name.slice(0, 15) + '…' : c.name) + '</span>' +
        '<span class="lr-val">' + wan(c.pay) + ' 万 · ' + pct1(c.rate) + '</span></div>';
    }).join('');

    var payParts = amountParts(allT.pay);
    html += '<div class="grid-2b">';
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">支付 GMV 类目占比 <span class="ph-sub">整表 ' + esc(allRange) + '</span></div></div>' +
      '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
      CH.donutChart(ring, { size: 200, centerTop: payParts.value, centerSub: '支付 GMV(' + payParts.unit + ')' }) +
      '<div style="flex:1;min-width:200px">' + legend + '</div></div></div>';
    html += chartPanel('类目结算率对比', '整体 ' + pct1(allT.rate) + '，低于此线的类目拉低了综合毛利',
      CH.hBars(catSorted.map(function (c) {
        return { label: c.name.length > 10 ? c.name.slice(0, 10) + '…' : c.name, value: num(c.rate), color: num(c.rate) < num(allT.rate) * 0.7 ? '#e5484d' : '#12a76c' };
      }).slice(0, 12), { unit: '%', labelW: 130, fmt: function (v) { return v.toFixed(1) + '%'; } }), {});
    html += '</div>';

    // 类目明细表
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">类目明细</div><span class="ph-sub">' + cats.length + ' 个类目 · 整表聚合</span></div>' +
      dataTable('commodity_cat', [
        { key: 'name', label: '一级类目' },
        { key: 'items', label: '商品行数', cls: 'mono' },
        { key: 'pay', label: '支付GMV(元)', cls: 'mono', render: function (r) { return money(r.pay); } },
        { key: 'settle', label: '结算GMV(元)', cls: 'mono', render: function (r) { return money(r.settle); } },
        {
          key: 'rate', label: '结算率', cls: 'mono', render: function (r) {
            var v = num(r.rate);
            return '<div class="rate-cell"><span>' + pct1(v) + '</span><span class="rate-bar"><i style="width:' +
              Math.max(2, Math.min(100, v)) + '%;background:' + (v >= num(allT.rate) ? '#12a76c' : '#e5484d') + '"></i></span></div>';
          }
        }
      ], cats, { exportName: '商品类目明细', pageSize: 20 }) + '</div>';

    // 商品 + 卖家
    html += '<div class="grid-2b">';
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">重点商品 TOP</div><span class="ph-sub">按结算 GMV</span></div>' +
      dataTable('commodity_prod', [
        { key: 'name', label: '商品名称', render: function (r) { return '<span title="' + esc(r.name) + '">' + esc(r.name.length > 18 ? r.name.slice(0, 18) + '…' : r.name) + '</span>'; } },
        { key: 'cat', label: '类目', render: function (r) { return esc(String(r.cat || '').slice(0, 8)); } },
        { key: 'settle', label: '结算GMV(万)', cls: 'mono', render: function (r) { return wan(r.settle); } },
        { key: 'rate', label: '结算率', cls: 'mono', render: function (r) { return pct1(r.rate); } }
      ], m.products || [], { exportName: '重点商品', pageSize: 10, searchPlaceholder: '搜索商品…' }) + '</div>';

    html += '<div class="panel"><div class="panel-head"><div class="ph-title">店铺 TOP</div><span class="ph-sub">按支付 GMV</span></div>' +
      dataTable('commodity_seller', [
        { key: 'name', label: '店铺', render: function (r) { return '<span title="' + esc(r.name) + '">' + esc(r.name.length > 16 ? r.name.slice(0, 16) + '…' : r.name) + '</span>'; } },
        { key: 'items', label: '商品数', cls: 'mono' },
        { key: 'pay', label: '支付GMV(万)', cls: 'mono', render: function (r) { return wan(r.pay); } },
        { key: 'rate', label: '结算率', cls: 'mono', render: function (r) { return pct1(r.rate); } }
      ], m.sellers || [], { exportName: '店铺榜单', pageSize: 10, searchPlaceholder: '搜索店铺…' }) + '</div>';
    html += '</div>';

    return html;
  }

  // ---------- 主播业绩（每日快照） ----------
  function viewAnchorPerformance() {
    var m = modules().anchorPerformance || {};
    var allSheets = m.sheets || [];
    if (!allSheets.length) {
      return viewHead('主播业绩', '暂无快照') + panel('', '', '<div class="empty">还没有每日快照数据</div>');
    }
    var mon = [];
    allSheets.forEach(function (s) { var k = ymOf(s.date); if (k && mon.indexOf(k) < 0) mon.push(k); });
    var pm = pickMonth(mon);
    var sheets = pm.month ? allSheets.filter(function (s) { return ymOf(s.date) === pm.month; }) : allSheets;
    if (!sheets.length) sheets = allSheets;

    var html = viewHead('主播业绩',
      sheets.length + ' 个每日快照 · ' + (pm.month ? esc(monthName(pm.month)) : '全部') +
      (m.asOf ? ' · 截止 ' + esc(m.asOf) : ''));
    html += monthNotice(pm, '主播业绩快照');

    var latest = sheets[sheets.length - 1];
    var latestDate = String(latest.date || '');

    // 快照是否落后于今天：源工作簿里没生成当天的日表时，这里如实说明，不静默留白
    var nowD = new Date();
    var todayStr = nowD.getFullYear() + '-' + String(nowD.getMonth() + 1).padStart(2, '0') + '-' +
      String(nowD.getDate()).padStart(2, '0');
    if (latestDate && latestDate < todayStr) {
      var expectDay = Number(todayStr.slice(8, 10));
      var syncInfo = state.sync || {};
      html += '<div class="notice"><span class="ni">i</span><span>' +
        '源工作簿里还没有 <b>' + expectDay + '日</b> 这张日快照，最新只到 <b>' + esc(latestDate) + '</b>，所以今天没有新增数据。' +
        '同步助手上次检查是 <b id="perfCheckAt">' + esc(syncInfo.lastCheckAt ? fmtDateTime(syncInfo.lastCheckAt) : '—') + '</b>' +
        '；等运营在源表里生成 ' + expectDay + '日 工作表后，下次检查（每 30 分钟）会自动接入。' +
        '</span></div>';
    }

    function pickCol(headers, names) {
      var i, j;
      for (i = 0; i < names.length; i++) {
        if (headers.indexOf(names[i]) >= 0) return names[i];
      }
      // 精确匹配不到时按前缀匹配（如「风控后结算GMV(预估拼接)(元)·2日」）
      for (i = 0; i < names.length; i++) {
        for (j = 0; j < headers.length; j++) {
          if (String(headers[j]).indexOf(names[i]) === 0) return headers[j];
        }
      }
      return null;
    }
    var rankAll = (modules().anchorRank || {}).rows || [];
    var rankByName = {};
    rankAll.forEach(function (r) { if (r.anchor) rankByName[r.anchor] = r; });

    // 每日结算金额统一取自「汇总」页解析出来的每日数组（快照宽表里的日期列会随时间变动，
    // 且同名日期列重复出现，按列名取数会错位）。同名主播只计一次，避免重复累加。
    function settleOfSheet(sheet) {
      var day = Number(String(sheet.date || '').slice(8, 10)) || 0;
      if (day < 1 || day > 30) return 0;
      var sum = 0, seen = {};
      (sheet.rows || []).forEach(function (r) {
        var n = String(r['主播名'] || '').trim();
        if (!n || seen[n]) return;
        seen[n] = 1;
        var rk = rankByName[n];
        if (rk) sum += num((rk.daily || [])[day - 1]);
      });
      return sum;
    }

    var cards = sheets.map(function (s) {
      var cG = pickCol(s.headers, ['下播GMV']);
      var tg = 0, names = {};
      (s.rows || []).forEach(function (r) {
        if (cG) tg += num(r[cG]);
        var n = String(r['主播名'] || '').trim();
        if (n) names[n] = 1;
      });
      var ts = settleOfSheet(s);
      return { name: s.name, date: s.date, gmv: tg, settle: ts, count: Object.keys(names).length, hasSettle: ts > 0 };
    });
    var maxG = Math.max.apply(null, cards.map(function (c) { return c.gmv; }).concat([1]));

    html += '<div class="grid-2">';
    html += chartPanel('每日 GMV 对比', '万元，来自各日快照',
      CH.vBars(cards.map(function (c) { return { label: c.name, value: wanNum(c.gmv) }; }), { unit: ' 万', height: 260 }));
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">快照概览</div></div>' +
      cards.map(function (c) {
        var p = Math.round((c.gmv / maxG) * 100);
        return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:5px">' +
          '<b>' + esc(c.name) + '</b><span style="color:#7b8798">' + esc(c.date || '') + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:12px;color:#7b8798;margin-bottom:5px">' +
          '<span>' + c.count + ' 人</span><span>' + wan(c.gmv) + ' 万' +
          (c.hasSettle ? ' · 结算 ' + wan(c.settle) + ' 万' : ' · 结算未出数') + '</span></div>' +
          '<div style="height:7px;border-radius:4px;background:#eef1f5"><div style="height:100%;width:' + p + '%;border-radius:4px;background:linear-gradient(90deg,#2f6fed,#5b8dff)"></div></div></div>';
      }).join('') + '</div>';
    html += '</div>';

    // 日快照的基础列（下播GMV/累计）准确，但宽表里「3日」「4日」等列名重复出现三次，
    // 按列名取数会互相覆盖，导致表头和数据错位。所以结算金额改从汇总页的每日结算数组
    // 按主播名 + 当日序号对齐，两个来源互相校验。
    var latestDay = Number(latestDate.slice(8, 10)) || 0;
    var seenName = {};
    var perfRows = (latest.rows || []).map(function (r) {
      var name = String(r['主播名'] || '').trim();
      var rk = rankByName[name] || null;
      var inRange = !!rk && latestDay >= 1 && latestDay <= 30;
      var dup = !!seenName[name];
      if (name) seenName[name] = 1;
      return {
        _date: fmtExcelDate(r['直播日期']) || latestDate,
        _name: name,
        _dup: dup,
        _id: String(r['主播ID'] || ''),
        _type: String(r['主播类型'] || ''),
        _gmv: num(r['下播GMV']),
        _share: num(r['分成后下播GMV']),
        _cum: num(r['下播GMV累计']),
        _prev: num(r['前日下播GMV累计']),
        // 结算按主播计，同名多条记录只归到第一行，避免页面合计翻倍
        _settle: (inRange && !dup) ? num((rk.daily || [])[latestDay - 1]) : 0,
        _rate: (inRange && !dup) ? num((rk.rateDaily || [])[latestDay - 1]) : 0
      };
    }).filter(function (r) { return r._name; });

    // 默认把有产出的排在前面，零产出沉底
    perfRows.sort(function (a, b) { return (b._gmv - a._gmv) || (b._settle - a._settle); });

    var totGmv = 0, totSettle = 0;
    perfRows.forEach(function (r) { totGmv += r._gmv; totSettle += r._settle; });

    function dash(v, fmt) { return v > 0 ? fmt(v) : '<span class="muted-sm">—</span>'; }

    var cols = [
      { key: '_date', label: '日期', cls: 'mono' },
      {
        key: '_name', label: '主播', render: function (r) {
          return '<b class="a-link" data-profile="' + esc(r._name) + '" title="打开完整分析页">' + esc(r._name) + '</b>';
        }
      },
      { key: '_id', label: '主播ID', cls: 'mono' },
      { key: '_type', label: '类型' },
      { key: '_gmv', label: '当日下播GMV(元)', cls: 'mono', render: function (r) { return dash(r._gmv, money); } },
      { key: '_share', label: '分成后GMV(元)', cls: 'mono', render: function (r) { return dash(r._share, money); } },
      { key: '_cum', label: '累计下播GMV(元)', cls: 'mono', render: function (r) { return dash(r._cum, money); } },
      { key: '_prev', label: '前日累计GMV(元)', cls: 'mono', render: function (r) { return dash(r._prev, money); } },
      { key: '_settle', label: '当日结算GMV(元)', cls: 'mono', render: function (r) {
        if (r._dup) return '<span class="muted-sm" title="该主播有多条直播记录，结算已计入上方首行">—</span>';
        return dash(r._settle, money);
      } },
      { key: '_rate', label: '结算率', cls: 'mono', render: function (r) {
        if (r._dup) return '<span class="muted-sm" title="该主播有多条直播记录，结算率已计入上方首行">—</span>';
        return dash(r._rate, pct1);
      } }
    ];

    html += '<div class="panel"><div class="panel-head"><div class="ph-title">' + esc(latest.name) + ' 快照明细</div>' +
      '<span class="ph-sub">' + esc(latestDate) + ' · ' + perfRows.length + ' 位主播 · 合计下播 ' + wan(totGmv) +
      ' 万 · 结算 ' + wan(totSettle) + ' 万</span></div>' +
      dataTable('anchorPerformance', cols, perfRows, { exportName: '主播业绩_' + latest.name, pageSize: 20 }) + '</div>';
    return html;
  }

  // ---------- 业绩预估 ----------
  // 工作簿是「日期 × 部门」的每日预估/实际，单位万元
  function parseForecastRows(m) {
    var out = [];
    (m.rawRows || []).forEach(function (r) {
      var d = fmtExcelDate(r['时间']);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return;
      var dept = String(r['部门'] || '').trim();
      if (!dept || dept.indexOf('\ufffd') >= 0) return;   // 过滤损坏字符行
      out.push({
        date: String(d), month: String(d).slice(0, 7), dept: dept,
        est: num(r['预估支付GMV']), actual: num(r['实际支付GMV达成']),
        dev: num(r['支付GMV偏差率']) * 100,
        note: String(r['解释专区'] || '').trim()
      });
    });
    return out;
  }

  function viewForecast() {
    var m = modules().forecast || {};
    var rows = parseForecastRows(m);
    if (!rows.length) {
      return viewHead('业绩预估', '暂无数据') +
        panel('等待接入', '', '<div class="empty">业绩预估数据尚未入库。该表目前受「禁止下载」保护，权限放开后会自动同步。</div>');
    }

    var depts = [];
    rows.forEach(function (r) {
      if (r.dept !== '合计' && depts.indexOf(r.dept) < 0) depts.push(r.dept);
    });
    var dept = (state.filter.forecast && depts.indexOf(state.filter.forecast) >= 0) ? state.filter.forecast : (depts[0] || '');

    var months = [];
    rows.forEach(function (r) { if (months.indexOf(r.month) < 0) months.push(r.month); });
    months.sort();
    var withActual = rows.filter(function (r) { return r.actual > 0; }).map(function (r) { return r.month; }).sort();
    var defMonth = withActual.length ? withActual[withActual.length - 1] : months[months.length - 1];
    var mon = (state.month && months.indexOf(state.month) >= 0) ? state.month
      : (state.filter.forecastMonth && months.indexOf(state.filter.forecastMonth) >= 0) ? state.filter.forecastMonth
        : defMonth;

    var mine = rows.filter(function (r) { return r.dept === dept && r.month === mon; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });

    // 统计范围截到最后一个有实际数据的日期，避免"未来日期"拉低达成率
    var lastDone = '';
    mine.forEach(function (r) { if (r.actual > 0) lastDone = r.date; });
    var scope = mine.filter(function (r) { return !lastDone || r.date <= lastDone; });

    var estSum = scope.reduce(function (a, r) { return a + r.est; }, 0);
    var actSum = scope.reduce(function (a, r) { return a + r.actual; }, 0);
    var achieve = estSum > 0 ? (actSum / estSum) * 100 : 0;
    var gap = actSum - estSum;

    var html = viewHead('业绩预估',
      '预估支付 GMV 与实际达成对比 · <b>' + esc(dept) + '</b> · ' +
      (lastDone ? '统计至 ' + esc(lastDone.slice(5)) : '全月') + ' · 单位万元',
      '<span class="fresh-dot"><i></i>每日更新</span>');

    // 月份切换
    html += '<div class="panel tight"><div class="chips">' + months.map(function (mm) {
      var label = Number(mm.slice(5, 7)) + '月';
      return '<button class="chip-btn' + (mm === mon ? ' on' : '') + '" data-fc="' + mm + '">' + label + '</button>';
    }).join('') +
      (depts.length > 1 ? '<span class="tcount" style="margin-left:auto">部门：' + depts.map(function (d) {
        return '<button class="chip-btn' + (d === dept ? ' on' : '') + '" data-fd="' + esc(d) + '" style="margin-left:6px">' + esc(d) + '</button>';
      }).join('') + '</span>' : '') + '</div></div>';

    html += kpiCards([
      { icon: 'forecast', color: '#7a5cff', title: '预估 GMV', money: estSum * 10000, sub: scope.length + ' 天合计' },
      { icon: 'gmv', color: '#2f6fed', title: '实际 GMV', money: actSum * 10000, sub: '已发生' },
      { icon: 'rate', color: achieve >= 95 ? '#12a76c' : achieve >= 80 ? '#f5871f' : '#e5484d', title: '达成率', value: pct1(achieve), unit: '', sub: achieve >= 100 ? '已超额完成' : '低于预估 ' + pct1(100 - achieve) },
      { icon: 'settle', color: gap >= 0 ? '#12a76c' : '#e5484d', title: '预估差额', money: Math.abs(gap) * 10000, sub: (gap >= 0 ? '超额 ' : '缺口 ') + (gap >= 0 ? '▲' : '▼') }
    ]);

    // 每日对比
    var pts = scope.filter(function (r) { return r.est > 0 || r.actual > 0; });
    if (pts.length) {
      html += '<div class="panel chart-panel"><div class="panel-head"><div class="ph-title">每日预估 vs 实际 <span class="ph-sub">万元</span></div>' +
        '<div class="ph-tools"><span class="ph-hint">点图表可放大</span><button class="tbtn sm" data-role="img">导出图片</button></div></div>' +
        '<div class="legend"><span><i style="background:#2f6fed"></i>实际</span><span><i style="background:#b9c6e8"></i>预估</span></div>' +
        CH.multiLine([
          { name: '预估', color: '#b9c6e8', dashed: true, points: pts.map(function (r) { return { label: r.date.slice(5), value: Math.round(r.est * 10) / 10 }; }) },
          { name: '实际', color: '#2f6fed', points: pts.map(function (r) { return { label: r.date.slice(5), value: Math.round(r.actual * 10) / 10 }; }) }
        ], { height: 280, fmt: function (v) { return v + '万'; }, yFmt: plainNum }) + '</div>';
    }

    // 部门横向对比（仅在有多部门明细时显示）
    var deptRows = depts.map(function (d) {
      var ds = rows.filter(function (r) { return r.dept === d && r.month === mon; });
      var e = 0, a = 0;
      var ld = '';
      ds.forEach(function (r) { if (r.actual > 0) ld = r.date; });
      ds.forEach(function (r) {
        if (ld && r.date > ld) return;
        e += r.est; a += r.actual;
      });
      return { name: d, est: e, actual: a, rate: e > 0 ? (a / e) * 100 : 0, days: ds.length };
    }).filter(function (x) { return x.est > 0 || x.actual > 0; });

    if (deptRows.length > 1) {
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">部门对比</div><span class="ph-sub">' + mon.slice(5) + ' 月 · 单位万元</span></div>' +
        dataTable('forecast_dept', [
          { key: 'name', label: '部门' },
          { key: 'days', label: '天数', cls: 'mono' },
          { key: 'est', label: '预估(万)', cls: 'mono', render: function (r) { return money(r.est); } },
          { key: 'actual', label: '实际(万)', cls: 'mono', render: function (r) { return money(r.actual); } },
          {
            key: 'rate', label: '达成率', cls: 'mono', render: function (r) {
              var v = r.rate;
              var col = v >= 95 ? '#12a76c' : v >= 80 ? '#f5871f' : '#e5484d';
              return '<div class="rate-cell"><span style="color:' + col + ';font-weight:700">' + pct1(v) + '</span>' +
                '<span class="rate-bar"><i style="width:' + Math.max(3, Math.min(100, v)) + '%;background:' + col + '"></i></span></div>';
            }
          }
        ], deptRows, { pageSize: 10, exportName: '部门业绩对比' }) + '</div>';
    }

    // 明细
    var detailRows = mine.filter(function (r) { return r.est > 0 || r.actual > 0; });
    html += '<div class="panel"><div class="panel-head"><div class="ph-title">每日明细</div><span class="ph-sub">' + esc(dept) + ' · ' + mon.slice(5) + ' 月</span></div>' +
      dataTable('forecast_daily', [
        { key: 'date', label: '日期' },
        { key: 'est', label: '预估(万)', cls: 'mono', render: function (r) { return money(r.est); } },
        { key: 'actual', label: '实际(万)', cls: 'mono', render: function (r) { return money(r.actual); } },
        {
          key: 'rate', label: '达成率', cls: 'mono', render: function (r) {
            if (!(r.est > 0) || !(r.actual > 0)) return '—';
            var v = (r.actual / r.est) * 100;
            var col = v >= 95 ? '#12a76c' : v >= 80 ? '#f5871f' : '#e5484d';
            return '<span style="color:' + col + ';font-weight:700">' + pct1(v) + '</span>';
          }
        },
        {
          key: 'note', label: '偏差说明', render: function (r) {
            if (!r.note) return '<span style="color:#c3cad5">—</span>';
            var short = r.note.replace(/^解释[:：]/, '');
            return '<span title="' + esc(r.note) + '">' + esc(short.length > 34 ? short.slice(0, 34) + '…' : short) + '</span>';
          }
        }
      ], detailRows, { pageSize: 20, exportName: '业绩预估_每日', searchPlaceholder: '搜索日期或说明…' }) + '</div>';

    return html;
  }

  // ---------- 预估结算 ----------
  function viewRongpin() {
    var rank = modules().anchorRank || {};
    var daily = rank.daily || [];
    var s = rank.summary || {};
    if (!daily.length) {
      return viewHead('预估结算', '暂无数据') + panel('', '', '<div class="empty">还没有结算数据</div>');
    }
    var active = daily.filter(function (x) { return num(x.settle) > 0; });
    var html = viewHead('预估结算', '每日预估结算进度 · ' + (rank.asOf ? '截止 ' + esc(rank.asOf) : ''));
    html += monthNotice(pickMonth(anchorMonths()), '预估结算');

    var total = active.reduce(function (a, x) { return a + num(x.settle); }, 0);
    html += kpiCards([
      { icon: 'settle', color: '#12a76c', title: '累计预估结算', money: s.settleCum, sub: '风控后口径' },
      { icon: 'rate', color: '#f5871f', title: '平均结算率', value: pct1(s.avgRate), unit: '', sub: '整体 ' + pct1(s.calcRate) },
      { icon: 'anchorPerformance', color: '#2f6fed', title: '已出数据', value: active.length, unit: '天', sub: '本月累计' },
      {
        icon: 'gmv', color: '#7a5cff', title: '日均结算', money: (active.length ? total / active.length : 0),
        sub: '按已出数据天数', spark: active.map(function (x) { return num(x.settle); })
      }
    ]);

    html += chartPanel('每日预估结算 GMV', '万元', CH.line(active.map(function (x) {
      return { label: x.day, value: wanNum(x.settle) };
    }), { color: '#12a76c', height: 250, fmt: function (v) { return v + '万'; }, yFmt: plainNum, showValue: active.length <= 8 }));

    html += '<div class="panel"><div class="panel-head"><div class="ph-title">每日明细</div><span class="ph-sub">已出数据 ' +
      active.length + ' 天（未出数的日期不列）</span></div>' +
      dataTable('rongpin_daily', [
        { key: 'day', label: '日期' },
        { key: 'settle', label: '预估结算GMV(元)', cls: 'mono', render: function (r) { return money(r.settle); } },
        { key: 'rate', label: '当日结算率', cls: 'mono', render: function (r) { return num(r.rate) > 0 ? pct1(r.rate) : '—'; } }
      ], active, { exportName: '预估结算_每日', pageSize: 15 }) + '</div>';
    return html;
  }

  var VIEWS = {
    home: viewHome,
    anchorRank: viewAnchorRank,
    anchor: viewAnchorProfile,
    anchorPerformance: viewAnchorPerformance,
    commodity: viewCommodity,
    forecast: viewForecast,
    rongpin: viewRongpin
  };

  // ---------- 渲染 ----------
  function renderNav() {
    var nav = $('nav');
    var groups = {};
    MODULES.forEach(function (m) { (groups[m.group] = groups[m.group] || []).push(m); });
    var html = '';
    Object.keys(groups).forEach(function (g) {
      html += '<div class="nav-group">' + esc(g) + '</div>';
      groups[g].forEach(function (m) {
        var on = m.key === state.current || (state.current === 'anchor' && m.key === 'anchorRank');
        html += '<div class="nav-item' + (on ? ' active' : '') + '" data-key="' + m.key + '">' +
          icon(m.key) + '<span>' + esc(m.label) + '</span></div>';
      });
    });
    nav.innerHTML = html;
    Array.prototype.forEach.call(nav.querySelectorAll('.nav-item'), function (el) {
      el.onclick = function () {
        switchModule(el.getAttribute('data-key'));
        document.querySelector('.sidebar').classList.remove('open');
      };
    });
  }

  function renderView(keepScroll) {
    var content = $('content');
    var prevTop = keepScroll ? content.scrollTop : 0;
    var fn = VIEWS[state.current] || VIEWS.home;
    var title = state.current === 'anchor'
      ? ('主播详情 · ' + (state.profile || ''))
      : ((MODULES.filter(function (m) { return m.key === state.current; })[0] || {}).label || '经营驾驶舱');
    var html;
    try {
      html = fn();
    } catch (e) {
      console.error(e);
      html = '<div class="empty">页面渲染出错：' + esc(e.message) + '</div>';
    }
    content.innerHTML = html;
    $('crumb').textContent = title;
    content.scrollTop = prevTop;
    renderMonthSelect();
  }

  function switchModule(key) {
    if (!VIEWS[key]) key = 'home';
    state.current = key;
    try { history.replaceState(null, '', '#' + key); } catch (e) {}
    renderNav();
    renderView(false);
  }

  // 支持 #anchorRank、#anchorRank/主播名 这类直达链接
  function parseHash() {
    var h = String(location.hash || '').replace(/^#/, '').trim();
    if (!h) return null;
    var seg = h.split('/');
    if (!VIEWS[seg[0]]) return null;
    var arg = seg.slice(1).join('/');
    try { arg = decodeURIComponent(arg); } catch (e) {}
    return { view: seg[0], arg: arg || null };
  }
  function applyHash() {
    var hs = parseHash();
    if (!hs) return;
    if (hs.view === 'anchor' && !hs.arg) hs.view = 'anchorRank';   // #anchor 没带名字时回榜单
    var changed = hs.view !== state.current;
    if (hs.view === 'anchor') {
      if (hs.arg !== state.profile) changed = true;
      state.profile = hs.arg;
    }
    if (changed) {
      state.current = hs.view;
      renderNav();
      renderView(false);
    }
    if (hs.arg && hs.view === 'anchorRank') {
      setTimeout(function () { openAnchor(hs.arg); }, 50);
    }
  }

  window.__refresh = function () {
    var btn = document.querySelector('[data-role="refresh"]');
    if (btn) { btn.disabled = true; btn.textContent = '刷新中…'; }
    fetch('/api/refresh', { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function () { return Promise.all([fetchData(true), fetchSync()]); })
      .then(function () { toast('数据已刷新', 'ok'); })
      .catch(function () { toast('刷新失败，请稍后再试', 'bad'); fetchData(true); })
      .then(function () { if (btn) { btn.disabled = false; btn.textContent = '立即刷新'; } });
  };

  // ---------- 同步状态 / 月份选择 / 轻提示 ----------
  function toast(msg, type) {
    var el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.className = 'toast'; }, 2600);
  }

  // 一次检查的结论。历史数据没有心跳字段时退化成"只有云库写入时间"。
  var CHECK_STATUS = {
    written: { cls: 'fresh', txt: '已更新数据' },
    unchanged: { cls: 'same', txt: '内容无变化' },
    partial: { cls: 'stale', txt: '部分链接失败' },
    failed: { cls: 'stale', txt: '拉取失败' },
    unknown: { cls: 'unknown', txt: '结果未知' }
  };
  function checkStatus(s) {
    if (s && s.check && s.check.status && CHECK_STATUS[s.check.status]) return CHECK_STATUS[s.check.status];
    return { cls: 'fresh', txt: '仅记录云库写入时间' };
  }
  function resLabel(st) {
    return ({ written: '已写入', unchanged: '内容无变化', failed: '失败', paused: '已暂停' })[st] || st || '未知';
  }

  function renderSyncChip() {
    var s = state.sync;
    var el = $('syncTime'), ageEl = $('syncAge'), chip = $('syncChip'), lbl = $('syncLabel');
    if (!el || !chip) return;
    var at = s && (s.lastCheckAt || s.lastPullAt);
    if (!at) {
      el.textContent = '--';
      if (ageEl) ageEl.textContent = '';
      chip.className = 'sync-chip unknown';
      chip.title = '还没有任何拉取记录';
      return;
    }
    var st = checkStatus(s);
    if (lbl) lbl.textContent = (s && s.lastCheckAt) ? '上次检查' : '上次写入';
    el.textContent = fmtDateTime(at);
    if (ageEl) ageEl.textContent = '· ' + relTime(at);
    var mins = (Date.now() - new Date(at).getTime()) / 60000;
    chip.className = 'sync-chip ' + (mins > 120 ? 'stale' : st.cls);
    chip.title = '上次检查 ' + fmtDateTime(at) + '（' + relTime(at) + '）· ' + st.txt + ' · 点击查看详情';
  }

  function fetchSync() {
    return fetch('/api/sync?_t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.ok) return;
        state.sync = j;
        renderSyncChip();
        // 首次加载时快照页可能先渲染、同步信息后到，补一次文字
        var note = document.getElementById('perfCheckAt');
        if (note) note.textContent = j.lastCheckAt ? fmtDateTime(j.lastCheckAt) : '—';
      })
      .catch(function () { });
  }

  function renderSyncModal() {
    var s = state.sync || {};
    var mods = s.modules || [];
    var st = checkStatus(s);
    var at = s.lastCheckAt || s.lastPullAt;
    $('syncSub').textContent = at
      ? ('最近一次检查 ' + fmtDateTime(at) + '（' + relTime(at) + '）· ' + st.txt)
      : '暂无同步记录';

    var html = '<div class="sync-sum">' +
      '<div class="ss-item"><div class="ss-k">上次检查</div><div class="ss-v">' + esc(fmtDateTime(at)) + '</div>' +
      '<div class="ss-s">' + esc(at ? relTime(at) : '—') + ' · ' + esc(st.txt) + '</div></div>' +
      '<div class="ss-item"><div class="ss-k">最后写入云库</div><div class="ss-v">' + esc(fmtDateTime(s.latestWriteAt)) + '</div>' +
      '<div class="ss-s">' + esc(s.latestWriteAt ? relTime(s.latestWriteAt) : '—') + '</div></div>' +
      '<div class="ss-item"><div class="ss-k">云数据库</div><div class="ss-v">' + (s.cloudEnabled ? '已连接' : '未配置') + '</div><div class="ss-s">' +
      (s.cloudEnabled ? '数据以云库为准' : '页面可能没有任何数据') + '</div></div>' +
      '</div>';

    // 本次检查明细：把"拉到了但内容没变"这种关键状态显式说出来，
    // 否则用户点了立即同步、页面时间不动，会以为程序没跑。
    var results = (s.check && s.check.results) || [];
    if (results.length) {
      html += '<div class="sec-title">最近一次检查明细</div><div class="chk-list">' +
        results.map(function (r) {
          var cls = r.status === 'written' ? 'ok' : (r.status === 'unchanged' ? 'same' : 'bad');
          return '<div class="chk-row"><span class="chk-name">' + esc(r.label || '—') + '</span>' +
            '<span class="chk-tag ' + cls + '">' + esc(resLabel(r.status)) + '</span>' +
            '<span class="chk-detail">' + esc(r.detail || '') + '</span></div>';
        }).join('') + '</div>';
    }

    if (s.check && s.check.status) {
      var tips = {
        unchanged: '本次检查完成，但没有向云库写入新数据 —— 说明源文档内容与上次完全一致。页面上「最后写入云库」的时间只会在数据真正变化时前进，这是正常的。',
        written: '本次检查已把最新数据写入云库，上方「最后写入云库」的时间会同步前进。',
        partial: '本次检查：能拉到的已经处理，另有链接拉取失败（原因见上方明细）。失败链接需要在 WPS 里解除「禁止下载」或恢复共享，然后重跑「立即同步一次」。',
        failed: '本次检查没有写入任何数据，链接拉取失败（原因见上方明细）。'
      };
      if (tips[s.check.status]) {
        html += '<div class="notice' + (s.check.status === 'failed' || s.check.status === 'partial' ? ' warn' : '') +
          '" style="margin-top:12px"><span class="ni">i</span><span>' + tips[s.check.status] + '</span></div>';
      }
    }

    html += '<div class="sec-title">各模块最后写入时间</div>';
    if (mods.length) {
      html += '<table class="tbl compact"><thead><tr><th>模块</th><th>写入时间</th><th>数据截止</th><th>距今</th></tr></thead><tbody>' +
        mods.map(function (m) {
          return '<tr><td>' + esc(m.label) + '</td><td class="mono">' + esc(fmtDateTime(m.updatedAt)) +
            '</td><td>' + esc(m.asOf || '—') + '</td><td>' + esc(relTime(m.updatedAt)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else {
      html += '<div class="empty">暂无模块时间记录</div>';
    }

    if (s.pull && s.pull.links && s.pull.links.length) {
      html += '<div class="sec-title">拉取链接</div>';
      s.pull.links.forEach(function (l) {
        var bad = l.fail > 0;
        html += '<div class="pull-row"><span class="pr-name">' + esc(l.name) + '</span>' +
          '<span class="pr-state ' + (bad ? 'bad' : 'ok') + '">' +
          (bad ? '已暂停 · 连续失败 ' + l.fail + ' 次（' + esc(l.error || '未知原因') + '）' : '正常') + '</span>' +
          '<span class="pr-time">' + esc(fmtDateTime(l.at)) + '</span></div>';
      });
    }

    html += '<div class="modal-foot"><span class="muted-sm">真正的拉取由你本机运行的同步助手执行（' +
      (s.refreshMinutes || 20) + ' 分钟一轮）；页面上想立刻看到结果，双击本机「立即同步一次.bat」，然后点右边刷新。</span>' +
      '<button class="tbtn primary" data-role="refresh">立即刷新</button></div>';

    $('syncBody').innerHTML = html;
  }

  function openSync() {
    renderSyncModal();
    $('syncMask').classList.add('show');
    fetchSync().then(renderSyncModal);
  }
  function closeSync() { $('syncMask').classList.remove('show'); }

  function renderMonthSelect() {
    var sel = $('monthSelect');
    if (!sel) return;
    var months = allMonths().slice().reverse();
    var html = '<option value="">最新月份</option>' + months.map(function (m) {
      return '<option value="' + m + '">' + esc(monthName(m)) + '</option>';
    }).join('');
    if (sel.getAttribute('data-sig') !== html) {
      sel.innerHTML = html;
      sel.setAttribute('data-sig', html);
    }
    sel.value = state.month || '';
  }

  // ---------- 图表悬停浮层 ----------
  function bindChartTip() {
    var tip = $('chartTip');
    if (!tip) return;
    document.addEventListener('mousemove', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!el) { tip.classList.remove('show'); return; }
      var txt = el.getAttribute('data-tip');
      if (tip.textContent !== txt) tip.textContent = txt;
      tip.classList.add('show');
      var x = e.clientX + 14, y = e.clientY - 12;
      var w = tip.offsetWidth, h = tip.offsetHeight;
      if (x + w > window.innerWidth - 10) x = e.clientX - w - 14;
      if (y - h < 8) y = e.clientY + 20;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    });
  }

  // ---------- 事件 ----------
  function attachHandlers() {
    // 委托到 document：抽屉里的表格在 #content 之外，也要能响应排序/搜索/分页
    document.addEventListener('click', function (e) {
      var t = e.target;

      // 点图表任意位置 → 打开大图（放大按钮走自己的 handler，已 stopPropagation）
      var cm = t.closest ? t.closest('.chart-mount[data-mounted="1"]') : null;
      if (cm && !(t.closest && t.closest('button'))) {
        openChartModal(cm.getAttribute('data-cid'));
        return;
      }

      // 打开主播完整分析页（表格里的主播名 / 抽屉里的入口按钮）
      var pf = t.closest ? t.closest('[data-profile]') : null;
      if (pf) {
        if (e.stopPropagation) e.stopPropagation();
        openProfile(pf.getAttribute('data-profile'));
        return;
      }

      // 主播详情页：切换观察指标
      var mchip = t.closest ? t.closest('[data-metric]') : null;
      if (mchip) {
        state.metric[state.profile] = mchip.getAttribute('data-metric');
        renderView(true);
        return;
      }

      // 通用按钮
      var btn = t.closest ? t.closest('[data-role]') : null;
      if (btn) {
        var role = btn.getAttribute('data-role');
        if (role === 'refresh') { window.__refresh(); return; }
        if (role === 'profile-back') { switchModule('anchorRank'); return; }
        if (role === 'profile-export') {
          var pmeta = state.tableMeta['profile_daily_' + state.profile];
          if (pmeta) downloadCSV(pmeta.cols, pmeta.rows, '主播明细_' + state.profile + '.csv');
          return;
        }
        if (role === 'export') {
          var mod = btn.getAttribute('data-mod');
          var meta = state.tableMeta[mod];
          if (meta) downloadCSV(meta.cols, meta.rows, (meta.opts.exportName || mod) + '.csv');
          return;
        }
        if (role === 'img') {
          var panelEl = btn.closest('.chart-panel') || btn.closest('.panel');
          var svg = panelEl ? panelEl.querySelector('svg.chart') : null;
          if (!svg) { alert('未找到图表'); return; }
          var tt = panelEl.querySelector('.ph-title');
          exportSVGToPNG(svg, (tt ? tt.textContent.trim() : 'chart') + '.png');
          return;
        }
        if (role === 'export-rank') {
          var rk = modules().anchorRank || {};
          var rowsAll = (rk.rows || []);
          downloadCSV([
            { key: 'anchor', label: '主播' }, { key: 'org', label: '所属公司' }, { key: 'type', label: '类型' },
            { key: 'gmv', label: '当日GMV' }, { key: 'gmvCum', label: '累计GMV' },
            { key: 'settleCum', label: '结算GMV' }, { key: 'rate', label: '结算率' }
          ], rowsAll, '主播榜单_全部.csv');
          return;
        }
      }

      // 快捷筛选
      var chip = t.closest ? t.closest('[data-filter]') : null;
      if (chip) {
        state.filter.anchorRank = chip.getAttribute('data-filter');
        state.page.anchorRank = 1;
        renderView(true);
        return;
      }

      // 业绩预估：月份 / 部门切换
      var fcm = t.closest ? t.closest('[data-fc]') : null;
      if (fcm) {
        // 与顶部月份选择器保持同源，否则两处会各说各话
        state.month = fcm.getAttribute('data-fc');
        state.filter.forecastMonth = state.month;
        renderView(true);
        return;
      }
      var fdp = t.closest ? t.closest('[data-fd]') : null;
      if (fdp) {
        state.filter.forecast = fdp.getAttribute('data-fd');
        renderView(true);
        return;
      }

      // 洞察跳转
      var ins = t.closest ? t.closest('[data-insight]') : null;
      if (ins) {
        var cards = IN.build(modules());
        var it = cards[parseInt(ins.getAttribute('data-insight'), 10)];
        if (it && it.action) {
          if (it.action.filter) { state.filter.anchorRank = it.action.filter; state.page.anchorRank = 1; }
          switchModule(it.action.view);
        }
        return;
      }

      // 跳转按钮
      var go = t.closest ? t.closest('[data-goto]') : null;
      if (go) { switchModule(go.getAttribute('data-goto')); return; }

      // 排序
      var th = t.closest ? t.closest('th.sortable') : null;
      if (th) {
        var block = th.closest('[data-tblroot]');
        if (!block) return;
        var mkey = block.getAttribute('data-tblroot');
        var col = th.getAttribute('data-col');
        var cur = state.sort[mkey];
        state.sort[mkey] = { key: col, dir: (cur && cur.key === col && cur.dir === 'asc') ? 'desc' : 'asc' };
        refreshTable(mkey, true);
        return;
      }

      // 分页
      var pg = t.closest ? t.closest('[data-pg]') : null;
      if (pg) {
        var blk = pg.closest('[data-tblroot]');
        if (!blk) return;
        var mk = blk.getAttribute('data-tblroot');
        state.page[mk] = parseInt(pg.getAttribute('data-pg'), 10);
        refreshTable(mk, false);
        return;
      }

      // 行点击 → 抽屉
      var tr = t.closest ? t.closest('tr.drow') : null;
      if (tr) {
        var tableRoot = tr.closest('[data-tblroot]');
        if (!tableRoot) return;
        var kmod = tableRoot.getAttribute('data-tblroot');
        var meta2 = state.tableMeta[kmod];
        if (!meta2 || !meta2.opts || !meta2.opts.onRow) return;
        var idx = parseInt(tr.getAttribute('data-row'), 10);
        var st = tableState(kmod, meta2.cols, meta2.rows, meta2.opts);
        var row = st.all[idx];
        if (row) meta2.opts.onRow(row);
      }
    });

    // 搜索：只刷新表体，保持输入焦点
    document.addEventListener('input', function (e) {
      var inp = e.target.closest ? e.target.closest('input[data-role="search"]') : null;
      if (!inp) return;
      var mod = inp.getAttribute('data-mod');
      state.search[mod] = inp.value;
      state.page[mod] = 1;
      refreshTable(mod, true);
    });

    document.addEventListener('change', function (e) {
      // 顶部月份筛选
      if (e.target && e.target.id === 'monthSelect') {
        state.month = e.target.value || '';
        Object.keys(state.page).forEach(function (k) { state.page[k] = 1; });
        renderView(true);
        return;
      }
      var sel = e.target.closest ? e.target.closest('select[data-role="pagesize"]') : null;
      if (!sel) return;
      var m2 = sel.getAttribute('data-mod');
      state.pageSize[m2] = parseInt(sel.value, 10) || 20;
      state.page[m2] = 1;
      refreshTable(m2, true);
    });

    // 抽屉
    $('drawerClose').onclick = closeDrawer;
    $('drawerMask').onclick = closeDrawer;

    // 同步状态
    $('syncChip').onclick = openSync;
    $('syncClose').onclick = closeSync;
    $('syncMask').onclick = function (e) { if (e.target === $('syncMask')) closeSync(); };

    // 侧栏
    $('collapseBtn').onclick = function () {
      var sb = document.querySelector('.sidebar');
      sb.classList.toggle('collapsed');
      this.textContent = sb.classList.contains('collapsed') ? '⟩' : '⟨ 收起';
    };
    $('menuBtn').onclick = function () {
      document.querySelector('.sidebar').classList.toggle('open');
    };
  }

  // ---------- 命令面板 ----------
  var cmdState = { items: [], active: 0 };

  function buildIndex() {
    var d = modules();
    var items = [];
    MODULES.forEach(function (m) {
      items.push({ type: 'page', label: m.label, sub: '页面', val: m.key, icon: '↗' });
    });
    var rank = d.anchorRank || {};
    (rank.rows || []).forEach(function (r) {
      if (!r.anchor) return;
      items.push({
        type: 'anchor', label: r.anchor, sub: '主播 · 累计 ' + wan(r.gmvCum) + ' 万',
        val: r.anchor, icon: '播'
      });
    });
    var comm = d.commodity || {};
    (comm.products || []).forEach(function (p) {
      items.push({ type: 'product', label: p.name, sub: '商品 · 结算 ' + wan(p.settle) + ' 万', val: p.name, icon: '品' });
    });
    (comm.categories || []).forEach(function (c) {
      items.push({ type: 'cat', label: c.name, sub: '类目 · 结算率 ' + pct1(c.rate), val: c.name, icon: '类' });
    });
    state.cmdIndex = items;
    return items;
  }

  function renderCmd(q) {
    var all = state.cmdIndex || buildIndex();
    var query = (q || '').trim().toLowerCase();
    var list = query ? all.filter(function (x) {
      return String(x.label).toLowerCase().indexOf(query) >= 0;
    }) : all.filter(function (x) { return x.type === 'page'; });
    list = list.slice(0, 40);

    cmdState.items = list;
    cmdState.active = 0;

    if (!list.length) {
      $('cmdList').innerHTML = '<div class="cmd-empty">没有匹配项</div>';
      return;
    }
    var order = { page: '页面', anchor: '主播', product: '商品', cat: '类目' };
    var html = '', lastType = '';
    list.forEach(function (it, i) {
      if (it.type !== lastType) {
        html += '<div class="cmd-group">' + order[it.type] + '</div>';
        lastType = it.type;
      }
      html += '<div class="cmd-item' + (i === 0 ? ' on' : '') + '" data-idx="' + i + '">' +
        '<span class="ci-icon">' + esc(it.icon) + '</span><span>' + esc(it.label) + '</span>' +
        '<span class="ci-sub">' + esc(it.sub) + '</span></div>';
    });
    $('cmdList').innerHTML = html;
  }

  function openCmd() {
    buildIndex();
    $('cmdMask').classList.add('show');
    $('cmdInput').value = '';
    renderCmd('');
    setTimeout(function () { $('cmdInput').focus(); }, 30);
  }
  function closeCmd() { $('cmdMask').classList.remove('show'); }

  function runCmdItem(it) {
    if (!it) return;
    closeCmd();
    if (it.type === 'page') { switchModule(it.val); return; }
    if (it.type === 'anchor') { openProfile(it.val); return; }
    if (it.type === 'product' || it.type === 'cat') {
      state.current = 'commodity';
      state.search[it.type === 'product' ? 'commodity_prod' : 'commodity_cat'] = it.val;
      renderNav();
      renderView(false);
    }
  }

  function bindCmd() {
    $('searchTrigger').onclick = openCmd;
    $('cmdMask').onclick = function (e) { if (e.target === $('cmdMask')) closeCmd(); };
    $('cmdInput').addEventListener('input', function () { renderCmd(this.value); });
    $('cmdList').addEventListener('click', function (e) {
      var it = e.target.closest('[data-idx]');
      if (it) runCmdItem(cmdState.items[parseInt(it.getAttribute('data-idx'), 10)]);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('cmdMask').classList.contains('show') ? closeCmd() : openCmd();
        return;
      }
      if (e.key === 'Escape') { closeCmd(); closeDrawer(); closeSync(); return; }

      // 数字键 1~6 快速切页（输入框里不触发）
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-6]$/.test(e.key)) {
        var tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        var mi = parseInt(e.key, 10) - 1;
        if (MODULES[mi]) switchModule(MODULES[mi].key);
        return;
      }

      if (!$('cmdMask').classList.contains('show')) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var n = cmdState.items.length;
        if (!n) return;
        cmdState.active = (cmdState.active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
        Array.prototype.forEach.call($('cmdList').querySelectorAll('.cmd-item'), function (el, i) {
          el.classList.toggle('on', i === cmdState.active);
        });
        var onEl = $('cmdList').querySelector('.cmd-item.on');
        if (onEl && onEl.scrollIntoView) onEl.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        runCmdItem(cmdState.items[cmdState.active]);
      }
    });
  }

  // ---------- 数据 ----------
  function renderSyncBar(j) {
    var el = $('syncBar');
    if (!el) return;
    var items = (j && j.items) || [];
    // 只在「页面完全没有这类数据」时提示。否则 mtime 与云库 updated_at 的口径差异会长期误报：
    // 拉取器比对内容指纹一致时会跳过写入，updated_at 不变，但表格 mtime 已经更新。
    var stale = items.filter(function (x) { return x.stale && x.reachable && x.linkOpen && !x.hasCloudData; });
    if (!stale.length) { el.style.display = 'none'; return; }
    var parts = stale.map(function (x) {
      return '<b>' + x.label + '</b>（表格已于 ' + fmtTime(x.mtime) + ' 更新' + (x.hasCloudData ? '' : '，页面尚无数据') + '）';
    });
    el.innerHTML = '<span class="sb-icon">⚠</span><span class="sb-text">以下表格有更新，页面数据还未同步：' + parts.join('；') + '。</span>' +
      '<button class="sb-btn" id="sbOpen">打开表格</button><span class="sb-close" id="sbClose">×</span>';
    el.style.display = 'flex';
    $('sbOpen').onclick = function () { if (stale[0] && stale[0].url) window.open(stale[0].url, '_blank'); };
    $('sbClose').onclick = function () { el.style.display = 'none'; };
  }

  function fetchFreshness() {
    return fetch('/api/freshness?_t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.ok) renderSyncBar(j); })
      .catch(function () {});
  }

  function fetchData(force) {
    return fetch('/api/data?_t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { location.reload(); return null; }
      return r.json();
    }).then(function (d) {
      if (!d) return;
      if (!force && state.lastUpdated && d.updatedAt === state.lastUpdated) return;
      state.data = d;
      state.lastUpdated = d.updatedAt;
      renderView(true);
    }).catch(function (e) { console.error(e); });
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(function () {
      fetchData(false);
      fetchFreshness();
      fetchSync();
      renderSyncChip();
    }, 60000);
    fetchFreshness();
    fetchSync();
  }

  function tickClock() {
    var now = new Date();
    var s = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var el = $('topClock');
    if (el) el.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + s;
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
          if ($('remember').checked) { try { localStorage.setItem('dp_remember', JSON.stringify({ u: u, p: p })); } catch (err) {} }
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
    var hs = parseHash();
    if (hs) {
      state.current = (hs.view === 'anchor' && !hs.arg) ? 'anchorRank' : hs.view;
      if (hs.view === 'anchor') state.profile = hs.arg;
    }
    renderNav();
    fetchData(true).then(function () {
      if (hs && hs.arg && hs.view === 'anchorRank') openAnchor(hs.arg);
      if (hs && hs.arg && hs.view === 'anchor') renderView(false);
    });
    startPolling();
    window.addEventListener('hashchange', applyHash);
  }

  function logout() {
    fetch('/api/logout', { method: 'POST' }).then(function () { location.reload(); });
  }

  // ---------- 初始化 ----------
  function init() {
    try {
      var rem = JSON.parse(localStorage.getItem('dp_remember') || 'null');
      if (rem) { $('username').value = rem.u || ''; $('password').value = rem.p || ''; $('remember').checked = true; }
    } catch (e) {}
    $('loginForm').addEventListener('submit', doLogin);
    $('logoutBtn').onclick = logout;
    attachHandlers();
    bindCmd();
    bindChartTip();
    bindChartModal();
    observeCharts();
    setInterval(tickClock, 30000); tickClock();
    setInterval(renderSyncChip, 20000);   // 相对时间（几分钟前）跟着走
    setInterval(fetchSync, 60000);        // 本机同步助手在后台拉完后，胶囊能自己跟上

    fetch('/api/me?_t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.user) enterApp(j.user); })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
