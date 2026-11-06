'use strict';
// 第一分公司数据中台 —— 账号与权限
//
// 账号唯一真源：云数据库 module=`__users`（容器重启不丢）。
// 首次启动时用配置里的种子账号初始化；无云库时退回 config/users.json（本地开发）。
// 密码用 scrypt 加盐哈希存储，兼容旧的明文 / 纯 sha256 配置。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cloudDb = require('./cloudDb');

const ROOT = path.join(__dirname, '..');
const USERS_FILE = path.join(ROOT, 'config', 'users.json');
const CLOUD_MODULE = '__users';
const ROLES = ['管理员', '成员'];

let list = [];          // 内存账号表（含密码哈希，绝不外发）
let mode = 'readonly';  // cloud | file | readonly
let loaded = false;

// ---------- 密码 ----------
function scryptHash(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString('hex');
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + scryptHash(pw, salt);
}
function isHashed(s) {
  return typeof s === 'string' && (s.indexOf('scrypt$') === 0 || s.indexOf('sha256$') === 0);
}
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}
// 把配置里的原始密码转成可存储形态
function toStored(pw) {
  if (isHashed(pw)) return pw;
  return hashPassword(pw);
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const s = String(stored);
  if (s.indexOf('scrypt$') === 0) {
    const p = s.split('$');
    if (p.length < 3) return false;
    try {
      const calc = Buffer.from(scryptHash(pw, p[1]), 'hex');
      const want = Buffer.from(p[2], 'hex');
      if (calc.length !== want.length) return false;
      return crypto.timingSafeEqual(calc, want);
    } catch (e) { return false; }
  }
  if (s.indexOf('sha256$') === 0) return sha256(pw) === s.slice(7);
  // 兼容最初版本：配置里直接是明文
  return s === String(pw);
}

// ---------- 配置 ----------
function loadBaseConfig() {
  const inline = process.env.DP_USERS_JSON;
  if (inline && inline.trim()) {
    try {
      const j = JSON.parse(inline);
      j.__source = 'DP_USERS_JSON';
      return j;
    } catch (e) {
      console.error('[accounts] 环境变量 DP_USERS_JSON 不是合法 JSON：' + e.message);
    }
  }
  const u = process.env.DP_ADMIN_USER;
  const p = process.env.DP_ADMIN_PASS;
  if (u && p) {
    return {
      __source: 'DP_ADMIN_USER',
      users: [{
        username: u,
        password: p,
        name: process.env.DP_ADMIN_NAME || u,
        role: process.env.DP_ADMIN_ROLE || '管理员'
      }],
      sessionSecret: process.env.DP_SESSION_SECRET || '',
      sessionHours: Number(process.env.DP_SESSION_HOURS || 12)
    };
  }
  try {
    const j = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    j.__source = 'config/users.json';
    return j;
  } catch (e) {
    return null;
  }
}

// ---------- 归一化 ----------
function normUsername(v) { return String(v == null ? '' : v).trim().toLowerCase(); }

function normalizeSeed(u, isFirst) {
  return {
    username: normUsername(u.username),
    name: String(u.name || u.username || '').trim(),
    role: ROLES.indexOf(u.role) >= 0 ? u.role : (isFirst ? '管理员' : '成员'),
    // 配置里的账号就是平台管理员（首账号强制）
    isAdmin: isFirst ? true : (u.isAdmin === true || u.role === '管理员'),
    status: 'active',
    password: toStored(u.password),
    createdAt: u.createdAt || new Date().toISOString(),
    createdBy: u.createdBy || '系统初始化',
    lastLoginAt: u.lastLoginAt || null,
    builtin: true
  };
}

function normalizeStored(u) {
  const username = normUsername(u.username);
  return {
    username: username,
    name: String(u.name || username).trim(),
    role: ROLES.indexOf(u.role) >= 0 ? u.role : (u.isAdmin ? '管理员' : '成员'),
    isAdmin: u.isAdmin === true || u.role === '管理员',
    status: u.status === 'disabled' ? 'disabled' : 'active',
    password: toStored(u.password),
    createdAt: u.createdAt || new Date().toISOString(),
    createdBy: u.createdBy || '',
    lastLoginAt: u.lastLoginAt || null,
    builtin: u.builtin === true
  };
}

