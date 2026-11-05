'use strict';
// WPS 连接诊断脚本：打印每个已配置链接的 file_id、工作表名、真实表头与样例数据。
// 用法（本机用受管 Node 运行）：
//   node scripts/diagnose-wps.js
// 前提：已在 config/wps.json 的 wpsGlobal 中填入 appId/appKey（或 accessToken）。

const path = require('path');
const ROOT = path.join(__dirname, '..');
const cfg = require(path.join(ROOT, 'config', 'wps.json'));
const fetcher = require(path.join(ROOT, 'src', 'wpsFetcher'));

(async function () {
  const g = cfg.wpsGlobal || {};
  if ((!g.appId || !g.appKey) && !g.accessToken) {
    console.log('✗ 尚未配置 WPS 凭证。请在 config/wps.json 的 wpsGlobal 填写 appId + appKey（或 accessToken）。');
    console.log('  获取方式：登录 https://open.wps.cn → 创建应用 → 复制应用ID/应用密钥。');
    process.exit(0);
  }
  console.log('WPS 凭证：' + (g.accessToken ? '使用 accessToken' : 'appId=' + g.appId));
  console.log('==================================================');
  for (const key of Object.keys(cfg.modules)) {
    const m = cfg.modules[key];
    if ((m.source || '').toLowerCase() !== 'wps' || !m.wps || !m.wps.url) {
      console.log('· ' + key + '（' + m.label + '）：未配置 wps.url，跳过');
      continue;
    }
    try {
      const info = await fetcher.diagnoseModule(key, m, g);
      console.log('\n■ ' + key + '（' + m.label + '）');
      console.log('  链接: ' + m.wps.url);
      console.log('  file_id: ' + info.fileId);
      console.log('  工作表: ' + JSON.stringify(info.sheets));
      console.log('  真实表头(' + info.headers.length + '): ' + JSON.stringify(info.headers));
      console.log('  样例行(前3):');
      (info.sampleRows || []).forEach(function (r, i) {
        console.log('    [' + (i + 1) + '] ' + JSON.stringify(r));
      });
      // 提示未匹配到的规范字段
      const fm = m.wps.fieldMap || {};
      const miss = Object.keys(fm).filter(function (k) { return info.headers.indexOf(fm[k]) < 0 && !info.headers.some(function (h) { return h.toLowerCase().replace(/\s/g, '').indexOf(String(fm[k]).toLowerCase().replace(/\s/g, '')) >= 0; }); });
      if (miss.length) console.log('  ⚠ 未匹配规范字段: ' + JSON.stringify(miss) + '（请核对 fieldMap）');
    } catch (e) {
      console.log('\n■ ' + key + '（' + m.label + '）✗ 失败：' + e.message);
    }
  }
  console.log('\n==================================================');
  console.log('诊断完成。根据“真实表头”调整 config/wps.json 中各模块的 fieldMap（规范字段:真实表头），保存后网站刷新即可生效。');
})();
