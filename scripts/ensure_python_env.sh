#!/usr/bin/env bash
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS_FILE="${SETUP_STATUS_FILE:-$PROJECT_DIR/logs/setup-status.json}"
LOG_FILE="$PROJECT_DIR/logs/python-setup.log"
READY_FILE="$PROJECT_DIR/logs/python-ready.ok"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="$PROJECT_DIR/.venv"
REQUIREMENTS_FILE="$PROJECT_DIR/requirements.txt"

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

write_status "installing" "prepare" 5 "正在检查 Python 运行环境"
rm -f "$READY_FILE"
log "Checking Python environment in $VENV_DIR"

if [ ! -x "$VENV_DIR/bin/python" ]; then
  write_status "installing" "create_venv" 15 "正在创建 Python venv"
  log "Creating venv with $PYTHON_BIN"
  if ! "$PYTHON_BIN" -m venv "$VENV_DIR" >> "$LOG_FILE" 2>&1; then
    write_status "error" "create_venv" 15 "创建 Python venv 失败，请查看 logs/python-setup.log"
    exit 1
  fi
fi

write_status "installing" "upgrade_pip" 35 "正在升级 pip"
log "Upgrading pip"
if ! "$VENV_DIR/bin/python" -m pip install --upgrade pip setuptools wheel >> "$LOG_FILE" 2>&1; then
  write_status "error" "upgrade_pip" 35 "升级 pip 失败，请查看 logs/python-setup.log"
  exit 1
fi

write_status "installing" "install_requirements" 60 "正在安装 YOLO Pose Python 依赖"
log "Installing requirements"
if ! "$VENV_DIR/bin/python" -m pip install -r "$REQUIREMENTS_FILE" >> "$LOG_FILE" 2>&1; then
  write_status "error" "install_requirements" 60 "安装 Python 依赖失败，请查看 logs/python-setup.log"
  exit 1
fi

write_status "installing" "install_headless_cv2" 75 "正在切换容器兼容的 OpenCV headless 版本"
log "Ensuring headless OpenCV is used"
"$VENV_DIR/bin/python" -m pip uninstall -y opencv-python opencv-contrib-python >> "$LOG_FILE" 2>&1 || true
if ! "$VENV_DIR/bin/python" -m pip install --no-deps --force-reinstall opencv-python-headless >> "$LOG_FILE" 2>&1; then
  write_status "error" "install_headless_cv2" 75 "安装 opencv-python-headless 失败，请查看 logs/python-setup.log"
  exit 1
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
PY
then
  write_status "error" "verify" 90 "Python 依赖验证失败，请查看 logs/python-setup.log"
  exit 1
fi

date -u +"%Y-%m-%dT%H:%M:%SZ" > "$READY_FILE"
write_status "ready" "ready" 100 "Python 环境已就绪"
log "Python environment is ready"
