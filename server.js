const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8082;
const HOST = process.env.HOST || '0.0.0.0';
const API_BASE = process.env.API_BASE || '';
const STATIC_BASE = process.env.STATIC_BASE || '/yolo/';
const SETUP_STATUS_FILE = process.env.SETUP_STATUS_FILE || path.join(__dirname, 'logs', 'setup-status.json');
const PYTHON_READY_FILE = process.env.PYTHON_READY_FILE || path.join(__dirname, 'logs', 'python-ready.ok');

// CORS configuration for known public domains.
const CORS_ORIGINS = [
  'https://hermit.dimond.top',
  'https://dimond.top',
  'https://sadsad.fun',
  'https://www.sadsad.fun',
  'http://sadsad.fun',
  'http://www.sadsad.fun'
];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

const uploadsDir = path.join(__dirname, 'uploads');
const logsDir = path.join(__dirname, 'logs');
const resultsDir = path.join(uploadsDir, 'results');
const clientDistDir = path.join(__dirname, 'client', 'dist');
const pythonScript = path.join(__dirname, 'pose_detector.py');
const pythonBin = path.join(__dirname, '.venv', 'bin', 'python');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit

// Serve static files from client build or root
// Logging helper
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  const logFile = path.join(logsDir, 'start.log');
  fs.appendFileSync(logFile, logMessage);
  console.log(logMessage.trim());
}

function debugLog(scope, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const safeMeta = JSON.stringify(meta, (key, value) => {
    if (typeof value === 'string' && value.length > 1200) {
      return `${value.slice(0, 1200)}...<truncated ${value.length - 1200} chars>`;
    }
    return value;
  });
  const line = `[${timestamp}] [${scope}] ${message} ${safeMeta}\n`;
  fs.appendFileSync(path.join(logsDir, 'run.log'), line);
}

function textTail(value, maxLength = 3000) {
  if (!value) return '';
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}

function makeRequestId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function sanitizeRequestId(value, fallbackPrefix = 'video') {
  if (typeof value !== 'string') return makeRequestId(fallbackPrefix);
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return cleaned || makeRequestId(fallbackPrefix);
}

const videoProgress = new Map();
const VIDEO_PROCESS_TIMEOUT_MS = Number(process.env.VIDEO_PROCESS_TIMEOUT_MS || 10 * 60 * 1000);

