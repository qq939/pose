const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8082;
const API_BASE = process.env.API_BASE || '';
const STATIC_BASE = process.env.STATIC_BASE || '/yolo/';

const uploadsDir = path.join(__dirname, 'uploads');
const logsDir = path.join(__dirname, 'logs');
const clientDistDir = path.join(__dirname, 'client', 'dist');
const pythonScript = path.join(__dirname, 'pose_detector.py');
const pythonBin = path.join(__dirname, '.venv', 'bin', 'python3');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit

// Serve static files from client build or root
if (fs.existsSync(clientDistDir)) {
  app.use(STATIC_BASE, express.static(clientDistDir));
} else {
  app.use(express.static(__dirname));
}

// Always serve /uploads and /dataset
app.use('/uploads', express.static(uploadsDir));
app.use('/dataset', express.static(path.join(__dirname, 'dataset')));

// Logging helper
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  const logFile = path.join(logsDir, 'start.log');
  fs.appendFileSync(logFile, logMessage);
  console.log(logMessage.trim());
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'running', timestamp: new Date().toISOString() });
});

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
app.post('/api/process-video', express.json({ limit: '500mb' }), (req, res) => {
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
  
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  
  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      log(`Python process error: ${errorOutput}`);
      return res.status(500).json({ error: errorOutput || 'Processing failed' });
    }
    
    try {
      const result = JSON.parse(output);
      log(`Video processed: ${result.total_output_frames}/${result.total_input_frames} frames`);
      res.json(result);
    } catch (e) {
      log(`JSON parse error: ${output}`);
      res.status(500).json({ error: 'Failed to parse detection result' });
    }
  });
});

// Start real-time pose detection endpoint
app.post('/api/detect-frame', express.json({ limit: '50mb' }), (req, res) => {
  const { imageData, confThreshold } = req.body;
  
  if (!imageData) {
    return res.status(400).json({ error: 'imageData is required' });
  }
  
  const buffer = Buffer.from(imageData, 'base64');
  const conf = confThreshold || 0.3;
  
  const pythonProcess = spawn(pythonBin, [pythonScript, 'frame', conf.toString()]);
  
  let output = '';
  let errorOutput = '';
  
  pythonProcess.stdin.write(buffer);
  pythonProcess.stdin.end();
  
  pythonProcess.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });
  
  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      log(`Frame detection error: ${errorOutput}`);
      return res.status(500).json({ error: errorOutput || 'Detection failed' });
    }
    
    try {
      const result = JSON.parse(output);
      res.json(result);
    } catch (e) {
      log(`Frame detection JSON parse error: ${output}`);
      res.status(500).json({ error: 'Failed to parse detection result' });
    }
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
app.listen(PORT, () => {
  log(`YOLO Pose Web App started on port ${PORT}`);
  console.log(`Server running at http://localhost:${PORT}`);
});
