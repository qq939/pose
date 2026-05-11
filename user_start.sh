#!/bin/bash
cd /Users/jiang/Downloads/pose

# 创建目录
mkdir -p logs uploads dataset/images dataset/labels

# 记录启动时间
echo "========== 启动时间: $(date) ==========" >> logs/start.log

# 检查 Python 虚拟环境
if [ ! -d ".venv" ]; then
    echo "创建 Python 虚拟环境..." >> logs/start.log
    uv venv --python 3.11 >> logs/start.log 2>&1
fi

# 激活虚拟环境并安装依赖
echo "安装 Python 依赖..." >> logs/start.log
source .venv/bin/activate
uv pip install opencv-python ultralytics >> logs/start.log 2>&1

# 检查是否有旧的 node 进程
if pgrep -f "node server.js" > /dev/null; then
    echo "发现旧进程，正在停止..." >> logs/start.log
    pkill -f "node server.js"
    sleep 1
fi

# 启动服务（后台运行）
echo "启动 Node 服务..." >> logs/start.log
nohup node server.js > logs/start.log 2>&1 &
SERVER_PID=$!

# 等待服务启动
sleep 2

# 检查服务是否正常运行
if curl -s http://localhost:8082/api/status > /dev/null; then
    echo "服务启动成功，PID: $SERVER_PID" >> logs/start.log
    echo ""
    echo "✅ 服务已在 http://localhost:8082 运行"
    echo ""
    echo "功能说明："
    echo "  📹 开启摄像头 - 打开本地摄像头"
    echo "  🔍 开始检测 - 实时检测姿态"
    echo "  📷 保存样本 - 保存当前帧到 dataset/"
    echo "  🎬 处理视频 - 上传视频并分析"
else
    echo "❌ 服务启动失败，请检查 logs/start.log"
fi

echo "========== 启动完成 ==========" >> logs/start.log
