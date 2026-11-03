# 第一分公司数据中台 —— CloudBase 云托管镜像
# 纯 Node，零依赖；云托管在边缘提供可信 HTTPS，容器内只需跑 HTTP
FROM node:20-alpine

WORKDIR /app

# 仅复制运行所需文件（零依赖，无需 npm install）
COPY package.json ./
COPY server.js ./
COPY config ./config
COPY src ./src
COPY public ./public
COPY data ./data

# 云托管会注入 PORT 环境变量；默认 80 便于本地测试
ENV PORT=80
EXPOSE 80

# 启动：读取 process.env.PORT，无证书时自动走 HTTP
CMD ["node", "server.js"]
