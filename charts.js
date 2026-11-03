// 第一分公司数据中台 —— 轻量 SVG 图表（零依赖）
(function () {
  'use strict';
  var PALETTE = ['#2f6fed', '#2bbf7a', '#ff8c3b', '#f4c042', '#ef5b5b', '#7a5cff', '#19b6c9', '#ff7aa8'];

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // 横向条形图
  function hBars(items, opts) {
    opts = opts || {};
    var unit = opts.unit || '';
    var rowH = 34, padTop = 10, labelW = opts.labelW || 110, valW = 70;
    var max = 0;
    items.forEach(function (it) { if (it.value > max) max = it.value; });
    if (max <= 0) max = 1;
    var barArea = 680 - labelW - valW;
    var h = padTop + items.length * rowH + 10;
    var svg = '<svg class="chart" viewBox="0 0 680 ' + h + '" preserveAspectRatio="xMidYMid meet">';
    items.forEach(function (it, i) {
      var y = padTop + i * rowH;
      var w = Math.max(2, (it.value / max) * barArea);
      var color = it.color || PALETTE[i % PALETTE.length];
      svg += '<text x="0" y="' + (y + 20) + '" font-size="13" fill="#1f2733">' + esc(it.label) + '</text>';
      svg += '<rect x="' + labelW + '" y="' + (y + 6) + '" width="' + barArea + '" height="18" rx="9" fill="#eef1f5"/>';
      svg += '<rect x="' + labelW + '" y="' + (y + 6) + '" width="' + w + '" height="18" rx="9" fill="' + color + '"/>';
      svg += '<text x="' + (680 - valW + 8) + '" y="' + (y + 20) + '" font-size="13" font-weight="700" fill="#1f2733">' + esc(it.value) + unit + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  // 竖向条形图
  function vBars(items, opts) {
    opts = opts || {};
    var unit = opts.unit || '';
    var W = 680, H = 260, base = H - 40, pad = 20;
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
      svg += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="5" fill="' + color + '"/>';
      svg += '<text x="' + (x + bw / 2) + '" y="' + (y - 6) + '" font-size="12" font-weight="700" text-anchor="middle" fill="#1f2733">' + esc(it.value) + unit + '</text>';
      svg += '<text x="' + (x + bw / 2) + '" y="' + (base + 16) + '" font-size="12" text-anchor="middle" fill="#8a94a6">' + esc(it.label) + '</text>';
    });
    svg += '</svg>';
    return svg;
  }

  // 环形进度
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

  window.chartHelpers = { hBars: hBars, vBars: vBars, donut: donut, PALETTE: PALETTE };
})();
