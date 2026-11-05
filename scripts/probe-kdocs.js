'use strict';
// 金山文档（kdocs）公开链接可读性探测
// 用法: node scripts/probe-kdocs.js [分享链接或 sid]
// 目的: 判断"免登录"状态下能否拿到文件内容（为自动同步做准备）
// 零依赖，仅用 node 内置 https

const https = require('https');
const { URL } = require('url');

const DEFAULT_SID = 'cpiiUJCyssoS';

function request(url, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ error: 'bad url' }); }
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept': '*/*'
      }, opts.headers || {}),
      timeout: opts.timeout || 15000
    }, (res) => {
      let body = '';
      res.on('data', (c) => { if (body.length < 4000) body += c.toString('utf8'); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', (e) => resolve({ error: e.message }));
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

function brief(s, n) {
  s = String(s || '').replace(/\s+/g, ' ');
  return s.length > (n || 180) ? s.slice(0, n || 180) + '…' : s;
}

async function main() {
  let arg = process.argv[2] || DEFAULT_SID;
  let sid = arg;
  const m = arg.match(/kdocs\.cn\/l\/([A-Za-z0-9_-]+)/);
  if (m) sid = m[1];

  console.log('探测 sid =', sid);
  console.log('='.repeat(70));

  // 1) 分享页是否还要求登录
  const page = await request('https://www.kdocs.cn/l/' + sid);
  const authStatus = page.headers && (page.headers['x-kso-auth-status'] || '-');
  console.log('[1] 分享页      status=' + (page.status || page.error) + '  auth=' + authStatus +
    (page.headers && page.headers.location ? '  -> ' + brief(page.headers.location, 90) : ''));

  // 2) 元数据（通常免登可用）
  const meta = await request('https://drive.kdocs.cn/api/v5/links/' + sid);
  let fid = null;
  if (meta.status === 200 && meta.body) {
    try {
      const j = JSON.parse(meta.body);
      fid = j.fileinfo && j.fileinfo.id;
      console.log('[2] 元数据      status=200  fname=' + (j.fileinfo && j.fileinfo.fname) +
        '  fsize=' + (j.fileinfo && j.fileinfo.fsize) + '  fid=' + fid);
    } catch (e) { console.log('[2] 元数据      status=200  (解析失败)'); }
  } else {
    console.log('[2] 元数据      status=' + (meta.status || meta.error));
  }

  if (!fid) fid = '569815449750';

  // 3) 内容类接口逐个试
  const targets = [
    ['文件下载(www)',      'https://www.kdocs.cn/api/v3/office/file/' + fid + '/download'],
    ['文件下载(drive)',    'https://drive.kdocs.cn/api/v3/office/file/' + fid + '/download'],
    ['导出CSV',           'https://www.kdocs.cn/api/v3/office/file/' + fid + '/export?type=csv'],
    ['导出xlsx',           'https://www.kdocs.cn/api/v3/office/file/' + fid + '/export?type=xlsx'],
    ['文件信息',           'https://www.kdocs.cn/api/v3/office/file/' + fid],
    ['工作表列表',          'https://www.kdocs.cn/api/v3/office/sheet/' + fid + '/worksheets'],
    ['分享链下载(v5)',      'https://drive.kdocs.cn/api/v5/links/' + sid + '/download']
  ];

  let i = 3;
  let anyOk = false;
  for (const [name, url] of targets) {
    const r = await request(url);
    const code = r.status || r.error;
    const ct = (r.headers && r.headers['content-type']) || '';
    const isContent = /json|text|html/i.test(ct) ? brief(r.body, 120) : '(二进制 ' + ct + ')';
    if (r.status === 200 && !/userNotLogin|PermissionDenied/.test(r.body || '')) anyOk = true;
    console.log('[' + (i++) + '] ' + name.padEnd(12) + ' status=' + code + '  ' + isContent);
  }

  console.log('='.repeat(70));
  if (anyOk) {
    console.log('结论: 存在免登录可读的接口 ✅  可以据此做自动同步');
  } else {
    console.log('结论: 仍然全部需要登录 ❌  需把分享权限改为「获得链接的人可查看（无需登录）」后重试');
  }
}

main();
