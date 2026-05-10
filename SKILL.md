# SKILL.md - YOLO Pose 开发技能文档

## 技能概述

本项目是一个基于 Web 的 YOLO Pose 人体关节识别应用，使用 Node.js + Express 构建后端，原生 HTML/CSS/JavaScript 构建前端。

## 技术栈

### 后端
- **运行时**: Node.js v20+
- **框架**: Express.js
- **文件上传**: Multer
- **端口**: 8082

### 前端
- **HTML5**: video, canvas 元素
- **MediaDevices API**: 摄像头访问
- **Canvas 2D**: 骨骼绘制
- **拖拽上传**: Drag and Drop API

## 核心概念

### YOLO Pose 模型
- 使用 COCO 格式的 17 个关键点
- 支持多人检测
- 输出关键点坐标和置信度

### 骨骼定义
```
SKELETON = [
  [0, 1], [0, 2], [1, 3], [2, 4],  // 头部
  [5, 6],                          // 肩部
  [5, 7], [7, 9],                  // 左臂
  [6, 8], [8, 10],                 // 右臂
  [5, 11], [6, 12],                // 躯干
  [11, 12],                        // 髋部
  [11, 13], [13, 15],              // 左腿
  [12, 14], [14, 16]               // 右腿
]
```

### 颜色编码
- 每个检测到的人分配不同颜色
- 颜色使用 HSL 色彩空间生成
- 色调 = (人物索引 × 60) % 360

## 开发指南

### 添加新的检测模型

1. 获取 ONNX 模型文件 (如 yolov8n-pose.onnx)
2. 在前端引入 ONNX Runtime Web:
```html
<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/ort.min.js"></script>
```

3. 修改 `detectPose` 函数:
```javascript
async function detectPose(frame) {
  const session = await ort.InferenceSession.create('/models/yolov8n-pose.onnx');
  const tensor = await preprocessFrame(frame);
  const output = await session.run({ input: tensor });
  return postprocessYOLOOutput(output);
}
```

### 自定义骨骼样式

修改 `SKELETON` 数组可自定义骨骼连接方式:
```javascript
const SKELETON = [
  [5, 6],   // 肩部连线
  // ... 添加更多连线
];
```

### 添加新功能

1. **添加新的 API 端点** - 在 `server.js` 中添加:
```javascript
app.post('/api/new-endpoint', (req, res) => {
  // 处理逻辑
  res.json({ success: true });
});
```

2. **添加新的前端页面** - 创建新 HTML 文件:
```html
<!-- new-page.html -->
<!DOCTYPE html>
<html>
<head>
  <title>新页面</title>
</head>
<body>
  <!-- 页面内容 -->
</body>
</html>
```

## 调试技巧

### 检查摄像头权限
```javascript
navigator.mediaDevices.getUserMedia({ video: true })
  .then(stream => console.log('Camera OK'))
  .catch(err => console.error('Camera Error:', err));
```

### 打印关键点数据
```javascript
console.log('Persons:', JSON.stringify(persons, null, 2));
```

### 检查服务器状态
```bash
curl http://localhost:8082/api/status
```

## 性能优化

1. **视频帧处理**: 使用 requestAnimationFrame
2. **Canvas 操作**: 先绘制背景，再叠加骨骼
3. **关键点过滤**: 仅绘制置信度 > 0.3 的点

## 相关资源

- [Ultralytics YOLO](https://github.com/ultralytics/ultralytics)
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
- [MediaDevices API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices)
- [Canvas 2D API](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D)
