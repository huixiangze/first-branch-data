# first-branch-data

第一分公司数据云台 —— 电商主播结算数据的中台看板（Node 单端口 + 零依赖前端）。

## 本地配置（不入库）

`config/` 下三个文件含敏感信息，已被 `.gitignore` 排除，需自行准备：

| 文件 | 用途 | 说明 |
|---|---|---|
| `config/users.json` | 登录账号 | 复制 `config/users.example.json` 后填入；`password` 明文比对，`sessionSecret` 用于签发令牌 |
| `config/wps.json` | 金山文档登录态 | 同步助手首次登录后自动生成，含 kdocs cookie，勿外传 |
| `config/cloud.json` | 云库连接 | 云端部署时用于读写数据模块 |

## 运行

```bash
node server.js            # 本地默认 8088
PORT=3000 node server.js  # 云托管（监听 PORT，绑定 0.0.0.0）
```

## 数据同步

`scripts/pull-kdocs.js` 拉取金山文档 → `data/inbox/` → `scripts/import_workbook.py` 解析 →
`data/imports/bundle.json` → `scripts/push_bundle.js` 写入云库。
Windows 下双击 `立即同步一次.bat`（Python 侧已强制 UTF-8，避免中文文件名乱码）。
