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
    { key: 'forecast', label: '业绩预估' },
    { key: 'anchorRank', label: '主播榜单' },
    { key: 'anchorPerformance', label: '主播业绩' },
    { key: 'rongpin', label: '预估结算' }
  ];

  var state = {
    user: null, data: null, current: 'home', lastUpdated: null, pollTimer: null,
    overrides: {},          // moduleKey -> { rows:[...] }  (导入覆盖)
    sort: {},               // moduleKey -> { key, dir }
    pin: {},                // moduleKey -> { rowKey:true }
    month: {},              // moduleKey -> '全部'|'10月'|'11月'
    search: {},             // moduleKey -> string
    lastTable: {},          // moduleKey -> { columns, rows, name }
    importModule: null,
    _focus: null
  };

  // ---------- 工具 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function statusTag(s) {
    var map = { '已完成': 'green', '未达标': 'red', '领先': 'green', '正常': 'blue', '预警': 'orange', '落后': 'red', '是': 'blue', '否': 'gray' };
    return '<span class="tag ' + (map[s] || 'gray') + '">' + esc(s) + '</span>';
  }
  function trendCls(t) { return t === 'up' ? 'green' : t === 'down' ? 'red' : 'gray'; }
  function trendArrow(t) { return t === 'up' ? '▲' : t === 'down' ? '▼' : '■'; }

  // ---------- CSV 导出 / 导入 ----------
  function toCSV(columns, rows) {
    function cell(v) {
      v = (v == null ? '' : String(v));
      if (/[",\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }
    var lines = [columns.map(function (c) { return cell(c.label); }).join(',')];
    rows.forEach(function (r) {
      lines.push(columns.map(function (c) { return cell(r[c.key]); }).join(','));
    });
    return '﻿' + lines.join('\r\n'); // UTF-8 BOM：Excel 中文不乱码
  }
  function downloadCSV(columns, rows, filename) {
    var blob = new Blob([toCSV(columns, rows)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }
  function parseCSV(text) {
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { inQ = false; } }
        else field += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else if (ch === '\r') { /* skip */ }
        else field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ---------- 图表导出 PNG ----------
  function exportSVGToPNG(svgEl, filename) {
    var xml = new XMLSerializer().serializeToString(svgEl);
    var svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(svgBlob);
    var img = new Image();
    img.onload = function () {
      var vb = svgEl.viewBox && svgEl.viewBox.baseVal;
      var w = vb && vb.width ? vb.width : 680;
      var h = vb && vb.height ? vb.height : 300;
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (b) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 1000);
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.onerror = function () { alert('图表导出失败'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  // ---------- 排序 / 行键 ----------
  function rowKey(mod, r) {
    return mod + '|' + (r.anchor || r.name || r.date || JSON.stringify(r));
  }
  function sortRows(rows, key, dir, cols) {
    var col = null;
    for (var i = 0; i < cols.length; i++) if (cols[i].key === key) col = cols[i];
    var numeric = col && (col.cls === 'mono' || col.numeric);
    var arr = rows.slice();
    arr.sort(function (a, b) {
      var x = a[key], y = b[key];
      if (numeric) { x = parseFloat(x) || 0; y = parseFloat(y) || 0; return dir === 'asc' ? x - y : y - x; }
      x = String(x == null ? '' : x); y = String(y == null ? '' : y);
      return dir === 'asc' ? x.localeCompare(y, 'zh') : y.localeCompare(x, 'zh');
    });
    return arr;
  }
  // 月份筛选：仅过滤带 .month 字段的项
  function filterMonth(items, mod) {
    var mm = state.month[mod] || '全部';
    if (mm === '全部') return items;
    return items.filter(function (it) { return !it.month || it.month === mm; });
  }

  // ---------- KPI / 图表面板 ----------
  function kpiRow(kpis) {
    var colors = ['#ff7aa8', '#7a5cff', '#2f6fed', '#2bbf7a', '#ff8c3b'];
    return '<div class="kpi-row">' + (kpis || []).map(function (k, i) {
      var c = colors[i % colors.length];
      return '<div class="kpi-card">' +
        '<div class="kpi-icon" style="background:' + c + '">' + (ICONS[k.title] ? icon(k.title) : icon('home')) + '</div>' +
        '<div class="kpi-body"><div class="k-title">' + esc(k.title) + '</div>' +
        '<div class="k-val">' + esc(k.value) + '<span class="unit">' + esc(k.unit || '') + '</span></div>' +
        '<div class="k-sub"><span class="tag ' + trendCls(k.trend) + '">' + trendArrow(k.trend) + '</span> ' + esc(k.sub || '') + '</div>' +
        '</div></div>';
    }).join('') + '</div>';
  }
  function chartPanel(title, sub, svg) {
    return '<div class="panel chart-panel"><div class="panel-head"><div class="ph-title">' + esc(title) + '</div>' +
      '<div class="ph-tools"><button class="tbtn" data-role="img">图片</button></div></div>' +
      (sub ? '<div class="ph-sub">' + esc(sub) + '</div>' : '') + (svg || '') + '</div>';
  }
  function monthBar(mod) {
    var mm = state.month[mod] || '全部';
    return '<div class="tbl-tools"><span class="tlabel">月份：</span><select class="tselect" data-role="month" data-mod="' + mod + '">' +
      ['全部', '10月', '11月'].map(function (m) { return '<option' + (mm === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') +
      '</select><span class="tcount">选择月份可筛选对应周期数据</span></div>';
  }

  // ---------- 通用数据表（含工具条：导出/导入/月份/搜索/排序/置顶）----------
  function dataTable(moduleKey, columns, rows, opts) {
    opts = opts || {};
    var base = (state.overrides[moduleKey] && state.overrides[moduleKey].rows) ? state.overrides[moduleKey].rows : rows;
    var mm = state.month[moduleKey] || '全部';
    var filtered = base.filter(function (r) { return mm === '全部' || !r.month || r.month === mm; });
    var q = (state.search[moduleKey] || '').trim().toLowerCase();
    if (q) filtered = filtered.filter(function (r) {
      return columns.some(function (c) { return String(r[c.key] == null ? '' : r[c.key]).toLowerCase().indexOf(q) >= 0; });
    });
    var sk = state.sort[moduleKey];
    if (sk) filtered = sortRows(filtered, sk.key, sk.dir, columns);
    var pinSet = state.pin[moduleKey] || {};
    var pinned = [], rest = [];
    filtered.forEach(function (r) { if (pinSet[rowKey(moduleKey, r)]) pinned.push(r); else rest.push(r); });
    filtered = pinned.concat(rest);

    state.lastTable[moduleKey] = { columns: columns, rows: filtered, name: opts.exportName || moduleKey };

    // 工具条
    var tools = '<div class="tbl-tools">';
    if (opts.exportName) tools += '<button class="tbtn primary" data-role="export" data-mod="' + moduleKey + '">导出Excel</button>';
    if (opts.month) tools += '<span class="tlabel">月份：</span><select class="tselect" data-role="month" data-mod="' + moduleKey + '">' +
      ['全部', '10月', '11月'].map(function (m) { return '<option' + (mm === m ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select>';
    tools += '<span class="tlabel">搜索：</span><input class="tinput" data-role="search" data-mod="' + moduleKey + '" value="' + esc(state.search[moduleKey] || '') + '" placeholder="搜索..."/>';
    if (Object.keys(pinSet).length) tools += '<button class="tbtn ghost" data-role="unpin" data-mod="' + moduleKey + '">取消置顶</button>';
    tools += '<span class="tcount">共 ' + filtered.length + ' 条</span>';
    tools += '</div>';

    // 表头
    var head = '<tr>' + columns.map(function (c) {
      var ind = (sk && sk.key === c.key) ? (sk.dir === 'asc' ? ' ▲' : ' ▼') : '';
      var cls = c.sortable === false ? '' : ' class="sortable" data-col="' + c.key + '"';
      return '<th' + cls + '>' + esc(c.label) + ind + '</th>';
    }).join('') + '</tr>';
    var body = filtered.map(function (r) {
      var pinned = pinSet[rowKey(moduleKey, r)] ? ' pinned' : '';
      return '<tr class="drow' + pinned + '">' + columns.map(function (c) {
        var v = r[c.key];
        if (c.tag === 'status') return '<td>' + statusTag(v) + '</td>';
        if (c.cls) return '<td class="' + c.cls + '">' + esc(v) + '</td>';
        return '<td>' + esc(v) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return tools + '<div class="tbl-wrap"><table class="tbl" data-mod="' + moduleKey + '"><thead>' + head + '</thead><tbody>' +
      (body || '<tr><td colspan="' + columns.length + '" class="empty">暂无数据</td></tr>') + '</tbody></table></div>';
  }

  // ---------- 通用：真实数据全列展示（兜底，保证无论列名是否匹配都能看见数据）----------
  function sourceLabel(src) {
    if (src === 'cloud') return '数据来源：云数据库（实时同步）';
    if (src === 'wps') return '数据来源：WPS 实时（直连）';
    if (src === 'csv') return '数据来源：WPS 导出文件（手动更新）';
    return '数据来源：示例数据';
  }
  function genericTable(moduleKey, rawHeaders, rawRows, opts) {
    opts = opts || {};
    if (!rawHeaders || !rawHeaders.length) return '';
    var cols = rawHeaders.map(function (h) { return { key: h, label: h }; });
    var rows = (rawRows || []).map(function (r) {
      var o = {}; rawHeaders.forEach(function (h) { o[h] = (r[h] == null ? '' : r[h]); }); return o;
    });
    return '<div class="panel"><div class="panel-head"><div class="ph-title">' + esc(opts.title || '真实数据（来自 WPS 导出）') + '</div>' +
      '<div class="ph-sub">共 ' + rows.length + ' 行 · 点击表头排序、点击行可置顶、上方搜索可筛选</div></div>' +
      dataTable(moduleKey + '_raw', cols, rows, { exportName: (opts.exportName || moduleKey) + '_真实' }) + '</div>';
  }
  // 模块内容容器：有真实原始数据优先展示真实全列表；否则展示结构化看板（示例或已命中字段映射）
  function moduleBody(key, m, structuredHtml) {
    var html = '';
    if (m.kpis && m.kpis.length) html += kpiRow(m.kpis);
    if (m.rawHeaders && m.rawHeaders.length) {
      html += genericTable(key, m.rawHeaders, m.rawRows, { title: (m.title || '真实数据'), exportName: key });
    } else {
      html += structuredHtml;
    }
    html += uploadBtn(key);
    return html;
  }
  function uploadBtn(key) {
    return '<div style="margin-top:12px"><button class="tbtn" data-role="upload" data-mod="' + key + '">⬆ 上传该模块数据(CSV)</button>' +
      '<span class="tcount" style="margin-left:10px">将 WPS 表格「导出为 CSV」后上传，立即生效（无需重新部署）</span></div>';
  }

  // ---------- 各模块视图 ----------
  var VIEWS = {
    home: function (d) {
      var h = d.home || {};
      var html = '<div class="view-title">首页</div><div class="view-sub">核心经营总览 · 数据来源：WPS共享表格（示例）</div>';
      html += kpiRow(h.kpis);
      html += '<div class="grid-2">';
      var an = h.anomaly || {};
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">异常数据追踪</div><div class="ph-sub">更新于 ' + esc(an.updated || '-') + '</div></div>';
      html += '<div class="empty">' + esc(an.note || '暂无记录') + '</div>';
      if (an.bars && an.bars.length) html += chartPanel('日进度差异分布', '', window.chartHelpers.hBars(an.bars.map(function (b) { return { label: b.label, value: b.value, color: b.color }; }), { unit: ' 条' }));
      html += '</div>';
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
      var html = '<div class="view-title">主播榜单</div><div class="view-sub">主播销售明细 · ' + sourceLabel(m.source) + ' · 点击表头排序、点击行可置顶</div>';
      var cols = [
        { key: 'anchor', label: '主播' }, { key: 'org', label: '所属机构' }, { key: 'category', label: '品类' },
        { key: 'gmv', label: '下播GMV累计(万)', cls: 'mono' }, { key: 'avg', label: '场均销售额(万)', cls: 'mono' },
        { key: 'target', label: '月销售目标(万)', cls: 'mono' }, { key: 'rate', label: '月目标完成度(%)', cls: 'mono' },
        { key: 'aov', label: '客单价', cls: 'mono' }, { key: 'rank', label: '完成排名', cls: 'mono' }
      ];
      var structured = '<div class="panel"><div class="panel-head"><div class="ph-title">主播销售明细</div></div>' +
        dataTable('anchorRank', cols, m.rows || [], { exportName: '主播销售明细', month: true }) + '</div>';
      var top5 = filterMonth((m.rows || []).slice(0, 5), 'anchorRank').map(function (r) { return { label: r.anchor, value: r.gmv, color: '#2f6fed' }; });
      structured += chartPanel('GMV Top5 主播', '', window.chartHelpers.hBars(top5, { unit: ' 万' }));
      html += moduleBody('anchorRank', m, structured);
      return html;
    },

    anchorPerformance: function (d) {
      var m = d.anchorPerformance || {};
      var html = '<div class="view-title">主播业绩</div><div class="view-sub">主播业绩明细 · ' + sourceLabel(m.source) + '</div>';
      var structured = '';
      structured += '<div class="grid-3">';
      (m.categories || []).forEach(function (c) {
        structured += '<div class="panel" style="text-align:center"><div class="k-val">' + esc(c.count) + ' <span class="unit">人</span></div><div class="k-title" style="margin-top:6px">' + esc(c.name) + '</div><div style="margin-top:8px"><span class="tag ' + (c.tag || 'gray') + '">' + esc(c.amount) + '</span></div></div>';
      });
      structured += '</div>';
      var det = m.detail || {};
      var cols = [
        { key: 'date', label: '日期' }, { key: 'anchor', label: '主播' }, { key: 'est', label: '预估(万)', cls: 'mono' },
        { key: 'actual', label: '实际(万)', cls: 'mono' }, { key: 'diff', label: '差额(万)', cls: 'mono' },
        { key: 'diffRate', label: '差额率(%)', cls: 'mono' }, { key: 'status', label: '状态', tag: 'status' }, { key: 'tag', label: '是否打标' }
      ];
      structured += '<div class="panel"><div class="panel-head"><div class="ph-title">主播业绩明细</div><div class="ph-sub">' + (det.tabs ? det.tabs.join(' / ') : '') + '</div></div>';
      structured += dataTable('anchorPerformance', cols, det.rows || [], { exportName: '主播业绩明细', month: true });
      structured += '</div>';
      html += moduleBody('anchorPerformance', m, structured);
      return html;
    },

    productInsight: function (d) {
      var m = d.productInsight || {};
      var html = '<div class="view-title">商品洞察</div><div class="view-sub">TOP 商品预警 · 数据来源：WPS共享表格（示例） · 自动识别高关注商品</div>';
      html += monthBar('productInsight');
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
        var att = filterMonth(p.attention || [], 'productInsight');
        html += '<div style="margin-top:12px"><div class="ph-sub" style="margin-bottom:8px;font-weight:600">高关注商品</div>' +
          dataTable('productInsight_' + p.badge, acols, att, { exportName: p.name + '_高关注商品' }) + '</div>';
        html += '</div>';
      });
      return html;
    },

    productData: function (d) {
      var m = d.productData || {};
      var html = '<div class="view-title">商品数据</div><div class="view-sub">商品全景分析 · 数据来源：WPS共享表格（示例） · 更新于 ' + esc(m.updated || '-') + '</div>';
      html += monthBar('productData');
      html += kpiRow(m.kpis);
      html += '<div class="grid-2b">';
      html += chartPanel('品类排行', '', window.chartHelpers.hBars(filterMonth(m.categoryRank || [], 'productData'), {}));
      html += chartPanel('TOP 品类 GMV(万)', '', window.chartHelpers.hBars(filterMonth(m.topGmv || [], 'productData'), { unit: ' 万' }));
      html += '</div>';
      html += '<div class="grid-2b">';
      html += chartPanel('热门搜索（近7天）', '', window.chartHelpers.hBars(filterMonth(m.hot || [], 'productData'), {}));
      html += chartPanel('上升新星（近7天）', '', window.chartHelpers.hBars(filterMonth(m.rising || [], 'productData'), {}));
      html += '</div>';
      return html;
    },

    productDept: function (d) {
      var m = d.productDept || {};
      var html = '<div class="view-title">商品部</div><div class="view-sub">品类收益率与选品池 · 数据来源：WPS共享表格（示例）</div>';
      html += monthBar('productDept');
      html += kpiRow(m.kpis);
      html += chartPanel('品类收益率对比', '绿色=收益率', window.chartHelpers.hBars(filterMonth((m.yieldByCategory || []).map(function (x) { return { label: x.category, value: x.yield, color: '#2bbf7a', month: x.month }; }), 'productDept'), { unit: '%' }));
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
      var html = '<div class="view-title">预估结算</div><div class="view-sub">预估结算明细（日更） · ' + sourceLabel(m.source) + ' · ' + esc(m.updated || '-') + '</div>';
      var structured = '';
      structured += '<div class="grid-2b">';
      structured += chartPanel('融品预估结算GMV对比(万)', '', window.chartHelpers.vBars(filterMonth(m.settlement || [], 'rongpin'), { unit: ' 万' }));
      structured += chartPanel('融品月目标完成度(%)', '', window.chartHelpers.vBars(filterMonth(m.completion || [], 'rongpin'), { unit: '%' }));
      structured += '</div>';
      var dcols = [
        { key: 'anchor', label: '主播昵称' }, { key: 'gmv', label: '直播间GMV(万)', cls: 'mono' },
        { key: 'commission', label: '预估佣金(万)', cls: 'mono' }, { key: 'dept', label: '部门' }, { key: 'growth', label: '环比增长(%)', cls: 'mono' }
      ];
      structured += '<div class="panel"><div class="panel-head"><div class="ph-title">分销播报（按商品）</div></div>' + dataTable('rongpin_dist', dcols, m.distribution || [], { exportName: '分销播报' }) + '</div>';
      html += moduleBody('rongpin', m, structured);
      return html;
    },

    deputy: function (d) {
      var m = d.deputy || {};
      var html = '<div class="view-title">副总业绩</div><div class="view-sub">各副总团队目标完成情况 · 数据来源：WPS共享表格（示例） · ' + esc(m.updated || '-') + '</div>';
      html += kpiRow(m.kpis);
      html += '<div class="grid-2b">';
      html += chartPanel('完成率对比(%)', '', window.chartHelpers.vBars(filterMonth(m.chart || [], 'deputy'), { unit: '%' }));
      var dcols = [
        { key: 'name', label: '姓名' }, { key: 'target', label: '目标(万)', cls: 'mono' },
        { key: 'done', label: '完成(万)', cls: 'mono' }, { key: 'rate', label: '完成率(%)', cls: 'mono' }, { key: 'status', label: '状态', tag: 'status' }
      ];
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">副总团队明细</div></div>' + dataTable('deputy_tbl', dcols, m.rows || [], { exportName: '副总团队明细' }) + '</div>';
      html += '</div>';
      return html;
    },

    preference: function (d) {
      var m = d.preference || {};
      var html = '<div class="view-title">商品喜好</div><div class="view-sub">用户商品偏好分析 · 数据来源：WPS共享表格（示例） · ' + esc(m.updated || '-') + '</div>';
      html += monthBar('preference');
      html += '<div class="grid-2b">';
      html += chartPanel('品类喜好度', '', window.chartHelpers.hBars(filterMonth((m.byCategory || []).map(function (x) { return { label: x.category, value: x.likes, color: '#ff7aa8', month: x.month }; }), 'preference'), {}));
      html += '<div class="panel"><div class="panel-head"><div class="ph-title">商品 TOP 喜好</div></div>' +
        (m.top || []).map(function (t, i) { return '<div class="list-item"><div class="li-name">' + (i + 1) + '. ' + esc(t.name) + '</div><span class="pill" style="color:#ff7aa8">' + esc(t.likes) + ' 票</span></div>'; }).join('') + '</div>';
      html += '</div>';
      return html;
    },

    forecast: function (d) {
      var m = d.forecast || {};
      var html = '<div class="view-title">业绩预估</div><div class="view-sub">月度业绩预估与置信度 · ' + sourceLabel(m.source) + ' · ' + esc(m.updated || '-') + '</div>';
      var s = m.summary || {};
      var structured = kpiRow([
        { title: '预估业绩', value: s.est != null ? s.est : '-', unit: '万', sub: '目标口径', trend: 'flat' },
        { title: '实际完成', value: s.actual != null ? s.actual : '-', unit: '万', sub: '已发生', trend: 'up' },
        { title: '预估置信度', value: s.confidence != null ? s.confidence : '-', unit: '%', sub: '模型置信', trend: 'flat' }
      ]);
      structured += chartPanel('月度业绩预估(万)', '', window.chartHelpers.vBars(filterMonth(m.months || [], 'forecast'), { unit: ' 万' }));
      var fcols = [
        { key: 'month', label: '月份' }, { key: 'est', label: '预估(万)', cls: 'mono' },
        { key: 'actual', label: '实际(万)', cls: 'mono' }, { key: 'confidence', label: '置信度(%)', cls: 'mono' }
      ];
      structured += '<div class="panel"><div class="panel-head"><div class="ph-title">预估明细</div></div>' + dataTable('forecast_tbl', fcols, filterMonth(m.months || [], 'forecast'), { exportName: '业绩预估明细', month: true }) + '</div>';
      html += moduleBody('forecast', m, structured);
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
    var upd = state.data && state.data.updatedAt ? new Date(state.data.updatedAt).toLocaleString('zh-CN') : '未知';
    html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span class="refresh-tip"><span class="dot"></span>数据每 20 分钟自动刷新 · 上次更新：' + upd + '</span><button class="btn-login" style="width:auto;padding:8px 16px" onclick="window.__refresh()">立即刷新</button></div>' + html;
    content.innerHTML = html;
    $('crumb').textContent = title;
    // 搜索框失焦后重新渲染时恢复焦点
    if (state._focus && state._focus.role === 'search') {
      var inp = content.querySelector('input[data-role="search"][data-mod="' + state._focus.mod + '"]');
      if (inp) { inp.focus(); var v = inp.value; inp.value = ''; inp.value = v; }
      state._focus = null;
    }
  }

  function switchModule(key) {
    state.current = key;
    renderNav();
    renderView();
  }

  window.__refresh = function () {
    fetch('/api/refresh', { method: 'POST' }).then(function (r) { return r.json(); }).then(function () { return fetchData(true); });
  };

  // ---------- 全局点击 / 变更 委托 ----------
  function attachContentHandlers() {
    var content = $('content');
    content.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-role]') : null;
      if (el) {
        var role = el.getAttribute('data-role');
        if (role === 'export') { handleExport(el.getAttribute('data-mod')); return; }
        if (role === 'unpin') { state.pin[el.getAttribute('data-mod')] = {}; renderView(); return; }
        if (role === 'img') { handleImgExport(el); return; }
        if (role === 'upload') { uploadCsv(el.getAttribute('data-mod')); return; }
      }
      // 表头排序
      var th = e.target.closest ? e.target.closest('th.sortable') : null;
      if (th) {
        var mod = (e.target.closest('table') || {}).getAttribute && (e.target.closest('table')).getAttribute('data-mod');
        var col = th.getAttribute('data-col');
        var cur = state.sort[mod];
        if (cur && cur.key === col) state.sort[mod] = { key: col, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
        else state.sort[mod] = { key: col, dir: 'asc' };
        renderView();
        return;
      }
      // 点击行置顶
      var tr = e.target.closest ? e.target.closest('tr.drow') : null;
      if (tr) {
        var tmod = (e.target.closest('table') || {}).getAttribute && (e.target.closest('table')).getAttribute('data-mod');
        var idx = parseInt(tr.getAttribute('data-idx'), 10);
        var rows = state.lastTable[tmod] ? state.lastTable[tmod].rows : [];
        var r = rows[idx];
        if (r) {
          var key = rowKey(tmod, r);
          state.pin[tmod] = state.pin[tmod] || {};
          if (state.pin[tmod][key]) delete state.pin[tmod][key]; else state.pin[tmod][key] = true;
          renderView();
        }
      }
    });
    content.addEventListener('change', function (e) {
      var sel = e.target.closest ? e.target.closest('select[data-role="month"]') : null;
      if (sel) { state.month[sel.getAttribute('data-mod')] = sel.value; state.sort = {}; renderView(); }
    });
    content.addEventListener('input', function (e) {
      var inp = e.target.closest ? e.target.closest('input[data-role="search"]') : null;
      if (inp) {
        var mod = inp.getAttribute('data-mod');
        state.search[mod] = inp.value;
        state._focus = { role: 'search', mod: mod };
        renderView();
      }
    });
  }

  function handleExport(mod) {
    var t = state.lastTable[mod];
    if (!t) { alert('当前页面暂无可导出的表格'); return; }
    downloadCSV(t.columns, t.rows, (t.name || mod) + '.csv');
  }
  function handleImgExport(btn) {
    var panel = btn.closest('.chart-panel') || btn.closest('.panel');
    var svg = panel ? panel.querySelector('svg.chart') : null;
    if (!svg) { alert('未找到图表'); return; }
    var title = panel.querySelector('.ph-title');
    exportSVGToPNG(svg, (title ? title.textContent : 'chart') + '.png');
  }
  function uploadCsv(key) {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.csv,text/csv,.xlsx';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var content = String(r.result);
        // 仅允许 CSV 文本（xlsx 需先另存为 CSV）
        if (f.name.toLowerCase().indexOf('.xlsx') >= 0) { alert('请先在 WPS 中将表格「导出为 CSV」再上传，xlsx 暂不支持直接上传'); return; }
        fetch('/api/upload-csv', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: key, content: content })
        }).then(function (x) { return x.json(); }).then(function (j) {
          if (j.ok) {
            if (j.cloud === false) { alert('本地已更新，但写入云库失败：' + (j.cloudError || '未知错误')); }
            else { alert('已写入云库（' + (j.rows || 0) + ' 行），全站实时可见'); }
            fetchData(true);
          }
          else { alert(j.error || '上传失败'); }
        }).catch(function () { alert('网络错误'); });
      };
      r.readAsText(f, 'utf-8');
    };
    inp.click();
  }

  // ---------- 数据 ----------
  function fetchData(force) {
    return fetch('/api/data?_t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
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
    // 恢复导入覆盖（localStorage 持久化）
    try { state.overrides = JSON.parse(localStorage.getItem('dp_overrides') || '{}'); } catch (e) { state.overrides = {}; }
    renderNav();
    fetchData(true);
    startPolling();
  }

  function logout() {
    fetch('/api/logout', { method: 'POST' }).then(function () { location.reload(); });
  }

  // ---------- 初始化 ----------
  function init() {
    try { state.overrides = JSON.parse(localStorage.getItem('dp_overrides') || '{}'); } catch (e) { state.overrides = {}; }
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
    // 数据由 WPS 共享表格直连读取，不再需要手动导入。
    attachContentHandlers();
    setInterval(tickClock, 1000); tickClock();

    fetch('/api/me?_t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.user) enterApp(j.user);
    }).catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