function setVideoProgress(requestId, patch) {
  const previous = videoProgress.get(requestId) || {};
  const next = {
    requestId,
    state: 'processing',
    progress: 0,
    message: '正在准备视频处理',
    ...previous,
    ...patch,
    startedAt: previous.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  videoProgress.set(requestId, next);
  return next;
}

function parseVideoProgress(requestId, chunkText) {
  const opened = chunkText.match(/frames=(\d+).*?fps=([0-9.]+).*?skip=(-?\d+)/);
  if (opened) {
    const totalInputFrames = Number(opened[1]);
    const inputFps = Number(opened[2]);
    const skip = Number(opened[3]);
    const sampleEvery = Math.max(skip + 1, 1);
    const estimatedOutputFrames = Math.max(Math.ceil(totalInputFrames / sampleEvery), 1);
    setVideoProgress(requestId, {
      totalInputFrames,
      inputFps,
      skip,
      estimatedOutputFrames,
      progress: 2,
      message: `视频已打开，预计处理 ${estimatedOutputFrames} 个采样帧`
    });
  }

  const detected = [...chunkText.matchAll(/Detected output_frames=(\d+) input_frame=(\d+)\/(\d+)/g)].pop();
  if (detected) {
    const outputFrames = Number(detected[1]);
    const inputFrame = Number(detected[2]);
    const totalInputFrames = Number(detected[3]);
    const current = videoProgress.get(requestId) || {};
    const estimatedOutputFrames = current.estimatedOutputFrames || outputFrames || 1;
    const progress = Math.max(2, Math.min(98, Math.round((outputFrames / estimatedOutputFrames) * 100)));
    setVideoProgress(requestId, {
      outputFrames,
      inputFrame,
      totalInputFrames,
      progress,
      message: `已处理 ${outputFrames}/${estimatedOutputFrames} 个采样帧`
    });
  }
}

function getSetupStatus() {
  const markerReady = fs.existsSync(pythonBin) && fs.existsSync(PYTHON_READY_FILE);
  const fallback = markerReady
    ? { state: 'ready', step: 'ready', progress: 100, message: 'Python 环境已就绪' }
    : { state: 'installing', step: 'missing_venv', progress: 0, message: '正在准备 Python 环境' };

  try {
    if (!fs.existsSync(SETUP_STATUS_FILE)) return fallback;
    const status = { ...fallback, ...JSON.parse(fs.readFileSync(SETUP_STATUS_FILE, 'utf8')) };
    if (status.state === 'ready' && !markerReady) {
      return {
        ...status,
        state: 'installing',
        step: 'verify',
        progress: Math.min(status.progress || 90, 90),
        message: '正在重新验证 Python 环境'
      };
    }
    return status;
  } catch (error) {
    return { state: 'error', step: 'status_parse', progress: 0, message: `读取安装状态失败: ${error.message}` };
  }
}

function isPythonReady() {
  const status = getSetupStatus();
  return status.state === 'ready' && fs.existsSync(pythonBin) && fs.existsSync(PYTHON_READY_FILE);
}

function setupPage(status) {
  const safeStatus = JSON.stringify(status).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YOLO Pose 正在准备环境</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #eef7ff;
      background: #101827;
    }
    main {
      width: min(560px, 100%);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 8px;
      padding: 24px;
      background: rgba(255,255,255,.06);
    }
    h1 { margin: 0 0 12px; font-size: 24px; letter-spacing: 0; }
    p { margin: 8px 0; color: #c7d7ea; line-height: 1.55; }
    .bar { height: 12px; margin: 18px 0; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.12); }
    .fill { height: 100%; width: 0%; background: #20c997; transition: width .4s ease; }
    .meta { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #9fb2c8; }
    .error { color: #ffb4b4; }
  </style>
</head>
<body>
  <main>
    <h1>YOLO Pose 正在准备环境</h1>
    <p id="message">正在读取安装进度...</p>
    <div class="bar"><div class="fill" id="fill"></div></div>
    <p class="meta" id="meta"></p>
  </main>
  <script>
    let current = ${safeStatus};
    function render(status) {
      current = status;
      document.getElementById('message').textContent = status.message || '正在准备 Python 环境';
      document.getElementById('message').className = status.state === 'error' ? 'error' : '';
      document.getElementById('fill').style.width = Math.max(0, Math.min(100, status.progress || 0)) + '%';
      document.getElementById('meta').textContent = (status.step || '-') + ' · ' + (status.progress || 0) + '%';
      if (status.state === 'ready') window.location.reload();
    }
    async function poll() {
      try {
        const response = await fetch('/api/setup-status', { cache: 'no-store' });
        render(await response.json());
      } catch (error) {
        render({ state: 'error', step: 'poll', progress: current.progress || 0, message: '读取安装进度失败: ' + error.message });
      }
    }
    render(current);
    setInterval(poll, 1500);
  </script>
</body>
</html>`;
}

function ensurePythonReady(req, res, next) {
  if (isPythonReady()) return next();
  return res.status(503).json({ error: 'Python environment is not ready', setup: getSetupStatus() });
}

function parsePythonJsonOutput(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error('Python process returned empty output');
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const jsonLine = trimmed.split(/\r?\n/).reverse().find((line) => line.trim().startsWith('{'));
    if (jsonLine) return JSON.parse(jsonLine);
    throw error;
  }
}

let streamWorker = null;
let streamBuffer = Buffer.alloc(0);
let streamPending = [];
let streamStarting = null;

function startStreamWorker() {
  if (streamWorker) return Promise.resolve(streamWorker);
  if (streamStarting) return streamStarting;

  streamStarting = new Promise((resolve, reject) => {
    if (!isPythonReady()) {
      reject(new Error(getSetupStatus().message || 'Python environment is not ready'));
      return;
    }
    const worker = spawn(pythonBin, [pythonScript, 'stream', '0.3']);
    streamBuffer = Buffer.alloc(0);
    streamPending = [];

    worker.stdout.on('data', (chunk) => {
      streamBuffer = Buffer.concat([streamBuffer, chunk]);

      while (streamBuffer.length >= 4) {
        const messageSize = streamBuffer.readUInt32BE(0);
        if (streamBuffer.length < 4 + messageSize) break;

        const payload = streamBuffer.subarray(4, 4 + messageSize).toString();
        streamBuffer = streamBuffer.subarray(4 + messageSize);

        const pending = streamPending.shift();
        if (!pending) continue;

        try {
          pending.resolve(JSON.parse(payload));
        } catch (error) {
          pending.reject(error);
        }
      }
    });

    worker.stderr.on('data', (data) => {
      log(`Stream worker stderr: ${data.toString().trim()}`);
    });

    worker.on('error', (error) => {
      if (streamWorker === worker) streamWorker = null;
      streamStarting = null;
      reject(error);
    });

    worker.on('close', (code) => {
      if (streamWorker === worker) streamWorker = null;
      streamStarting = null;
      const error = new Error(`Stream worker exited with code ${code}`);
      while (streamPending.length > 0) {
        streamPending.shift().reject(error);
      }
    });

    streamWorker = worker;
    streamStarting = null;
    resolve(worker);
  });

  return streamStarting;
}

async function detectFrameWithWorker(imageData, confThreshold) {
  const worker = await startStreamWorker();
  const payload = Buffer.from(JSON.stringify({ imageData, confThreshold }));

  return new Promise((resolve, reject) => {
    streamPending.push({ resolve, reject });

    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);

    const failPending = (error) => {
      const index = streamPending.findIndex((pending) => pending.resolve === resolve);
      if (index >= 0) streamPending.splice(index, 1);
      reject(error);
    };

    worker.stdin.write(header, (error) => {
      if (error) failPending(error);
    });
    worker.stdin.write(payload, (error) => {
      if (error) failPending(error);
    });
  });
}

function detectFrameOnce(imageData, confThreshold) {
  return new Promise((resolve, reject) => {
    let imageBuffer;
    try {
      imageBuffer = Buffer.from(imageData, 'base64');
    } catch (error) {
      reject(error);
      return;
    }

    const pythonProcess = spawn(pythonBin, [pythonScript, 'frame', String(confThreshold || 0.3)]);
    let output = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      log(`Frame fallback stderr: ${data.toString().trim()}`);
    });

    pythonProcess.on('error', reject);

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || `Frame fallback exited with code ${code}`));
        return;
      }

      try {
        resolve(parsePythonJsonOutput(output));
      } catch (error) {
        reject(error);
      }
    });

    pythonProcess.stdin.end(imageBuffer);
  });
}

async function detectFrame(imageData, confThreshold) {
  try {
    const result = await detectFrameWithWorker(imageData, confThreshold);
    if (result && result.success === false && result.error) {
      log(`Stream worker frame error: ${result.error}`);
    }
    return result;
  } catch (error) {
    log(`Stream worker failed, falling back to one-shot frame detection: ${error.message}`);
    streamWorker = null;
    streamStarting = null;
    streamBuffer = Buffer.alloc(0);
    streamPending = [];
    return detectFrameOnce(imageData, confThreshold);
  }
}

// Routes
app.get('/', (req, res) => {
  if (!isPythonReady()) {
    res.status(503).send(setupPage(getSetupStatus()));
    return;
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    pythonReady: isPythonReady(),
    setup: getSetupStatus(),
    timestamp: new Date().toISOString()
  });
});

app.get('/api/setup-status', (req, res) => {
  res.json(getSetupStatus());
});

app.get('/api/process-progress/:requestId', (req, res) => {
  const requestId = sanitizeRequestId(req.params.requestId);
  res.json(videoProgress.get(requestId) || {
    requestId,
    state: 'unknown',
    progress: 0,
    message: '暂未收到处理进度'
  });
});

// Serve static files only after setup routes are registered.
if (fs.existsSync(clientDistDir)) {
  app.use(STATIC_BASE, (req, res, next) => {
    if (!isPythonReady()) {
      res.status(503).send(setupPage(getSetupStatus()));
      return;
    }
    next();
  }, express.static(clientDistDir));
  app.get([STATIC_BASE, `${STATIC_BASE}*`], (req, res) => {
    if (!isPythonReady()) {
      res.status(503).send(setupPage(getSetupStatus()));
      return;
    }
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });
} else {
  app.use(express.static(__dirname, { index: false }));
}

// Always serve /uploads and /dataset
app.use('/uploads', express.static(uploadsDir));
app.use('/dataset', express.static(path.join(__dirname, 'dataset')));
app.use('/results', express.static(resultsDir, {
  setHeaders: (res, filePath) => {
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
  }
}));

// Video upload endpoint
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    debugLog('upload', 'missing video file');
    return res.status(400).json({ error: 'No video file uploaded' });
  }
  log(`Video uploaded: ${req.file.filename}`);
  debugLog('upload', 'video uploaded', {
    filename: req.file.filename,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    path: req.file.path
  });
  res.json({
    success: true,
    filename: req.file.filename,
    path: `/uploads/${req.file.filename}`
  });
});

// Process video with YOLO Pose
app.post('/api/process-video', ensurePythonReady, express.json({ limit: '500mb' }), (req, res) => {
  const { videoPath, confThreshold, skipFrames, targetFps } = req.body;
  const requestId = sanitizeRequestId(req.body.requestId, 'video');
  
  if (!videoPath) {
    debugLog('process-video', 'missing videoPath', { requestId, body: req.body });
    return res.status(400).json({ error: 'videoPath is required' });
  }
  
  const fullPath = path.join(__dirname, videoPath);
  if (!fs.existsSync(fullPath)) {
    debugLog('process-video', 'video file not found', { requestId, videoPath, fullPath });
    return res.status(400).json({ error: 'Video file not found' });
  }
  
  const videoStat = fs.statSync(fullPath);
  log(`Processing video: ${videoPath} with conf=${confThreshold || 0.3}, skip=${skipFrames ?? -1}, targetFps=${targetFps ?? 10}`);
  
  const conf = confThreshold || 0.3;
  const requestedSkip = Number.isFinite(Number(skipFrames)) ? Number(skipFrames) : -1;
  const skip = requestedSkip > 0 ? Math.floor(requestedSkip) : -1;
  const requestedTargetFps = Number.isFinite(Number(targetFps)) ? Number(targetFps) : 10;
  const effectiveTargetFps = Math.max(0.1, Math.min(30, requestedTargetFps));
  const args = [pythonScript, 'video', fullPath, conf.toString(), skip.toString(), effectiveTargetFps.toString()];
  debugLog('process-video', 'spawn python process', {
    requestId,
    videoPath,
    fullPath,
    size: videoStat.size,
    conf,
    skip,
    requestedSkip,
    targetFps: effectiveTargetFps,
    sampling: skip < 0 ? `auto target ${effectiveTargetFps} fps` : `every ${skip + 1} frame(s)`,
    pythonBin,
    args
  });
  const startedAt = Date.now();
  const pythonProcess = spawn(pythonBin, args);
  setVideoProgress(requestId, {
    state: 'processing',
    progress: 1,
    message: 'Python 检测进程已启动',
    videoPath,
    timeoutMs: VIDEO_PROCESS_TIMEOUT_MS
  });
  
  let output = '';
  let errorOutput = '';
  let responded = false;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    setVideoProgress(requestId, {
      state: 'timeout',
      progress: 100,
      message: '处理超过 10 分钟，已停止'
    });
    debugLog('process-video', 'python process timeout', { requestId, timeoutMs: VIDEO_PROCESS_TIMEOUT_MS });
    pythonProcess.kill('SIGTERM');
    setTimeout(() => {
      if (pythonProcess.exitCode === null && pythonProcess.signalCode === null) {
        pythonProcess.kill('SIGKILL');
      }
    }, 3000);
  }, VIDEO_PROCESS_TIMEOUT_MS);
  
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
    debugLog('process-video', 'python stdout chunk', {
      requestId,
      bytes: data.length,
      outputLength: output.length
    });
  });
  
  pythonProcess.stderr.on('data', (data) => {
    const chunkText = data.toString();
    errorOutput += chunkText;
    log(`Python process: ${chunkText.trim()}`);
    parseVideoProgress(requestId, chunkText);
    debugLog('process-video', 'python stderr chunk', {
      requestId,
      bytes: data.length,
      stderrTail: textTail(errorOutput, 1200)
    });
  });

  pythonProcess.on('error', (error) => {
    responded = true;
    clearTimeout(timeout);
    setVideoProgress(requestId, {
      state: 'error',
      progress: 100,
      message: error.message || 'Python 进程启动失败'
    });
    log(`Python process spawn error: ${error.message}`);
    debugLog('process-video', 'python spawn error', {
      requestId,
      message: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: error.message || 'Failed to start Python process', debugId: requestId });
  });
  
  pythonProcess.on('close', (code, signal) => {
    if (responded) return;
    clearTimeout(timeout);
    const durationMs = Date.now() - startedAt;
    debugLog('process-video', 'python process closed', {
      requestId,
      code,
      signal,
      durationMs,
      stdoutLength: output.length,
      stderrLength: errorOutput.length,
      stdoutTail: textTail(output),
      stderrTail: textTail(errorOutput)
    });
    if (timedOut) {
      const errorMessage = `视频处理超时，已超过 ${Math.round(VIDEO_PROCESS_TIMEOUT_MS / 60000)} 分钟`;
      log(`Python process timeout: ${errorMessage}`);
      return res.status(504).json({ error: errorMessage, debugId: requestId });
    }
    if (code !== 0) {
      const errorMessage = textTail(errorOutput) || `Python exited with code ${code}${signal ? ` signal ${signal}` : ''}`;
      log(`Python process error: ${errorMessage}`);
      setVideoProgress(requestId, {
        state: 'error',
        progress: 100,
        message: errorMessage || '处理失败'
      });
      return res.status(500).json({ error: errorMessage || 'Processing failed', debugId: requestId });
    }
    
    try {
      const result = parsePythonJsonOutput(output);
      if (result.error) {
        debugLog('process-video', 'python returned error json', { requestId, result });
        return res.status(500).json({ error: result.error, debugId: requestId });
      }
      const resultFilename = `${path.parse(path.basename(fullPath)).name}-pose-${requestId}.json`;
      const resultPath = path.join(resultsDir, resultFilename);
      const resultWithDownloads = {
        ...result,
        debugId: requestId,
        sourceVideo: videoPath,
        resultFilename,
        resultPath: `/results/${resultFilename}`
      };
      fs.writeFileSync(resultPath, JSON.stringify(resultWithDownloads, null, 2));
      log(`Video processed: ${result.total_output_frames}/${result.total_input_frames} frames`);
      setVideoProgress(requestId, {
        state: 'done',
        progress: 100,
        outputFrames: result.total_output_frames,
        totalInputFrames: result.total_input_frames,
        resultPath: `/results/${resultFilename}`,
        message: `检测完成: ${result.total_output_frames}/${result.total_input_frames} 帧`
      });
      debugLog('process-video', 'video processed successfully', {
        requestId,
        totalInputFrames: result.total_input_frames,
        totalOutputFrames: result.total_output_frames,
        resultPath,
        downloadUrl: `/results/${resultFilename}`
      });
      res.json(resultWithDownloads);
    } catch (e) {
      log(`JSON parse error: ${output}`);
      setVideoProgress(requestId, {
        state: 'error',
        progress: 100,
        message: `解析检测结果失败: ${e.message}`
      });
      debugLog('process-video', 'failed to parse python output', {
        requestId,
        message: e.message,
        stdoutTail: textTail(output),
        stderrTail: textTail(errorOutput)
      });
      res.status(500).json({ error: `Failed to parse detection result: ${e.message}`, debugId: requestId });
    }
  });
});

// Start real-time pose detection endpoint
app.post('/api/detect-frame', ensurePythonReady, express.json({ limit: '50mb' }), (req, res) => {
  const { imageData, confThreshold } = req.body;
  
  if (!imageData) {
    return res.status(400).json({ error: 'imageData is required' });
  }
  
  detectFrame(imageData, confThreshold || 0.3)
    .then((result) => res.json(result))
    .catch((error) => {
      log(`Frame detection error: ${error.message}`);
      res.status(500).json({ error: error.message || 'Detection failed' });
    });
});

// Dataset collection endpoint
app.post('/api/save-dataset', express.json({ limit: '50mb' }), (req, res) => {
  const { imageData, labelData, sampleIndex } = req.body;
  
  if (!imageData || !labelData) {
    return res.status(400).json({ error: 'imageData and labelData are required' });
  }
  
  const datasetDir = path.join(__dirname, 'dataset');
  const imagesDir = path.join(datasetDir, 'images');
  const labelsDir = path.join(datasetDir, 'labels');
  
  [datasetDir, imagesDir, labelsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  
  const buffer = Buffer.from(imageData, 'base64');
  const imgPath = path.join(imagesDir, `sample_${String(sampleIndex || 0).padStart(4, '0')}.jpg`);
  const labelPath = path.join(labelsDir, `sample_${String(sampleIndex || 0).padStart(4, '0')}.txt`);
  
  fs.writeFileSync(imgPath, buffer);
  fs.writeFileSync(labelPath, labelData);
  
  log(`Dataset sample saved: ${sampleIndex || 0}`);
  res.json({ success: true, imagePath: `/dataset/images/${path.basename(imgPath)}`, labelPath });
});

// Start server
app.listen(PORT, HOST, () => {
  log(`YOLO Pose Web App started on ${HOST}:${PORT}`);
  console.log(`Server running at http://${HOST}:${PORT}`);
});
