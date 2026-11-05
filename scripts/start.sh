#!/usr/bin/env bash
# 第一分公司数据中台 —— Linux 服务器启动脚本（无 pm2 / npm 依赖）
# 用法：
#   chmod +x start.sh
#   ./start.sh            # 后台启动，日志写到 logs/ 目录
#   ./start.sh stop       # 停止
#   ./start.sh restart    # 重启
#   ./start.sh status     # 查看状态

set -e
cd "$(dirname "$0")/.."

PORT="${PORT:-8090}"
NODE_BIN="${NODE_BIN:-node}"
APP="server.js"
PID_FILE="logs/app.pid"
LOG_DIR="logs"
mkdir -p "$LOG_DIR"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

case "${1:-start}" in
  start)
    if is_running; then echo "已在运行 (pid $(cat "$PID_FILE"))"; exit 0; fi
    PORT="$PORT" nohup "$NODE_BIN" "$APP" > "$LOG_DIR/app.out" 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    if is_running; then echo "已启动 pid=$(cat "$PID_FILE")，端口 $PORT，日志：$LOG_DIR/app.out"; else echo "启动失败，查看 $LOG_DIR/app.out"; exit 1; fi
    ;;
  stop)
    if is_running; then kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE" && echo "已停止"; else echo "未运行"; fi
    ;;
  restart)
    "$0" stop || true
    sleep 1
    "$0" start
    ;;
  status)
    if is_running; then echo "运行中 (pid $(cat "$PID_FILE"))"; else echo "未运行"; fi
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status}"; exit 1 ;;
esac