function seedsFromBase(base) {
  const arr = (base && Array.isArray(base.users)) ? base.users : [];
  return arr.map(function (u, i) { return normalizeSeed(u, i === 0); })
    .filter(function (u) { return !!u.username; });
}

// ---------- 持久化 ----------
async function persist() {
  const clean = list.map(function (u) { return Object.assign({}, u); });
  if (mode === 'cloud') {
    await cloudDb.upsertModule(CLOUD_MODULE, { users: clean, updatedAt: new Date().toISOString() });
    return;
  }
  if (mode === 'file') {
    const base = loadBaseConfig() || {};
    const out = {
      users: clean,
      sessionSecret: base.sessionSecret || process.env.DP_SESSION_SECRET || '',
      sessionHours: Number(base.sessionHours || 12)
    };
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(out, null, 2), 'utf8');
    return;
  }
  throw new Error('当前部署没有可持久化的存储（云数据库未连接），新增或修改账号无法保存');
}

async function init() {
  const base = loadBaseConfig();
  const seeds = seedsFromBase(base);
  const baseSource = (base && base.__source) || '无配置文件';

  if (cloudDb.isEnabled()) {
    try {
      const p = await cloudDb.getModule(CLOUD_MODULE);
      if (p && Array.isArray(p.users) && p.users.length) {
        list = p.users.map(normalizeStored);
        mode = 'cloud';
      } else {
        list = seeds;
        mode = 'cloud';
        await persist();   // 首次：把配置里的账号写入云库作为初始账号
      }
      loaded = true;
      console.log('[accounts] 账号来源：云数据库（' + list.length + ' 个账号）');
      return;
    } catch (e) {
      console.error('[accounts] 云库读取失败，回退本地：' + e.message);
    }
  }

  list = seeds;
  if (fs.existsSync(USERS_FILE)) {
    mode = 'file';
    console.log('[accounts] 账号来源：config/users.json（' + list.length + ' 个账号）');
  } else {
    mode = 'readonly';
    console.log('[accounts] 账号来源：' + baseSource + '（只读，新增账号将失败）');
  }
  loaded = true;
}

function isReady() { return loaded; }
function storageMode() { return mode; }

