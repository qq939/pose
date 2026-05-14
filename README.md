# YOLO Pose 人体关节识别 Web App

## 项目概述

基于 Web 的 YOLO Pose 人体关节识别应用，支持视频上传和实时摄像头两种模式进行人体姿态检测。

**端口**: 8082

## 功能特性

### 1. 视频上传检测
- 支持拖拽或点击上传视频文件
- 支持 MP4、AVI、MOV 等常见格式
- 上传后自动处理并显示检测结果

### 2. 实时摄像头检测
- 一键开启摄像头
- 实时显示检测结果
- 检测 FPS 默认 1 FPS，摄像头输出按 FPS 控件限速
- 摄像头内部保留最新 5 帧缓存，按 `1 / FPS` 秒取最新帧，旧帧自动丢弃
- 支持随时停止/切换

### 3. 人体姿态可视化
- 17 个关键点检测 (COCO 格式)
- 骨骼连线绘制
- 不同人体不同颜色标注
- 关键点置信度显示

## 关键点说明

| 编号 | 名称 | 描述 |
|------|------|------|
| 0 | nose | 鼻子 |
| 1 | left_eye | 左眼 |
| 2 | right_eye | 右眼 |
| 3 | left_ear | 左耳 |
| 4 | right_ear | 右耳 |
| 5 | left_shoulder | 左肩 |
| 6 | right_shoulder | 右肩 |
| 7 | left_elbow | 左肘 |
| 8 | right_elbow | 右肘 |
| 9 | left_wrist | 左手腕 |
| 10 | right_wrist | 右手腕 |
| 11 | left_hip | 左髋 |
| 12 | right_hip | 右髋 |
| 13 | left_knee | 左膝 |
| 14 | right_knee | 右膝 |
| 15 | left_ankle | 左踝 |
| 16 | right_ankle | 右踝 |

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 HTML/CSS/JavaScript
- **上传处理**: Multer
- **通信**: RESTful API

## 项目结构

```
project/
├── index.html          # 前端页面
├── server.js           # Express 服务器
├── package.json        # 依赖配置
├── user_start.sh       # 启动脚本
├── .gitignore          # Git 忽略配置
├── uploads/            # 视频上传目录
└── logs/               # 日志目录
    ├── start.log       # 启动日志
    └── agent_tui.log   # TUI 会话日志
```

## 快速启动

### 方式一：自动启动
```bash
./user_start.sh
```

### 方式二：手动启动
```bash
npm install
node server.js
```

### 方式三：后台运行
```bash
nohup node server.js > logs/start.log 2>&1 &
```

### Docker 启动行为

`user_start.sh` 会先启动 8082 Web 服务，再在后台检查和安装 Python venv。这样即使 `ultralytics` / `opencv-python-headless` 还在安装，用户访问 8082 也会看到安装进度页，而不是连接失败。

安装状态接口：
```bash
curl http://localhost:8082/api/setup-status
```

安装日志：
```bash
tail -f logs/python-setup.log
```

## API 接口

### GET /api/status
检查服务状态

**响应**:
```json
{
  "status": "running",
  "timestamp": "2026-05-10T10:59:18.406Z"
}
```

### POST /api/upload
上传视频文件

**请求**: `multipart/form-data`
- `video`: 视频文件

**响应**:
```json
{
  "success": true,
  "filename": "1620123456789-video.mp4",
  "path": "/uploads/1620123456789-video.mp4"
}
```

## 访问地址

- **本地**: http://localhost:8082
- **容器外部**: 通过宿主机映射端口访问

## 注意事项

1. 当前版本为模拟检测演示版本
2. 如需生产使用，建议集成 ONNX Runtime Web 或 TensorFlow.js
3. 手机摄像头需要 HTTPS 或 localhost 环境才能正常使用
4. 视频文件大小限制: 500MB
5. Python venv 位于 `.venv/`，已被 `.gitignore` 排除，禁止提交虚拟环境
6. YOLO Pose 检测结果黑屏通常来自检测服务未就绪或 canvas 没有绘制源视频帧；当前版本会在无检测结果时继续绘制原视频帧
7. 摄像头 FPS 控件控制结果画布输出频率，不控制浏览器原始摄像头采集频率；内部缓存池只保留最新 5 帧

## 日志文件说明

| 日志文件 | 说明 | 路径 |
|---------|------|------|
| start.log | 应用启动日志，记录服务启动和关闭事件 | logs/start.log |
| run.log | 应用运行日志，记录请求和运行时信息 | logs/run.log |
| python-setup.log | Python venv 安装与验证日志 | logs/python-setup.log |
| agent_tui.log | Claude Agent 会话日志，记录与主人的对话 | logs/agent_tui.log |

### 日志文件内容整理

**agent_tui.log 最新会话内容:**
```
[2026-05-10 18:52:21] $ 你负责的是完整的开发、测试、发现bug、变更的流程...
```
- 本次会话任务：初始化项目、检查启动脚本、更新文档
- 完成工作：
  1. 创建 user_start.sh 启动脚本
  2. 初始化 Git 仓库
  3. 验证 Web App 在 8082 端口运行
  4. 更新 README.md
  5. 创建 SKILL.md

## 开发者

- Agent (Claude Code)
- 主人: 1119623207@qq.com
