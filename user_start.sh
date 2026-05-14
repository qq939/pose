#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR" || exit 1

mkdir -p logs

START_LOG="$PROJECT_DIR/logs/start.log"
RUN_LOG="$PROJECT_DIR/logs/run.log"
SETUP_STATUS_FILE="$PROJECT_DIR/logs/setup-status.json"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "$START_LOG"
}

write_setup_status() {
  local state="$1"
  local step="$2"
  local progress="$3"
  local message="$4"
  local updated_at
  updated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  cat > "$SETUP_STATUS_FILE" <<EOF
{"state":"$state","step":"$step","progress":$progress,"message":"$message","updatedAt":"$updated_at"}
EOF
}

log "========== 启动时间: $(date) =========="

if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
  log "安装 Node.js 依赖..."
  if ! npm install >> "$START_LOG" 2>&1; then
    log "Node.js 依赖安装失败"
    exit 1
  fi
fi

OLD_PIDS="$(pgrep -f "node server.js" 2>/dev/null || true)"
if [ -n "$OLD_PIDS" ]; then
  log "发现旧 node server.js 进程: ${OLD_PIDS}，正在停止..."
  kill -9 $OLD_PIDS 2>/dev/null || true
  sleep 1
fi

write_setup_status "installing" "boot" 1 "Web 服务启动中，Python 环境即将检查"

log "启动 8082 Web 服务..."
SETUP_STATUS_FILE="$SETUP_STATUS_FILE" HOST="${HOST:-0.0.0.0}" PORT="${PORT:-8082}" nohup node server.js >> "$RUN_LOG" 2>&1 &
SERVER_PID=$!

for i in {1..20}; do
  if curl -s "http://localhost:${PORT:-8082}/api/status" > /dev/null 2>&1; then
    log "Web 服务启动成功，PID: $SERVER_PID"
    break
  fi
  sleep 1
done

if ! curl -s "http://localhost:${PORT:-8082}/api/status" > /dev/null 2>&1; then
  log "Web 服务启动失败，请检查 $RUN_LOG"
  exit 1
fi

if [ -x "$PROJECT_DIR/scripts/ensure_python_env.sh" ]; then
  log "后台检查/安装 Python venv 环境..."
  SETUP_STATUS_FILE="$SETUP_STATUS_FILE" nohup "$PROJECT_DIR/scripts/ensure_python_env.sh" >> "$START_LOG" 2>&1 &
else
  write_setup_status "error" "missing_script" 0 "缺少 scripts/ensure_python_env.sh"
  log "缺少 scripts/ensure_python_env.sh"
  exit 1
fi

log "启动流程完成；Python 安装进度可在 8082 页面查看"
exit 0