// ---------- 查询 ----------
function find(username) {
  const u = normUsername(username);
  return list.find(function (x) { return x.username === u; }) || null;
}
function isAdmin(user) {
  if (!user) return false;
  return user.isAdmin === true || user.role === '管理员';
}
function publicView(u) {
  return {
    username: u.username,
    name: u.name,
    role: u.role,
    isAdmin: isAdmin(u),
    status: u.status,
    createdAt: u.createdAt,
    createdBy: u.createdBy,
    lastLoginAt: u.lastLoginAt,
    builtin: u.builtin === true
  };
}
function all() {
  return list.slice().sort(function (a, b) {
    if (isAdmin(a) !== isAdmin(b)) return isAdmin(a) ? -1 : 1;
    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}
function stats() {
  const active = list.filter(function (u) { return u.status === 'active'; }).length;
  const admins = list.filter(function (u) { return isAdmin(u) && u.status === 'active'; }).length;
  return { total: list.length, active: active, admins: admins };
}

// ---------- 登录 ----------
function verify(username, password) {
  const u = find(username);
  if (!u) return null;
  if (u.status !== 'active') return { error: '该账号已被停用，请联系平台管理员' };
  if (!checkPassword(password, u.password)) return null;
  return { user: u };
}
function markLogin(username) {
  const u = find(username);
  if (!u) return;
  u.lastLoginAt = new Date().toISOString();
  persist().catch(function (e) { console.error('[accounts] 记录登录时间失败：' + e.message); });
}

// ---------- 校验 ----------
function validateUsername(v) {
  const s = normUsername(v);
  if (!/^[a-z0-9_.-]{3,24}$/.test(s)) return '账号需为 3-24 位小写字母、数字、下划线、点或横线';
  return null;
}
function validatePassword(v) {
  if (typeof v !== 'string' || v.length < 6) return '密码至少 6 位';
  if (v.length > 64) return '密码不能超过 64 位';
  return null;
}

// ---------- 写操作 ----------
async function create(actor, input) {
  if (mode === 'readonly') throw new Error('当前部署没有可持久化的存储，无法新增账号');
  const username = normUsername(input.username);
  const eU = validateUsername(username);
  if (eU) throw new Error(eU);
  const eP = validatePassword(input.password);
  if (eP) throw new Error(eP);
  if (find(username)) throw new Error('账号「' + username + '」已存在');

  const role = ROLES.indexOf(input.role) >= 0 ? input.role : '成员';
  const u = {
    username: username,
    name: String(input.name || username).trim().slice(0, 24) || username,
    role: role,
    isAdmin: role === '管理员',
    status: 'active',
    password: hashPassword(input.password),
    createdAt: new Date().toISOString(),
    createdBy: (actor && actor.username) || '',
    lastLoginAt: null,
    builtin: false
  };
  list.push(u);
  try {
    await persist();
  } catch (e) {
    list = list.filter(function (x) { return x !== u; });
    throw e;
  }
  return publicView(u);
}

async function update(actor, input) {
  const u = find(input.username);
  if (!u) throw new Error('账号不存在');
  const before = Object.assign({}, u);
  const isSelf = actor && actor.username === u.username;

  if (typeof input.name === 'string' && input.name.trim()) u.name = input.name.trim().slice(0, 24);

  if (input.role && ROLES.indexOf(input.role) >= 0) {
    if (u.builtin && input.role !== '管理员') throw new Error('内置管理员账号不能被降级');
    u.role = input.role;
    u.isAdmin = input.role === '管理员';
  }

  if (input.status === 'active' || input.status === 'disabled') {
    if (input.status === 'disabled') {
      if (u.builtin) throw new Error('内置管理员账号不能被停用');
      if (isSelf) throw new Error('不能停用自己的账号');
      if (isAdmin(u) && stats().admins <= 1) throw new Error('至少要保留一个可用管理员');
    }
    u.status = input.status;
  }

  if (typeof input.password === 'string' && input.password) {
    const eP = validatePassword(input.password);
    if (eP) throw new Error(eP);
    u.password = hashPassword(input.password);
  }

  try {
    await persist();
  } catch (e) {
    Object.assign(u, before);
    throw e;
  }
  return publicView(u);
}

async function remove(actor, username) {
  const u = find(username);
  if (!u) throw new Error('账号不存在');
  if (u.builtin) throw new Error('内置管理员账号不能被删除');
  if (actor && actor.username === u.username) throw new Error('不能删除自己的账号');
  if (isAdmin(u) && stats().admins <= 1) throw new Error('至少要保留一个可用管理员');
  const idx = list.indexOf(u);
  list.splice(idx, 1);
  try {
    await persist();
  } catch (e) {
    list.splice(idx, 0, u);
    throw e;
  }
  return true;
}

async function changeOwnPassword(actor, oldPassword, newPassword) {
  const u = find(actor && actor.username);
  if (!u) throw new Error('账号不存在');
  if (!checkPassword(oldPassword, u.password)) throw new Error('原密码不正确');
  const eP = validatePassword(newPassword);
  if (eP) throw new Error(eP);
  const before = u.password;
  u.password = hashPassword(newPassword);
  try {
    await persist();
  } catch (e) {
    u.password = before;
    throw e;
  }
  return true;
}

function roles() { return ROLES.slice(); }

module.exports = {
  init: init,
  isReady: isReady,
  storageMode: storageMode,
  loadBaseConfig: loadBaseConfig,
  find: find,
  all: all,
  stats: stats,
  isAdmin: isAdmin,
  publicView: publicView,
  verify: verify,
  markLogin: markLogin,
  create: create,
  update: update,
  remove: remove,
  changeOwnPassword: changeOwnPassword,
  roles: roles,
  ROLES: ROLES
};
