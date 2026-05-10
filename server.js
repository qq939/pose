const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 8082;

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// Configure multer for video uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit

// Serve static files
app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadsDir));

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

// Start server
app.listen(PORT, () => {
  log(`YOLO Pose Web App started on port ${PORT}`);
  console.log(`Server running at http://localhost:${PORT}`);
});
