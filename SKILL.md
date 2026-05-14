# SKILL.md - 项目技能手册

本文件记录 YOLO Pose 人体关节识别 Web App 的开发、维护和运营技能。

## 1. 项目基础信息

| 项目 | 内容 |
|-----|------|
| 项目名称 | YOLO Pose 人体关节识别 |
| 技术栈 | Node.js + Express + 原生前端 |
| 端口 | 8082 |
| 工作目录 | /home/agent/.claude/workspace/project |

## 2. 启动与停止

### 启动应用
```bash
bash user_start.sh
# 或
node server.js
```

### 停止应用
```bash
pkill -f "node server.js"
# 或
kill $(cat logs/start.log | grep PID | awk '{print $NF}')
```

### 检查运行状态
```bash
curl http://localhost:8082/api/status
curl http://localhost:8082/api/setup-status
```

## 3. 常用命令

### 安装依赖
```bash
npm install
```

### 查看日志
```bash
tail -f logs/start.log    # 启动日志
tail -f logs/run.log      # 运行日志
tail -f logs/python-setup.log # Python venv 安装日志
```

### Git 操作
```bash
git add .
git commit -m "描述本次变更"
git status
```

## 4. 故障排查

### 端口被占用
```bash
lsof -i :8082
# 或
netstat -tlnp | grep 8082
```

### 清理上传目录
```bash
rm -rf uploads/*
```

### 重建 node_modules
```bash
rm -rf node_modules
npm install
```

### 重建 Python venv
```bash
rm -rf .venv
SETUP_STATUS_FILE=logs/setup-status.json bash scripts/ensure_python_env.sh
```

注意：`.venv/` 已在 `.gitignore` 中，提交前必须用 `git status --short` 确认虚拟环境没有进入暂存区。

### 手机端打不开或摄像头不可用
1. 确认 8082 服务：`curl http://localhost:8082/api/status`
2. 确认 Python 环境：`curl http://localhost:8082/api/setup-status`
3. 手机摄像头必须通过 HTTPS 或 localhost 使用
4. 视频元素必须保留 `playsinline`、`webkit-playsinline`、`autoplay`、`muted` 和显式 `video.play()` 逻辑

### YOLO Pose 检测结果黑屏
1. 先看 `/api/setup-status` 是否为 `ready`
2. 再看 `logs/python-setup.log` 和 `logs/run.log`
3. Python 视频处理只能在 stdout 输出最终 JSON；进度信息必须写 stderr，否则前端会解析失败
4. 前端 canvas 在没有 keypoints 时也要绘制源视频帧，不能直接清空

### 摄像头 FPS 限速
1. `检测FPS` 默认 1 FPS，控制结果画布输出频率
2. 浏览器原始摄像头仍由系统采集，前端用 `requestAnimationFrame` 采最新帧进缓存池
3. 缓存池最多 5 张，超过后丢弃旧帧
4. 定时器按 `1000 / fps` 毫秒取缓存池最新帧输出；检测请求也只基于这张输出帧发起

## 5. 开发指南

### 添加新 API 路由
在 `server.js` 中添加：
```javascript
app.post('/api/new-endpoint', (req, res) => {
  // 处理逻辑
  res.json({ success: true });
});
```

### 修改前端
直接编辑 `index.html`，使用原生 JavaScript。

### 添加新依赖
```bash
npm install <package-name>
```

## 6. 部署检查清单

- [x] user_start.sh 存在且可执行
- [x] npm 依赖已安装
- [x] Git 仓库已初始化
- [x] 8082 端口服务正常
- [x] 日志目录存在
- [x] README.md 已更新
- [x] SKILL.md 已创建

## 7. Supabase 数据库连接

项目可集成 Supabase 作为后端数据库：

**连接字符串:**
```
postgresql://postgres.uacwkmdyekxyqtopdele:Black_supabase00@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres
```

**安装方法:**
```bash
npm install @supabase/supabase-js @supabase/ssr
```

## 8. 关键文件路径

| 文件 | 路径 |
|-----|------|
| 启动脚本 | /home/agent/.claude/workspace/project/user_start.sh |
| 服务器 | /home/agent/.claude/workspace/project/server.js |
| 前端页面 | /home/agent/.claude/workspace/project/index.html |
| Python 依赖 | /home/agent/.claude/workspace/project/requirements.txt |
| venv 安装脚本 | /home/agent/.claude/workspace/project/scripts/ensure_python_env.sh |
| 启动日志 | /home/agent/.claude/workspace/project/logs/start.log |
| 容器规范 | /home/agent/.claude/workspace/project/systemreadme.md |
