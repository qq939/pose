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
| 启动日志 | /home/agent/.claude/workspace/project/logs/start.log |
| 容器规范 | /home/agent/.claude/workspace/project/systemreadme.md |
