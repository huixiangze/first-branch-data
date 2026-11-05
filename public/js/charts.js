// 第一分公司数据中台 —— 轻量 SVG 图表（零依赖）
// 全部函数返回 SVG 字符串，宽度自适应（viewBox + CSS width:100%）
(function () {
  'use strict';
  var PALETTE = ['#2f6fed', '#2bbf7a', '#ff8c3b', '#f4c042', '#ef5b5b', '#7a5cff', '#19b6c9', '#ff7aa8'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function uid() { return 'g' + Math.random().toString(36).slice(2, 9); }

  // 数量级友好的上限：1 / 2 / 2.5 / 5 / 10 × 10^n
  function niceMax(v) {
    if (!isFinite(v) || v <= 0) return 1;
    var exp = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var f = v / exp;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * exp;
  }
  function fmtShort(v) {
    var a = Math.abs(v);
    if (a >= 100000000) return (v / 100000000).toFixed(a >= 1000000000 ? 1 : 2) + '亿';
    if (a >= 10000) return (v / 10000).toFixed(a >= 100000 ? 0 : 1) + '万';
    if (a >= 1000) return Math.round(v).toLocaleString('en-US');
    return String(Math.round(v * 100) / 100);
  }
  function clip(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ---------- 横向条形图（保留原签名） ----------
  function hBars(items, opts) {
    opts = opts || {};
    items = items || [];
    if (!items.length) return '<div class="chart-empty">暂无数据</div>';
    var unit = opts.unit || '';
    var fmt = opts.fmt || null;
    var rowH = opts.rowH || 34, padTop = 10, labelW = opts.labelW || 110, valW = 78;
    var max = 0;
    items.forEach(function (it) { if (it.value > max) max = it.value; });
    if (max <= 0) max = 1;
    var barArea = 680 - labelW - valW - 12;
    var h = padTop + items.length * rowH + 10;
    var svg = '<svg class="chart" viewBox="0 0 680 ' + h + '" preserveAspectRatio="xMidYMid meet">';
    items.forEach(function (it, i) {
      var y = padTop + i * rowH;
      var w = Math.max(2, (it.value / max) * barArea);
      var color = it.color || PALETTE[i % PALETTE.length];
      var text = fmt ? fmt(it.value) : it.value + unit;
      svg += '<text x="0" y="' + (y + 20) + '" font-size="13" fill="#1f2733">' + esc(clip(it.label, 14)) + '</text>';
      svg += '<rect x="' + labelW + '" y="' + (y + 6) + '" width="' + barArea + '" height="18" rx="9" fill="#eef1f5"/>';
      svg += '<rect x="' + labelW + '" y="' + (y + 6) + '" width="' + w + '" height="18" rx="9" fill="' + color + '"><title>' + esc(it.label) + '：' + esc(text) + '</title></rect>';
      svg += '<text x="' + (680 - valW + 6) + '" y="' + (y + 20) + '" font-size="13" font-weight="700" fill="#1f2733">' + esc(text) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  // ---------- 竖向条形图（保留原签名） ----------
  function vBars(items, opts) {
    opts = opts || {};
    items = items || [];
    if (!items.length) return '<div class="chart-empty">暂无数据</div>';
    var unit = opts.unit || '';
    var W = 680, H = opts.height || 260, base = H - 40, pad = 20;
    var max = 0;
    items.forEach(function (it) { if (it.value > max) max = it.value; });
    if (max <= 0) max = 1;
    var n = items.length;
    var slot = (W - pad * 2) / n;
    var bw = Math.min(46, slot * 0.6);
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
    svg += '<line x1="' + pad + '" y1="' + base + '" x2="' + (W - pad) + '" y2="' + base + '" stroke="#e6eaf0"/>';
    items.forEach(function (it, i) {
      var h = (it.value / max) * (base - 30);
      var x = pad + i * slot + (slot - bw) / 2;
      var y = base - h;
      var color = it.color || PALETTE[i % PALETTE.length];
      svg += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(1, h) + '" rx="5" fill="' + color + '"><title>' + esc(it.label) + '：' + esc(it.value) + unit + '</title></rect>';
      svg += '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" font-size="12" font-weight="700" text-anchor="middle" fill="#1f2733">' + esc(it.value) + unit + '</text>';
      svg += '<text x="' + (x + bw / 2) + '" y="' + (base + 16) + '" font-size="12" text-anchor="middle" fill="#8a94a6">' + esc(clip(it.label, 8)) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  // ---------- 环形进度（保留原签名） ----------
  function donut(percent, opts) {
    opts = opts || {};
    var color = opts.color || '#2f6fed';
    var size = 160, r = 64, cx = size / 2, cy = size / 2;
    var c = 2 * Math.PI * r;
    var off = c * (1 - Math.min(100, Math.max(0, percent)) / 100);
    var svg = '<svg class="chart" viewBox="0 0 ' + size + ' ' + size + '" style="max-width:180px">';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#eef1f5" stroke-width="14"/>';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
    svg += '<text x="' + cx + '" y="' + (cy + 6) + '" font-size="30" font-weight="800" text-anchor="middle" fill="#1f2733">' + esc(percent) + '%</text>';
    svg += '</svg>';
    return svg;
  }

  // ---------- 折线图（面积渐变 + 网格 + 数值轴） ----------
  // points: [{ label, value, color? }]  或  { series:[{name,color,points:[{label,value}]}] }
  function line(points, opts) {
    opts = opts || {};
    points = points || [];
    if (points.length < 1) return '<div class="chart-empty">暂无数据</div>';

    var W = 680, H = opts.height || 260;
    var L = 54, R = 18, T = 18, B = 34;
    var iw = W - L - R, ih = H - T - B;
    var vals = points.map(function (p) { return Number(p.value) || 0; });
    var max = Math.max.apply(null, vals.concat([0]));
    var top = niceMax(max * 1.08);
    var color = opts.color || PALETTE[0];
    var gid = uid();

    function X(i) { return L + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1)); }
    function Y(v) { return T + ih - (v / top) * ih; }

    var svg = '<svg class="chart" viewBox="0 0 680 ' + H + '" preserveAspectRatio="none" style="height:' + H + 'px">';
    svg += '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.26"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.02"/></linearGradient></defs>';

    // 水平网格 + y 轴刻度
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var v = (top / ticks) * t;
      var y = Y(v);
      svg += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="#eef1f5" stroke-width="1"/>';
      svg += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" font-size="11" text-anchor="end" fill="#98a2b3">' + esc(fmtShort(v)) + '</text>';
    }

    // 面积
    var dArea = 'M' + X(0) + ',' + Y(vals[0]);
    for (var i = 1; i < vals.length; i++) dArea += ' L' + X(i) + ',' + Y(vals[i]);
    dArea += ' L' + X(vals.length - 1) + ',' + Y(0) + ' L' + X(0) + ',' + Y(0) + ' Z';
    svg += '<path d="' + dArea + '" fill="url(#' + gid + ')"/>';

    // 折线
    var dLine = 'M' + X(0) + ',' + Y(vals[0]);
    for (var j = 1; j < vals.length; j++) dLine += ' L' + X(j) + ',' + Y(vals[j]);
    svg += '<path d="' + dLine + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

    // 数据点
    var step = points.length > 14 ? Math.ceil(points.length / 14) : 1;
    points.forEach(function (p, k) {
      var show = (k % step === 0) || k === points.length - 1;
      if (!show) return;
      var cx = X(k), cy = Y(vals[k]);
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#fff" stroke="' + color + '" stroke-width="2.5">' +
        '<title>' + esc(p.label) + '：' + esc(opts.fmt ? opts.fmt(vals[k]) : fmtShort(vals[k])) + '</title></circle>';
      if (opts.showValue && points.length <= 12) {
        var anc = k === 0 ? 'start' : (k === points.length - 1 ? 'end' : 'middle');
        var dx = k === 0 ? 4 : (k === points.length - 1 ? -4 : 0);
        svg += '<text x="' + (cx + dx) + '" y="' + (cy - 12) + '" font-size="11" font-weight="700" text-anchor="' + anc + '" fill="' + color + '">' +
          esc(opts.fmt ? opts.fmt(vals[k]) : fmtShort(vals[k])) + '</text>';
      }
    });

    // x 轴标签
    points.forEach(function (p, k) {
      if (k % step !== 0 && k !== points.length - 1) return;
      var anc2 = k === 0 ? 'start' : (k === points.length - 1 ? 'end' : 'middle');
      svg += '<text x="' + X(k) + '" y="' + (H - 12) + '" font-size="11" text-anchor="' + anc2 + '" fill="#98a2b3">' +
        esc(clip(p.label, 6)) + '</text>';
    });

    svg += '</svg>';
    return svg;
  }

  // ---------- 散点图（四象限：数值 vs 比率） ----------
  // points: [{ x, y, label, color?, r? }]，xAvg/yAvg 为均值参考线
  function scatter(points, opts) {
    opts = opts || {};
    points = (points || []).filter(function (p) { return isFinite(p.x) && isFinite(p.y); });
    if (!points.length) return '<div class="chart-empty">暂无数据</div>';

    var W = 680, H = opts.height || 320;
    var L = 56, R = 22, T = 20, B = 40;
    var iw = W - L - R, ih = H - T - B;
    var xs = points.map(function (p) { return p.x; });
    var ys = points.map(function (p) { return p.y; });
    var xMax = niceMax(Math.max.apply(null, xs) * 1.1);
    var yMax = niceMax(Math.max.apply(null, ys) * 1.15);
    var xAvg = opts.xAvg != null ? opts.xAvg : xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var yAvg = opts.yAvg != null ? opts.yAvg : ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;

    function X(v) { return L + (v / xMax) * iw; }
    function Y(v) { return T + ih - (v / yMax) * ih; }

    var svg = '<svg class="chart" viewBox="0 0 680 ' + H + '" preserveAspectRatio="none" style="height:' + H + 'px">';
    // 网格
    for (var t = 0; t <= 4; t++) {
      var gy = T + (ih / 4) * t;
      svg += '<line x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '" stroke="#f2f4f8"/>';
      svg += '<text x="' + (L - 8) + '" y="' + (gy + 4) + '" font-size="11" text-anchor="end" fill="#98a2b3">' + esc(fmtShort(yMax - (yMax / 4) * t)) + '</text>';
    }
    // 均值参考线
    svg += '<line x1="' + X(xAvg) + '" y1="' + T + '" x2="' + X(xAvg) + '" y2="' + (T + ih) + '" stroke="#d9dfe8" stroke-dasharray="4 4"/>';
    svg += '<line x1="' + L + '" y1="' + Y(yAvg) + '" x2="' + (W - R) + '" y2="' + Y(yAvg) + '" stroke="#d9dfe8" stroke-dasharray="4 4"/>';
    svg += '<text x="' + (W - R) + '" y="' + (T + 12) + '" font-size="11" text-anchor="end" fill="#b3bcc9">' + esc(opts.yLabel || '') + '</text>';
    svg += '<text x="' + (W - R) + '" y="' + (H - 6) + '" font-size="11" text-anchor="end" fill="#b3bcc9">' + esc(opts.xLabel || '') + '</text>';

    // 点：先画小点后画大点，避免遮挡
    var sorted = points.slice().sort(function (a, b) { return (a.r || 5) - (b.r || 5); });
    sorted.forEach(function (p) {
      var color = p.color || PALETTE[0];
      var r = p.r || 5;
      svg += '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="' + r + '" fill="' + color + '" fill-opacity="0.72" stroke="#fff" stroke-width="1.2">' +
        '<title>' + esc(p.label) + '\n' + esc(opts.xLabel || 'x') + '：' + esc(fmtShort(p.x)) + '\n' + esc(opts.yLabel || 'y') + '：' + esc(p.y) + '</title></circle>';
    });
    svg += '</svg>';
    return svg;
  }

  // ---------- 多段环形图 ----------
  // items: [{ label, value, color? }]
  function donutChart(items, opts) {
    opts = opts || {};
    items = (items || []).filter(function (x) { return x.value > 0; });
    if (!items.length) return '<div class="chart-empty">暂无数据</div>';
    var size = opts.size || 200, stroke = opts.stroke || 26;
    var cx = size / 2, cy = size / 2, r = (size - stroke) / 2 - 4;
    var c = 2 * Math.PI * r;
    var total = items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var acc = 0;
    var svg = '<svg class="chart" viewBox="0 0 ' + size + ' ' + size + '" style="max-width:' + size + 'px;margin:0 auto">';
    svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#f2f4f8" stroke-width="' + stroke + '"/>';
    items.forEach(function (it, i) {
      var frac = it.value / total;
      var len = frac * c;
      var color = it.color || PALETTE[i % PALETTE.length];
      svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + stroke + '"' +
        ' stroke-dasharray="' + Math.max(0.5, len - 2) + ' ' + (c - Math.max(0.5, len - 2)) + '"' +
        ' stroke-dashoffset="' + (-acc) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')">' +
        '<title>' + esc(it.label) + '：' + esc(fmtShort(it.value)) + '（' + (frac * 100).toFixed(1) + '%）</title></circle>';
      acc += len;
    });
    if (opts.centerTop) {
      svg += '<text x="' + cx + '" y="' + (cy - 2) + '" font-size="20" font-weight="800" text-anchor="middle" fill="#1f2733">' + esc(opts.centerTop) + '</text>';
    }
    if (opts.centerSub) {
      svg += '<text x="' + cx + '" y="' + (cy + 20) + '" font-size="12" text-anchor="middle" fill="#8a94a6">' + esc(opts.centerSub) + '</text>';
    }
    svg += '</svg>';
    return svg;
  }

  // ---------- 多折线（共享 Y 轴，用于预估 vs 实际） ----------
  // series: [{ name, color, points:[{label,value}] }]
  function multiLine(series, opts) {
    opts = opts || {};
    series = (series || []).filter(function (s) { return s && s.points && s.points.length; });
    if (!series.length) return '<div class="chart-empty">暂无数据</div>';

    var W = 680, H = opts.height || 260;
    var L = 54, R = 18, T = 18, B = 34;
    var iw = W - L - R, ih = H - T - B;
    var max = 0, n = 1;
    series.forEach(function (s) {
      if (s.points.length > n) n = s.points.length;
      s.points.forEach(function (p) { if ((Number(p.value) || 0) > max) max = Number(p.value) || 0; });
    });
    var top = niceMax(max * 1.08);

    function X(i) { return L + (n === 1 ? iw / 2 : (i * iw) / (n - 1)); }
    function Y(v) { return T + ih - ((Number(v) || 0) / top) * ih; }

    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="height:' + H + 'px">';

    for (var t = 0; t <= 4; t++) {
      var v = (top / 4) * t, gy = Y(v);
      svg += '<line x1="' + L + '" y1="' + gy + '" x2="' + (W - R) + '" y2="' + gy + '" stroke="#eef1f5"/>';
      svg += '<text x="' + (L - 8) + '" y="' + (gy + 4) + '" font-size="11" text-anchor="end" fill="#98a2b3">' + esc(fmtShort(v)) + '</text>';
    }

    series.forEach(function (s, si) {
      var color = s.color || PALETTE[si % PALETTE.length];
      var d = '';
      s.points.forEach(function (p, i) {
        d += (i === 0 ? 'M' : ' L') + X(i) + ',' + Y(p.value);
      });
      if (s.dashed) {
        svg += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"/>';
      } else {
        svg += '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
      }
      var step = s.points.length > 16 ? Math.ceil(s.points.length / 16) : 1;
      s.points.forEach(function (p, i) {
        if (i % step !== 0 && i !== s.points.length - 1) return;
        svg += '<circle cx="' + X(i) + '" cy="' + Y(p.value) + '" r="3.4" fill="#fff" stroke="' + color + '" stroke-width="2">' +
          '<title>' + esc(s.name) + ' · ' + esc(p.label) + '：' + esc(opts.fmt ? opts.fmt(p.value) : fmtShort(p.value)) + '</title></circle>';
      });
    });

    // x 轴标签（取第一组）
    var base = series[0].points;
    var step2 = base.length > 16 ? Math.ceil(base.length / 10) : 1;
    base.forEach(function (p, i) {
      if (i % step2 !== 0 && i !== base.length - 1) return;
      var anc = i === 0 ? 'start' : (i === base.length - 1 ? 'end' : 'middle');
      svg += '<text x="' + X(i) + '" y="' + (H - 12) + '" font-size="11" text-anchor="' + anc + '" fill="#98a2b3">' + esc(clip(p.label, 7)) + '</text>';
    });

    svg += '</svg>';
    return svg;
  }

  // ---------- 迷你趋势线（表格行内 / KPI 卡） ----------
  function spark(values, opts) {
    opts = opts || {};
    values = (values || []).map(function (v) { return Number(v) || 0; });
    if (values.length < 2) return '<span class="spark-none">—</span>';
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    if (max <= 0) return '<span class="spark-none">—</span>';
    var W = opts.w || 84, H = opts.h || 26, pad = 2;
    var span = max - min || 1;
    var color = opts.color || '#2f6fed';
    var pts = values.map(function (v, i) {
      var x = pad + (i * (W - pad * 2)) / (values.length - 1);
      var y = H - pad - ((v - min) / span) * (H - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" style="width:' + W + 'px;height:' + H + 'px">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + pts.split(' ').pop().split(',')[0] + '" cy="' + pts.split(' ').pop().split(',')[1] + '" r="2.4" fill="' + color + '"/>' +
      '</svg>';
  }

  window.chartHelpers = {
    hBars: hBars, vBars: vBars, donut: donut,
    line: line, multiLine: multiLine, scatter: scatter, donutChart: donutChart, spark: spark,
    fmtShort: fmtShort, niceMax: niceMax, PALETTE: PALETTE
  };
})();
