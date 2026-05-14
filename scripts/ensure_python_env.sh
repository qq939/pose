#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS_FILE="${SETUP_STATUS_FILE:-$PROJECT_DIR/logs/setup-status.json}"
LOG_FILE="$PROJECT_DIR/logs/python-setup.log"
READY_FILE="$PROJECT_DIR/logs/python-ready.ok"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="$PROJECT_DIR/.venv"
REQUIREMENTS_FILE="$PROJECT_DIR/requirements.txt"

# 网络重试配置
MAX_RETRIES=5
RETRY_DELAY=5
RETRY_MULTIPLIER=2
MAX_RETRY_DELAY=120

mkdir -p "$PROJECT_DIR/logs"

write_status() {
  local state="$1"
  local step="$2"
  local progress="$3"
  local message="$4"
  local updated_at
  updated_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  cat > "$STATUS_FILE" <<EOF
{"state":"$state","step":"$step","progress":$progress,"message":"$message","updatedAt":"$updated_at"}
EOF
}

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "$LOG_FILE"
}

# 带重试的 pip install
# 用法: pip_retry "package1 package2" [extra_pip_args...]
pip_retry() {
  local packages="$1"
  shift
  local attempt=1
  local delay=$RETRY_DELAY
  local last_error=""

  while true; do
    log "pip install attempt $attempt/$MAX_RETRIES: $packages"
    if "$VENV_DIR/bin/python" -m pip install $packages "$@" >> "$LOG_FILE" 2>&1; then
      return 0
    fi

    last_error=$(tail -5 "$LOG_FILE" | tr '\n' ' ')
    attempt=$((attempt + 1))

    if [ $attempt -gt $MAX_RETRIES ]; then
      log "pip install failed after $MAX_RETRIES attempts: $last_error"
      return 1
    fi

    log "pip install failed, retrying in ${delay}s... (error: $last_error)"
    sleep $delay
    delay=$((delay * RETRY_MULTIPLIER))
    [ $delay -gt $MAX_RETRY_DELAY ] && delay=$MAX_RETRY_DELAY
  done
}

# 带重试的命令执行
# 用法: cmd_retry description max_retries delay command [args...]
cmd_retry() {
  local desc="$1"
  local max_retries="${2:-$MAX_RETRIES}"
  local delay="${3:-$RETRY_DELAY}"
  shift 3
  local attempt=1

  while true; do
    log "$desc attempt $attempt/$max_retries"
    if "$@" >> "$LOG_FILE" 2>&1; then
      return 0
    fi

    attempt=$((attempt + 1))
    if [ $attempt -gt $max_retries ]; then
      log "$desc failed after $max_retries attempts"
      return 1
    fi

    log "$desc failed, retrying in ${delay}s..."
    sleep $delay
    delay=$((delay * RETRY_MULTIPLIER))
    [ $delay -gt $MAX_RETRY_DELAY ] && delay=$MAX_RETRY_DELAY
  done
}

write_status "installing" "prepare" 5 "正在检查 Python 运行环境"
rm -f "$READY_FILE"
log "Checking Python environment in $VENV_DIR"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  write_status "installing" "create_venv" 15 "正在创建 Python venv"
  log "Creating venv with $PYTHON_BIN"
  if ! cmd_retry "Create venv" 3 10 "$PYTHON_BIN" -m venv "$VENV_DIR"; then
    write_status "error" "create_venv" 15 "创建 Python venv 失败，请查看 logs/python-setup.log"
    exit 1
  fi
fi

write_status "installing" "upgrade_pip" 35 "正在升级 pip"
log "Upgrading pip"
if ! pip_retry "--upgrade pip setuptools wheel"; then
  write_status "error" "upgrade_pip" 35 "升级 pip 失败，请查看 logs/python-setup.log"
  exit 1
fi

write_status "installing" "install_requirements" 60 "正在安装 YOLO Pose Python 依赖"
log "Installing requirements from $REQUIREMENTS_FILE"
if ! pip_retry "-r $REQUIREMENTS_FILE"; then
  write_status "error" "install_requirements" 60 "安装 Python 依赖失败，请查看 logs/python-setup.log"
  exit 1
fi

write_status "installing" "install_headless_cv2" 75 "正在切换容器兼容的 OpenCV headless 版本"
log "Ensuring headless OpenCV is used"
"$VENV_DIR/bin/python" -m pip uninstall -y opencv-python opencv-contrib-python >> "$LOG_FILE" 2>&1 || true
if ! "$VENV_DIR/bin/python" -m pip install --force-reinstall "numpy<2" opencv-python-headless==4.11.0.86 >> "$LOG_FILE" 2>&1; then
  write_status "error" "install_headless_cv2" 75 "安装 opencv-python-headless 失败，请查看 logs/python-setup.log"
  exit 1
fi

write_status "installing" "install_hands" 82 "正在安装手关节检测依赖（可选）"
log "Installing optional MediaPipe Hands"
if pip_retry "mediapipe"; then
  log "MediaPipe installed; restoring headless OpenCV"
  "$VENV_DIR/bin/python" -m pip uninstall -y opencv-python opencv-contrib-python >> "$LOG_FILE" 2>&1 || true
  "$VENV_DIR/bin/python" -m pip install --force-reinstall "numpy<2" opencv-python-headless==4.11.0.86 >> "$LOG_FILE" 2>&1 || true
else
  log "MediaPipe install failed; hand joints will be disabled but body pose remains available"
fi

write_status "installing" "verify" 90 "正在验证 cv2 / ultralytics / numpy"
log "Verifying Python packages"
if ! "$VENV_DIR/bin/python" - <<'PY' >> "$LOG_FILE" 2>&1
import cv2
import numpy
import ultralytics
print("cv2", cv2.__version__)
print("numpy", numpy.__version__)
print("ultralytics", ultralytics.__version__)
try:
    import mediapipe
    print("mediapipe", mediapipe.__version__)
except Exception as error:
    print("mediapipe unavailable", error)
PY
then
  write_status "error" "verify" 90 "Python 依赖验证失败，请查看 logs/python-setup.log"
  exit 1
fi

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$READY_FILE"
write_status "ready" "ready" 100 "Python 环境已就绪"
log "Python environment is ready"
