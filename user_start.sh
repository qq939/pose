#!/bin/bash
cd /home/agent/.claude/workspace/project

# 创建日志目录
mkdir -p logs

# 记录启动时间
echo "========== 启动时间: $(date) ==========" >> logs/start.log

# 检查 node_modules 是否存在，不存在则安装依赖
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
    echo "安装依赖..." >> logs/start.log
    npm install >> logs/start.log 2>&1
fi

# 检查是否有旧的 node 进程
OLD_PIDS=$(pgrep -f "node server.js" 2>/dev/null)
if [ -n "$OLD_PIDS" ]; then
    echo "发现旧进程: $OLD_PIDS，正在停止..." >> logs/start.log
    echo "$OLD_PIDS" | xargs -r kill -9 2>/dev/null
    sleep 1
fi

# 确保没有残留进程
pkill -9 -f "node server.js" 2>/dev/null
sleep 1

# 启动服务（后台运行）
nohup node server.js > logs/start.log 2>&1 &
SERVER_PID=$!

# 等待服务启动
for i in {1..10}; do
    if curl -s http://localhost:8082/api/status > /dev/null 2>&1; then
        echo "服务启动成功，PID: $SERVER_PID" >> logs/start.log
        echo "服务已在 http://localhost:8082 运行" >> logs/start.log
        exit 0
    fi
    sleep 1
done

echo "服务启动失败，请检查 logs/start.log" >> logs/start.log
echo "========== 启动完成 ==========" >> logs/start.log
exit 1
