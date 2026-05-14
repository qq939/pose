import { useState, useRef, useCallback, useEffect } from 'react'

const API_BASE = import.meta.env.BASE_URL || '/yolo/';

const KEYPOINT_NAMES = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
]

const SKELETON = [
  [0, 1], [0, 2], [1, 3], [2, 4],
  [5, 6],
  [5, 7], [7, 9],
  [6, 8], [8, 10],
  [5, 11], [6, 12],
  [11, 12],
  [11, 13], [13, 15],
  [12, 14], [14, 16]
]

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
]

const HAND_TIPS = { 4: 'T', 8: 'I', 12: 'M', 16: 'R', 20: 'P' }
const WHOLEBODY_LEFT_HAND_OFFSET = 91
const WHOLEBODY_RIGHT_HAND_OFFSET = 112

export default function PoseApp() {
  const sourceVideoRef = useRef(null)
  const resultCanvasRef = useRef(null)
  const animationFrameRef = useRef(null)
  
  const [isDetecting, setIsDetecting] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [currentStream, setCurrentStream] = useState(null)
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.3)
  const [samplingRate, setSamplingRate] = useState(0)
  const [targetFps, setTargetFps] = useState(10)
  const [poseMode, setPoseMode] = useState('yolo133')
  const [lastFrameData, setLastFrameData] = useState(null)
  const [lastHandsData, setLastHandsData] = useState([])
  const [detectionResults, setDetectionResults] = useState(null)
  const [processedVideoPath, setProcessedVideoPath] = useState(null)
  const [sampleCount, setSampleCount] = useState(0)
  const [status, setStatus] = useState('就绪')
  const [isError, setIsError] = useState(false)
  const [personCount, setPersonCount] = useState(0)
  const [keypointCount, setKeypointCount] = useState(0)
  const [fps, setFps] = useState(0)
  const [frameCounter, setFrameCounter] = useState(0)
  const [lastDetectTime, setLastDetectTime] = useState(0)
  const [lastVideoTime, setLastVideoTime] = useState(-1)
  const [datasetStatus, setDatasetStatus] = useState('数据集: 0 样本')
  const [fileName, setFileName] = useState('')
  const [downloadResult, setDownloadResult] = useState(null)
  
  const videoInputRef = useRef(null)

  const updateStatus = useCallback((message, isError = false) => {
    setStatus(message)
    setIsError(isError)
  }, [])

  const startCamera = useCallback(async () => {
    try {
      updateStatus('正在开启摄像头...')
      if (!window.isSecureContext) {
        throw new Error('手机摄像头需要 HTTPS，请使用 https://sadsad.fun 访问')
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('浏览器不支持摄像头访问')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      })
      if (sourceVideoRef.current) {
        sourceVideoRef.current.muted = true
        sourceVideoRef.current.setAttribute('playsinline', '')
        sourceVideoRef.current.setAttribute('webkit-playsinline', '')
        sourceVideoRef.current.srcObject = stream
        await sourceVideoRef.current.play()
      }
      setCurrentStream(stream)
      setIsCameraActive(true)
      updateStatus('摄像头已开启')
    } catch (err) {
      let errorMsg = err.message
      if (err.name === 'NotAllowedError') {
        errorMsg = '摄像头访问被拒绝'
      } else if (err.name === 'NotFoundError') {
        errorMsg = '未找到摄像头设备'
      } else if (err.name === 'NotReadableError') {
        errorMsg = '摄像头被其他程序占用'
      } else if (err.name === 'OverconstrainedError') {
        errorMsg = '摄像头不支持请求的分辨率'
      }
      updateStatus(`摄像头错误: ${errorMsg}`, true)
    }
  }, [updateStatus])

  const stopCamera = useCallback(() => {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop())
    }
    if (sourceVideoRef.current) {
      sourceVideoRef.current.srcObject = null
      sourceVideoRef.current.src = ''
    }
    setCurrentStream(null)
    setIsCameraActive(false)
    setIsDetecting(false)
    cancelAnimationFrame(animationFrameRef.current)
    updateStatus('摄像头已关闭')
  }, [currentStream, updateStatus])

  const detectFrameRealtime = useCallback(async () => {
    if (!isCameraActive || !sourceVideoRef.current) return
    
    const now = Date.now()
    if (now - lastDetectTime < 1000 / Math.max(targetFps, 1)) return
    setLastDetectTime(now)
    
    try {
      const canvas = document.createElement('canvas')
      const sourceWidth = sourceVideoRef.current.videoWidth || 640
      const sourceHeight = sourceVideoRef.current.videoHeight || 480
      const scale = Math.min(1, 960 / Math.max(sourceWidth, sourceHeight))
      canvas.width = Math.max(320, Math.round(sourceWidth * scale))
      canvas.height = Math.max(240, Math.round(sourceHeight * scale))
      const tempCtx = canvas.getContext('2d')
      tempCtx.drawImage(sourceVideoRef.current, 0, 0, canvas.width, canvas.height)
      const imageData = canvas.toDataURL('image/jpeg', 0.75).split(',')[1]
      
      const response = await fetch(`${API_BASE}api/detect-frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData, confThreshold: confidenceThreshold, poseMode })
      })
      
      const result = await response.json()
      if (!response.ok) {
        const setupMessage = result.setup?.message ? ` (${result.setup.message})` : ''
        throw new Error((result.error || '检测服务暂不可用') + setupMessage)
      }
      if (result.success && result.persons) {
        const toVideoX = sourceWidth / canvas.width
        const toVideoY = sourceHeight / canvas.height
        const scaleKeypoints = (keypoints = []) => keypoints.map((kp) => ({
          ...kp,
          x: kp.x * toVideoX,
          y: kp.y * toVideoY
        }))
        setLastFrameData(result.persons.map((person) => ({
          ...person,
          keypoints: scaleKeypoints(person.keypoints)
        })))
        setLastHandsData(Array.isArray(result.hands) ? result.hands.map((hand) => ({
          ...hand,
          keypoints: scaleKeypoints(hand.keypoints)
        })) : [])
      }
    } catch (e) {
      console.error('Frame detection error:', e)
      updateStatus(`检测服务准备中: ${e.message}`, true)
    }
  }, [isCameraActive, confidenceThreshold, lastDetectTime, targetFps, poseMode, updateStatus])

  const getPoseFromResults = useCallback((videoTime) => {
    if (!detectionResults || !processedVideoPath) return []
    
    const frameRate = detectionResults.input_fps || 30
    const currentFrameIdx = Math.floor(videoTime * frameRate)
    
    let bestFrame = null
    for (const f of detectionResults.frames) {
      if (f.frame <= currentFrameIdx) {
        if (!bestFrame || f.frame > bestFrame.frame) {
          bestFrame = f
        }
      } else {
        break
      }
    }
    
    return bestFrame?.persons || []
  }, [detectionResults, processedVideoPath])

  const getHandsFromResults = useCallback((videoTime) => {
    if (!detectionResults || !processedVideoPath) return []

    const frameRate = detectionResults.input_fps || 30
    const currentFrameIdx = Math.floor(videoTime * frameRate)

    let bestFrame = null
    for (const f of detectionResults.frames) {
      if (f.frame <= currentFrameIdx) {
        if (!bestFrame || f.frame > bestFrame.frame) {
          bestFrame = f
        }
      } else {
        break
      }
    }

    return bestFrame?.hands || []
  }, [detectionResults, processedVideoPath])

  const processFrame = useCallback(() => {
    if (!isDetecting || !sourceVideoRef.current || !resultCanvasRef.current) return

    const video = sourceVideoRef.current
    const canvas = resultCanvasRef.current
    const ctx = canvas.getContext('2d')
    
    const currentTime = video.currentTime
    const videoWidth = video.videoWidth || 640
    const videoHeight = video.videoHeight || 480
    const canvasDisplayWidth = canvas.offsetWidth
    const canvasDisplayHeight = canvas.offsetHeight

    if (canvas.width !== canvasDisplayWidth || canvas.height !== canvasDisplayHeight) {
      canvas.width = canvasDisplayWidth
      canvas.height = canvasDisplayHeight
    }

    const newFrameCounter = frameCounter + 1
    setFrameCounter(newFrameCounter)
    const skipFrames = samplingRate
    const shouldProcess = skipFrames === 0 || newFrameCounter % (skipFrames + 1) === 0

    if (video.readyState >= 2) {
      if (isCameraActive) {
        if (shouldProcess) {
          detectFrameRealtime()
        }
      } else {
        if (currentTime !== lastVideoTime && shouldProcess) {
          setLastVideoTime(currentTime)
          setLastFrameData(getPoseFromResults(currentTime))
          setLastHandsData(getHandsFromResults(currentTime))
        }
      }
    }

    ctx.clearRect(0, 0, canvasDisplayWidth, canvasDisplayHeight)
    if (video.readyState > 0 && video.videoWidth > 0) {
      ctx.drawImage(video, 0, 0, canvasDisplayWidth, canvasDisplayHeight)
    }

    const drawHands = (hands, scaleX, scaleY) => {
      ;(hands || []).forEach((hand, idx) => {
        const keypoints = hand.keypoints || []
        const color = hand.label === 'Left' ? '#ffb703' : '#fb5607'

        HAND_CONNECTIONS.forEach(([a, b]) => {
          if (keypoints[a] && keypoints[b]) {
            ctx.beginPath()
            ctx.strokeStyle = 'rgba(0,0,0,0.85)'
            ctx.lineWidth = 6
            ctx.moveTo(keypoints[a].x * scaleX, keypoints[a].y * scaleY)
            ctx.lineTo(keypoints[b].x * scaleX, keypoints[b].y * scaleY)
            ctx.stroke()

            ctx.beginPath()
            ctx.strokeStyle = color
            ctx.lineWidth = 3
            ctx.moveTo(keypoints[a].x * scaleX, keypoints[a].y * scaleY)
            ctx.lineTo(keypoints[b].x * scaleX, keypoints[b].y * scaleY)
            ctx.stroke()
          }
        })

        keypoints.forEach((kp, pointIdx) => {
          const x = kp.x * scaleX
          const y = kp.y * scaleY
          ctx.beginPath()
          ctx.arc(x, y, 7, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(0,0,0,0.9)'
          ctx.fill()
          ctx.beginPath()
          ctx.arc(x, y, 5, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.fill()
          ctx.strokeStyle = 'white'
          ctx.lineWidth = 1.5
          ctx.stroke()

          if (HAND_TIPS[pointIdx]) {
            ctx.fillStyle = 'white'
            ctx.font = '12px Arial'
            ctx.fillText(HAND_TIPS[pointIdx], x + 7, y - 7)
          }
        })

        if (keypoints[0]) {
          ctx.fillStyle = color
          ctx.font = '14px Arial'
          ctx.fillText(`${hand.label || 'Hand'} ${idx + 1}${hand.estimated ? ' est' : ''}`, keypoints[0].x * scaleX + 8, keypoints[0].y * scaleY + 18)
        }
      })
    }

    const drawWholebodyHand = (personKeypoints, offset, color, scaleX, scaleY) => {
      HAND_CONNECTIONS.forEach(([a, b]) => {
        const kpA = personKeypoints[offset + a]
        const kpB = personKeypoints[offset + b]
        if (kpA && kpB && kpA.confidence > confidenceThreshold && kpB.confidence > confidenceThreshold) {
          ctx.beginPath()
          ctx.strokeStyle = 'rgba(0,0,0,0.85)'
          ctx.lineWidth = 5
          ctx.moveTo(kpA.x * scaleX, kpA.y * scaleY)
          ctx.lineTo(kpB.x * scaleX, kpB.y * scaleY)
          ctx.stroke()

          ctx.beginPath()
          ctx.strokeStyle = color
          ctx.lineWidth = 2.5
          ctx.moveTo(kpA.x * scaleX, kpA.y * scaleY)
          ctx.lineTo(kpB.x * scaleX, kpB.y * scaleY)
          ctx.stroke()
        }
      })
    }

    const drawWholebodyExtras = (personKeypoints, color, scaleX, scaleY) => {
      if (!personKeypoints || personKeypoints.length < 133) return
      drawWholebodyHand(personKeypoints, WHOLEBODY_LEFT_HAND_OFFSET, '#ffb703', scaleX, scaleY)
      drawWholebodyHand(personKeypoints, WHOLEBODY_RIGHT_HAND_OFFSET, '#fb5607', scaleX, scaleY)
      ;[[15, 17], [17, 18], [17, 19], [16, 20], [20, 21], [20, 22]].forEach(([a, b]) => {
        const kpA = personKeypoints[a]
        const kpB = personKeypoints[b]
        if (kpA && kpB && kpA.confidence > confidenceThreshold && kpB.confidence > confidenceThreshold) {
          ctx.beginPath()
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.moveTo(kpA.x * scaleX, kpA.y * scaleY)
          ctx.lineTo(kpB.x * scaleX, kpB.y * scaleY)
          ctx.stroke()
        }
      })
    }

    if ((lastFrameData && lastFrameData.length > 0) || (lastHandsData && lastHandsData.length > 0)) {
      
      const scaleX = canvasDisplayWidth / videoWidth
      const scaleY = canvasDisplayHeight / videoHeight

      const persons = lastFrameData || []
      const hands = lastHandsData || []

      persons.forEach((person, idx) => {
        const hue = (idx * 60) % 360

        SKELETON.forEach(([a, b]) => {
          const kpA = person.keypoints[a]
          const kpB = person.keypoints[b]
          if (kpA.confidence > confidenceThreshold && kpB.confidence > confidenceThreshold) {
            ctx.beginPath()
            ctx.strokeStyle = `hsl(${hue}, 100%, 50%)`
            ctx.lineWidth = 3 * scaleX
            ctx.moveTo(kpA.x * scaleX, kpA.y * scaleY)
            ctx.lineTo(kpB.x * scaleX, kpB.y * scaleY)
            ctx.stroke()
          }
        })
        drawWholebodyExtras(person.keypoints, `hsl(${hue}, 100%, 50%)`, scaleX, scaleY)

        person.keypoints.forEach((kp, j) => {
          if (kp.confidence > confidenceThreshold) {
            const radius = (person.keypoints.length >= 133 ? 3 : 8) * scaleX
            ctx.beginPath()
            ctx.arc(kp.x * scaleX, kp.y * scaleY, radius, 0, Math.PI * 2)
            ctx.fillStyle = `hsl(${hue}, 100%, 50%)`
            ctx.fill()
            ctx.strokeStyle = 'white'
            ctx.lineWidth = 2
            ctx.stroke()
          }
        })
      })

      drawHands(hands, scaleX, scaleY)

      setPersonCount(persons.length)
      setKeypointCount(
        persons.reduce((sum, p) => sum + p.keypoints.length, 0) +
        hands.reduce((sum, h) => sum + (h.keypoints?.length || 0), 0)
      )
    } else {
      setPersonCount(0)
      setKeypointCount(0)
    }

    setFps(video.paused ? 0 : (isCameraActive ? targetFps : Math.round(30 / (skipFrames + 1))))

    animationFrameRef.current = requestAnimationFrame(processFrame)
  }, [isDetecting, isCameraActive, frameCounter, samplingRate, confidenceThreshold, lastFrameData, lastHandsData, lastVideoTime, targetFps, detectFrameRealtime, getPoseFromResults, getHandsFromResults])

  const startDetection = useCallback(() => {
    if (!isCameraActive && !sourceVideoRef.current?.src) {
      updateStatus('请先开启摄像头或上传视频', true)
      return
    }
    setIsDetecting(true)
    animationFrameRef.current = requestAnimationFrame(processFrame)
    updateStatus('检测中...')
  }, [isCameraActive, processFrame, updateStatus])

  const stopDetection = useCallback(() => {
    setIsDetecting(false)
    cancelAnimationFrame(animationFrameRef.current)
    updateStatus('检测已停止')
  }, [updateStatus])

  const handlePoseModeChange = useCallback((nextMode) => {
    setPoseMode(nextMode)
    setLastVideoTime(-1)
    setLastFrameData(null)
    setLastHandsData([])
    updateStatus(`检测模式: ${nextMode === 'yolo133' ? 'YOLO Pose（133 点）' : 'MediaPipe + YOLO（21 点）'}`)
  }, [updateStatus])

  const handleVideoSelect = useCallback((e) => {
    const file = e.target.files?.[0]
    if (file) {
      setFileName(`已选择: ${file.name}`)
      const url = URL.createObjectURL(file)
      if (sourceVideoRef.current) {
        sourceVideoRef.current.src = url
        sourceVideoRef.current.muted = false
      }
      setIsCameraActive(false)
      setLastVideoTime(-1)
      setLastFrameData(null)
      setLastHandsData([])
      setDetectionResults(null)
      setProcessedVideoPath(null)
      setDownloadResult(null)
      updateStatus(`已加载视频: ${file.name}`)
    }
  }, [updateStatus])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.style.borderColor = '#00ff00'
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.currentTarget.style.borderColor = '#00d4ff'
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.currentTarget.style.borderColor = '#00d4ff'
    if (e.dataTransfer.files[0]) {
      if (videoInputRef.current) {
        videoInputRef.current.files = e.dataTransfer.files
        handleVideoSelect({ target: videoInputRef.current })
      }
    }
  }, [handleVideoSelect])

  const handleProcessVideo = useCallback(async () => {
    const file = videoInputRef.current?.files?.[0]
    if (!file) {
      updateStatus('请先上传视频', true)
      return
    }

    updateStatus('上传视频中...')
    const formData = new FormData()
    formData.append('video', file)
    let progressTimer = null

    try {
      const uploadResponse = await fetch(`${API_BASE}api/upload`, {
        method: 'POST',
        body: formData
      })
      const uploadResult = await uploadResponse.json()
      if (!uploadResult.success) {
        throw new Error(uploadResult.error)
      }
      
      updateStatus(`正在检测姿态（目标 ${targetFps} FPS 抽帧）...`)
      const requestId = `video-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      progressTimer = window.setInterval(async () => {
        try {
          const progressResponse = await fetch(`/api/process-progress/${requestId}`, { cache: 'no-store' })
          const progress = await progressResponse.json()
          if (progress.state !== 'unknown') {
            updateStatus(`${progress.message || '正在检测姿态'} (${progress.progress || 0}%)`)
          }
        } catch (progressError) {
          console.warn('读取处理进度失败', progressError)
        }
      }, 1000)
      
      const processResponse = await fetch(`${API_BASE}api/process-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId,
          videoPath: `/uploads/${uploadResult.filename}`,
          confThreshold: confidenceThreshold,
          skipFrames: -1,
          targetFps,
          poseMode
        })
      })
      const processResult = await processResponse.json()
      
      if (!processResponse.ok) {
        const setupMessage = processResult.setup?.message ? ` (${processResult.setup.message})` : ''
        throw new Error((processResult.error || '检测服务暂不可用') + setupMessage)
      }
      if (processResult.error) {
        throw new Error(processResult.error)
      }
      
      setDetectionResults(processResult)
      setProcessedVideoPath(`/uploads/${uploadResult.filename}`)
      if (processResult.resultVideoPath || processResult.resultPath) {
        setDownloadResult({
          href: processResult.resultVideoPath || processResult.resultPath,
          filename: processResult.resultVideoFilename || processResult.resultFilename || 'pose-result.mp4',
          label: processResult.resultVideoPath ? '下载标注视频' : '下载检测结果'
        })
      }
      updateStatus(`检测完成: ${processResult.total_output_frames}/${processResult.total_input_frames} 帧 (${processResult.sampling_rate})`)
    } catch (err) {
      setDownloadResult(null)
      updateStatus(`处理失败: ${err.message}`, true)
    } finally {
      if (progressTimer) window.clearInterval(progressTimer)
    }
  }, [confidenceThreshold, targetFps, poseMode, updateStatus])

  const saveDatasetSample = useCallback(async () => {
    if (!isCameraActive || !lastFrameData || lastFrameData.length === 0) {
      updateStatus('请先开启摄像头并检测到人体', true)
      return
    }
    
    try {
      const canvas = document.createElement('canvas')
      canvas.width = sourceVideoRef.current?.videoWidth || 640
      canvas.height = sourceVideoRef.current?.videoHeight || 480
      const tempCtx = canvas.getContext('2d')
      tempCtx.drawImage(sourceVideoRef.current, 0, 0)
      const imageData = canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
      
      const h = canvas.height
      const w = canvas.width
      let labelData = ''
      
      for (const person of lastFrameData) {
        const keypoints = person.keypoints
        const cx = keypoints.reduce((s, kp) => s + kp.x, 0) / keypoints.length / w
        const cy = keypoints.reduce((s, kp) => s + kp.y, 0) / keypoints.length / h
        const width = (Math.max(...keypoints.map(kp => kp.x)) - Math.min(...keypoints.map(kp => kp.x))) / w
        const height = (Math.max(...keypoints.map(kp => kp.y)) - Math.min(...keypoints.map(kp => kp.y))) / h
        
        labelData += `0 ${cx.toFixed(6)} ${cy.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`
        for (const kp of keypoints) {
          labelData += ` ${(kp.x / w).toFixed(6)} ${(kp.y / h).toFixed(6)} ${kp.confidence.toFixed(3)}`
        }
        labelData += '\n'
      }
      
      const response = await fetch(`${API_BASE}api/save-dataset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData, labelData, sampleIndex: sampleCount })
      })
      
      const result = await response.json()
      if (result.success) {
        setSampleCount(prev => prev + 1)
        setDatasetStatus(`数据集: ${sampleCount + 1} 样本`)
        updateStatus(`样本 ${sampleCount + 1} 已保存`)
      }
    } catch (e) {
      updateStatus(`保存失败: ${e.message}`, true)
    }
  }, [isCameraActive, lastFrameData, sampleCount, updateStatus])

  const clearDataset = useCallback(() => {
    setSampleCount(0)
    setDatasetStatus('数据集: 0 样本')
    updateStatus('数据集已清空')
  }, [updateStatus])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>YOLO Pose 人体关节识别</h1>

      <div style={styles.panel}>
        <div style={styles.controls}>
          <button style={styles.btnSuccess} onClick={startCamera}>📹 开启摄像头</button>
          <button style={styles.btnSecondary} onClick={stopCamera}>⏹️ 关闭摄像头</button>
          <button style={styles.btnPrimary} onClick={startDetection}>🔍 开始检测</button>
          <button style={styles.btnSecondary} onClick={stopDetection}>⏹️ 停止检测</button>
          <button style={styles.btnSuccess} onClick={saveDatasetSample}>📷 保存样本</button>
          <button style={styles.btnSecondary} onClick={clearDataset}>🗑️ 清空数据集</button>
        </div>
        <div style={{ ...styles.status, ...(isError ? styles.error : {}) }}>{datasetStatus}</div>
      </div>

      <div style={styles.panel}>
        <div
          style={styles.uploadArea}
          onClick={() => videoInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <p>📁 拖拽视频文件到这里 或 点击选择</p>
          <p style={{ color: '#666', fontSize: '14px', marginTop: '10px' }}>支持 MP4, AVI, MOV 格式</p>
          <input
            type="file"
            ref={videoInputRef}
            accept="video/*"
            onChange={handleVideoSelect}
            style={{ display: 'none' }}
          />
          <div style={{ marginTop: '10px', color: '#aaa' }}>{fileName}</div>
        </div>
        <div style={styles.controls}>
          <button style={styles.btnPrimary} onClick={handleProcessVideo}>🎬 处理视频</button>
          {downloadResult && (
            <a
              style={{ ...styles.btnSuccess, textDecoration: 'none' }}
              href={downloadResult.href}
              download={downloadResult.filename}
            >
              {downloadResult.label}
            </a>
          )}
        </div>
      </div>

      <div style={styles.panel}>
        <div style={styles.videoContainer}>
          <div style={styles.videoWrapper}>
            <label style={styles.label}>📺 摄像头 / 视频源</label>
            <video ref={sourceVideoRef} playsInline autoPlay muted={isCameraActive} controls style={styles.video} />
          </div>
          <div style={styles.videoWrapper}>
            <label style={styles.label}>✨ YOLO Pose 检测结果</label>
            <canvas ref={resultCanvasRef} style={styles.canvas} />
          </div>
        </div>
        <div style={{ ...styles.status, ...(isError ? styles.error : {}) }}>{status}</div>
      </div>

      <div style={styles.panel}>
        <h3 style={{ marginBottom: '15px' }}>📊 检测信息</h3>
        <div style={styles.info}>
          <div style={styles.infoItem}>
            <h3>检测到的人数</h3>
            <p>{personCount}</p>
          </div>
          <div style={styles.infoItem}>
            <h3>关键点数</h3>
            <p>{keypointCount}</p>
          </div>
          <div style={styles.infoItem}>
            <h3>FPS</h3>
            <p>{fps}</p>
          </div>
        </div>
        <div style={styles.sliderContainer}>
          <label style={styles.sliderLabel}>置信度阈值:</label>
          <input
            type="range"
            min="0"
            max="100"
            value={confidenceThreshold * 100}
            onChange={(e) => setConfidenceThreshold(e.target.value / 100)}
            style={styles.slider}
          />
          <span style={styles.confidenceValue}>{confidenceThreshold.toFixed(2)}</span>
        </div>
        <div style={styles.sliderContainer}>
          <label style={styles.sliderLabel}>检测FPS:</label>
          <input
            type="range"
            min="1"
            max="30"
            value={targetFps}
            onChange={(e) => setTargetFps(parseInt(e.target.value))}
            style={styles.slider}
          />
          <span style={styles.confidenceValue}>{targetFps} FPS</span>
        </div>
        <div style={styles.modeSwitch} role="radiogroup" aria-label="检测模式">
          <button
            type="button"
            style={{ ...styles.modeButton, ...(poseMode === 'yolo133' ? styles.modeButtonActive : {}) }}
            onClick={() => handlePoseModeChange('yolo133')}
          >
            YOLO Pose（133 点）
          </button>
          <button
            type="button"
            style={{ ...styles.modeButton, ...(poseMode === 'mediapipe_yolo21' ? styles.modeButtonActive : {}) }}
            onClick={() => handlePoseModeChange('mediapipe_yolo21')}
          >
            MediaPipe + YOLO（21 点）
          </button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px'
  },
  title: {
    textAlign: 'center',
    marginBottom: '30px',
    color: '#00d4ff',
    textShadow: '0 0 20px rgba(0, 212, 255, 0.5)',
    fontSize: 'clamp(1.2rem, 4vw, 2rem)'
  },
  panel: {
    background: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '15px',
    padding: 'clamp(15px, 4vw, 25px)',
    marginBottom: '20px',
    border: '1px solid rgba(255, 255, 255, 0.1)'
  },
  controls: {
    display: 'flex',
    gap: 'clamp(8px, 2vw, 15px)',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  btnPrimary: {
    padding: 'clamp(10px, 2vw, 12px) clamp(15px, 3vw, 25px)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: 'clamp(14px, 3vw, 16px)',
    fontWeight: '600',
    background: 'linear-gradient(135deg, #00d4ff, #0099cc)',
    color: 'white',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent'
  },
  btnSecondary: {
    padding: 'clamp(10px, 2vw, 12px) clamp(15px, 3vw, 25px)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: 'clamp(14px, 3vw, 16px)',
    fontWeight: '600',
    background: 'linear-gradient(135deg, #ff6b6b, #ee5a5a)',
    color: 'white',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent'
  },
  btnSuccess: {
    padding: 'clamp(10px, 2vw, 12px) clamp(15px, 3vw, 25px)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: 'clamp(14px, 3vw, 16px)',
    fontWeight: '600',
    background: 'linear-gradient(135deg, #00cc88, #00a86b)',
    color: 'white',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent'
  },
  uploadArea: {
    border: '2px dashed #00d4ff',
    borderRadius: '10px',
    padding: 'clamp(30px, 6vw, 40px)',
    textAlign: 'center',
    cursor: 'pointer',
    marginBottom: '20px',
    touchAction: 'manipulation'
  },
  videoContainer: {
    display: 'flex',
    gap: 'clamp(10px, 3vw, 20px)',
    flexWrap: 'wrap',
    justifyContent: 'center'
  },
  videoWrapper: {
    flex: '1',
    minWidth: 'min(300px, 100%)',
    maxWidth: '580px'
  },
  label: {
    display: 'block',
    marginBottom: '10px',
    color: '#aaa',
    textAlign: 'center',
    fontSize: 'clamp(12px, 2.5vw, 14px)'
  },
  video: {
    width: '100%',
    borderRadius: '10px',
    background: '#000'
  },
  canvas: {
    width: '100%',
    borderRadius: '10px',
    background: '#000'
  },
  status: {
    textAlign: 'center',
    padding: '15px',
    background: 'rgba(0, 204, 136, 0.2)',
    borderRadius: '8px',
    color: '#00cc88',
    marginTop: '15px'
  },
  error: {
    background: 'rgba(255, 107, 107, 0.2)',
    color: '#ff6b6b'
  },
  info: {
    display: 'flex',
    gap: 'clamp(10px, 3vw, 20px)',
    flexWrap: 'wrap',
    marginTop: '20px'
  },
  infoItem: {
    flex: '1',
    minWidth: 'min(200px, 45%)',
    background: 'rgba(0, 0, 0, 0.3)',
    padding: 'clamp(10px, 2vw, 15px)',
    borderRadius: '8px',
    textAlign: 'center'
  },
  sliderContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: 'clamp(8px, 2vw, 15px)',
    justifyContent: 'center',
    marginTop: '15px',
    padding: 'clamp(10px, 2vw, 15px)',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '8px',
    flexWrap: 'wrap'
  },
  sliderLabel: {
    color: '#00d4ff',
    minWidth: 'min(100px, 30%)',
    fontSize: 'clamp(12px, 2.5vw, 14px)'
  },
  slider: {
    flex: '1',
    maxWidth: '300px',
    minWidth: '120px',
    height: '8px',
    borderRadius: '4px',
    background: 'rgba(255, 255, 255, 0.2)',
    outline: 'none'
  },
  confidenceValue: {
    minWidth: 'min(60px, 20%)',
    textAlign: 'center',
    fontWeight: 'bold',
    color: '#00cc88',
    fontSize: 'clamp(12px, 2.5vw, 14px)'
  },
  modeSwitch: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '8px',
    marginTop: '15px',
    padding: '8px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '8px'
  },
  modeButton: {
    minHeight: '44px',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: '6px',
    background: 'transparent',
    color: '#c9d8e8',
    fontWeight: '700',
    cursor: 'pointer',
    padding: '8px 10px'
  },
  modeButtonActive: {
    borderColor: '#00d4ff',
    color: 'white',
    background: 'rgba(0, 212, 255, 0.24)',
    boxShadow: 'inset 0 0 0 1px rgba(0, 212, 255, 0.18)'
  }
}
