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
const clientDistDir = path.join(__dirname, 'client', 'dist');
const pythonScript = path.join(__dirname, 'pose_detector.py');
const pythonBin = path.join(__dirname, '.venv', 'bin', 'python');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
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

function getSetupStatus() {
  const fallback = fs.existsSync(pythonBin)
    ? { state: 'ready', step: 'ready', progress: 100, message: 'Python 环境已就绪' }
    : { state: 'installing', step: 'missing_venv', progress: 0, message: '正在准备 Python 环境' };

  try {
    if (!fs.existsSync(SETUP_STATUS_FILE)) return fallback;
    return { ...fallback, ...JSON.parse(fs.readFileSync(SETUP_STATUS_FILE, 'utf8')) };
  } catch (error) {
    return { state: 'error', step: 'status_parse', progress: 0, message: `读取安装状态失败: ${error.message}` };
  }
}

function isPythonReady() {
  const status = getSetupStatus();
  return status.state === 'ready' && fs.existsSync(pythonBin);
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

    worker.stdin.write(header);
    worker.stdin.write(payload);
  });
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

// Video upload endpoint
app.post('/api/upload', upload.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }
  log(`Video uploaded: ${req.file.filename}`);
  res.json({
    success: true,
    filename: req.file.filename,
    path: `/uploads/${req.file.filename}`
  });
});

// Process video with YOLO Pose
app.post('/api/process-video', ensurePythonReady, express.json({ limit: '500mb' }), (req, res) => {
  const { videoPath, confThreshold, skipFrames } = req.body;
  
  if (!videoPath) {
    return res.status(400).json({ error: 'videoPath is required' });
  }
  
  const fullPath = path.join(__dirname, videoPath);
  if (!fs.existsSync(fullPath)) {
    return res.status(400).json({ error: 'Video file not found' });
  }
  
  log(`Processing video: ${videoPath} with conf=${confThreshold || 0.3}, skip=${skipFrames || 0}`);
  
  const conf = confThreshold || 0.3;
  const skip = skipFrames || 0;
  const args = [pythonScript, 'video', fullPath, conf.toString(), skip.toString()];
  const pythonProcess = spawn(pythonBin, args);
  
  let output = '';
  let errorOutput = '';
  let responded = false;
  
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
    log(`Python process: ${data.toString().trim()}`);
  });

  pythonProcess.on('error', (error) => {
    responded = true;
    log(`Python process spawn error: ${error.message}`);
    res.status(500).json({ error: error.message || 'Failed to start Python process' });
  });
  
  pythonProcess.on('close', (code) => {
    if (responded) return;
    if (code !== 0) {
      log(`Python process error: ${errorOutput}`);
      return res.status(500).json({ error: errorOutput || 'Processing failed' });
    }
    
    try {
      const result = parsePythonJsonOutput(output);
      log(`Video processed: ${result.total_output_frames}/${result.total_input_frames} frames`);
      res.json(result);
    } catch (e) {
      log(`JSON parse error: ${output}`);
      res.status(500).json({ error: 'Failed to parse detection result' });
    }
  });
});

// Start real-time pose detection endpoint
app.post('/api/detect-frame', ensurePythonReady, express.json({ limit: '50mb' }), (req, res) => {
  const { imageData, confThreshold } = req.body;
  
  if (!imageData) {
    return res.status(400).json({ error: 'imageData is required' });
  }
  
  detectFrameWithWorker(imageData, confThreshold || 0.3)
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
