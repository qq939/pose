#!/usr/bin/env python3
"""
YOLO Pose 检测器 - 用大白话说就是：
1. 找个视频/摄像头/图片
2. 用 YOLO 模型找出图片里人的17个关键点 (鼻子、眼睛、手、脚这些)
3. 把结果存起来或者画出来给人看
"""
import numpy as np
import sys
import json
import base64
import struct
from pathlib import Path

try:
    import cv2
except ImportError:
    print(json.dumps({"error": "请先安装 opencv-python-headless: pip install opencv-python-headless"}))
    sys.exit(1)

try:
    from ultralytics import YOLO
except ImportError:
    print(json.dumps({"error": "请先安装 ultralytics: pip install ultralytics"}))
    sys.exit(1)

detector = None


def get_detector():
    """
    输入：无
    输出：一个加载好的 YOLO 模型

    大白话：加载 YOLO 模型文件，只加载一次，之后都用这个

    示例：无（模型对象）
    """
    global detector
    if detector is None:
        script_dir = Path(__file__).parent.resolve()
        model_path = script_dir / "yolov8n-pose.pt"
        detector = YOLO(str(model_path))
    return detector


def detect_frame(frame, conf_threshold=0.3):
    """
    输入：一张图片 (numpy数组)，置信度阈值 (默认0.3)
    输出：检测到的人体关键点列表
    
    大白话：
    - 扔进去一张图片
    - YOLO 模型会告诉你图片里有几个人，分别在哪
    - 返回每个人17个关键点的位置和可信度
    
    输出样例：
    [
      {
        "keypoints": [
          {"x": 320.5, "y": 45.2, "confidence": 0.89},  // nose
          {"x": 310.3, "y": 42.1, "confidence": 0.85},  // left_eye
          {"x": 330.7, "y": 42.5, "confidence": 0.82},  // right_eye
          // ... 17个点全部列出
        ]
      }
    ]
    """
    model = get_detector()
    results = model(frame, conf=conf_threshold, verbose=False)
    
    persons = []
    if results and len(results) > 0:
        result = results[0]
        if result.keypoints is not None:
            keypoints = result.keypoints.data.cpu().numpy()
            for kp_array in keypoints:
                keypoints_list = []
                for kp in kp_array:
                    x, y, conf = kp
                    keypoints_list.append({
                        "x": float(x),
                        "y": float(y),
                        "confidence": float(conf)
                    })
                persons.append({"keypoints": keypoints_list})
    
    return persons


def read_exactly(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            return None
        data.extend(chunk)
    return bytes(data)


def stream_loop(initial_conf=0.3):
    get_detector()
    output = sys.stdout.buffer
    input_stream = sys.stdin.buffer

    while True:
        header = read_exactly(input_stream, 4)
        if header is None:
            break

        payload_size = struct.unpack(">I", header)[0]
        payload = read_exactly(input_stream, payload_size)
        if payload is None:
            break

        request = json.loads(payload.decode("utf-8"))
        image_data = request.get("imageData")
        conf = float(request.get("confThreshold", initial_conf))

        result = {"success": False, "persons": []}
        if image_data:
            image_bytes = base64.b64decode(image_data)
            nparr = np.frombuffer(image_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if frame is not None:
                result = {"success": True, "persons": detect_frame(frame, conf)}
            else:
                result = {"success": False, "error": "Failed to decode frame"}
        else:
            result = {"success": False, "error": "imageData is required"}

        response = json.dumps(result).encode("utf-8")
        output.write(struct.pack(">I", len(response)))
        output.write(response)
        output.flush()


def save_sample(frame, persons, images_dir, labels_dir, sample_idx):
    """
    输入：图片、人体关键点数据、目录路径、样本索引
    输出：无，直接保存到文件
    
    大白话：把一帧图片和对应的标注文件保存到 dataset/ 目录
    """
    img_path = images_dir / f"sample_{sample_idx:04d}.jpg"
    label_path = labels_dir / f"sample_{sample_idx:04d}.txt"
    h, w = frame.shape[:2]
    
    cv2.imwrite(str(img_path), frame)
    
    with open(label_path, 'w') as f:
        for person in persons:
            keypoints = person["keypoints"]
            cx = sum(kp["x"] for kp in keypoints) / len(keypoints) / w
            cy = sum(kp["y"] for kp in keypoints) / len(keypoints) / h
            width = (max(kp["x"] for kp in keypoints) - min(kp["x"] for kp in keypoints)) / w
            height = (max(kp["y"] for kp in keypoints) - min(kp["y"] for kp in keypoints)) / h
            
            f.write(f"0 {cx:.6f} {cy:.6f} {width:.6f} {height:.6f}")
            for kp in keypoints:
                f.write(f" {kp['x']/w:.6f} {kp['y']/h:.6f} {kp['confidence']:.3f}")
            f.write("\n")


def main():
    """
    主入口 - 根据命令行参数决定干哪种活
    
    用法大白话：
    - python pose_detector.py frame 0.3  < 图片二进制    → 检测单张图片
    - python pose_detector.py video 视频路径 0.3 2      → 处理视频，每隔3帧检测一次
    - python pose_detector.py camera 0.3               → 打开摄像头窗口实时显示
    - python pose_detector.py export                    → 把模型转成 ONNX 格式
    - python pose_detector.py dataset 视频路径 0.3     → 从视频里每分钟抽1帧建数据集
    """
    mode = sys.argv[1] if len(sys.argv) > 1 else "video"
    
    if mode == "frame":
        # ====== 检测单张图片 ======
        # 输入：从 stdin 读取图片二进制数据，可选参数：置信度阈值
        # 输出：JSON  {"success": true, "persons": [...]}
        #
        # 大白话：前端传来一张图片，我检测出关键点返回去
        #
        # 输出样例：
        # {"success": true, "persons": [{"keypoints": [{"x": 100, "y": 200, "confidence": 0.9}, ...]}]}
        image_data = sys.stdin.buffer.read()
        nparr = np.frombuffer(image_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        conf = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
        persons = detect_frame(frame, conf)
        
        result = {"success": True, "persons": persons}
        print(json.dumps(result))
    
    elif mode == "video":
        # ====== 处理整个视频 ======
        # 输入：视频路径，可选：置信度阈值、跳帧数
        # 输出：JSON 包含所有帧的检测结果
        #
        # 大白话：读入视频文件，一帧一帧检测，把每帧的17个点位置都记下来
        #
        # 输出样例：
        # {
        #   "success": true,
        #   "total_input_frames": 1800,
        #   "total_output_frames": 1800,
        #   "input_fps": 30.0,
        #   "sampling_rate": "all frames",
        #   "frames": [
        #     {"frame": 0, "output_frame": 0, "persons": [...]},
        #     {"frame": 1, "output_frame": 1, "persons": [...]}
        #   ]
        # }
        if len(sys.argv) < 3:
            print(json.dumps({"error": "用法: python pose_detector.py video <video_path> [conf_threshold] [skip_frames]"}))
            sys.exit(1)
        
        video_path = sys.argv[2]
        conf_threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3
        skip_frames = int(sys.argv[4]) if len(sys.argv) > 4 else 0
        
        if not Path(video_path).exists():
            print(json.dumps({"error": f"文件不存在: {video_path}"}))
            sys.exit(1)
        
        cap = cv2.VideoCapture(video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frames_data = []
        frame_idx = 0
        output_idx = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            if skip_frames == 0 or frame_idx % (skip_frames + 1) == 0:
                persons = detect_frame(frame, conf_threshold)
                frames_data.append({
                    "frame": frame_idx,
                    "output_frame": output_idx,
                    "persons": persons
                })
                output_idx += 1
            
            frame_idx += 1
            
            if fps and frame_idx > 0 and frame_idx % int(60 * fps) == 0:
                print(f"Processed {frame_idx}/{total_frames} frames...", file=sys.stderr, flush=True)
        
        cap.release()
        
        result = {
            "success": True,
            "total_input_frames": total_frames,
            "total_output_frames": len(frames_data),
            "input_fps": fps,
            "frame_width": frame_width,
            "frame_height": frame_height,
            "sampling_rate": f"every {skip_frames + 1} frame(s)" if skip_frames > 0 else "all frames",
            "frames": frames_data
        }
        print(json.dumps(result))
    
    elif mode == "export":
        # ====== 导出模型 ======
        # 输入：无
        # 输出：生成 yolov8n-pose.onnx 文件
        #
        # 大白话：把 PyTorch 模型转成 ONNX 格式，ONNX 可以在网页里跑
        #
        # 输出样例：
        # {"success": true, "message": "ONNX model exported: yolov8n-pose.onnx"}
        model = get_detector()
        model.export(format="onnx", imgsz=320)
        print(json.dumps({"success": True, "message": "ONNX model exported: yolov8n-pose.onnx"}))

    elif mode == "camera":
        # ====== 摄像头实时检测 ======
        # 输入：置信度阈值
        # 输出：弹出一个窗口，实时显示带骨骼的视频，按 q 退出
        #
        # 大白话：打开摄像头，每帧检测并画出来
        #
        # 用法：python pose_detector.py camera [conf_threshold]
        #
        # 输出样例（退出时）：
        # {"success": true, "message": "摄像头已关闭"}
        conf = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
        
        dataset_dir = Path(__file__).parent / "dataset"
        images_dir = dataset_dir / "images"
        labels_dir = dataset_dir / "labels"
        images_dir.mkdir(parents=True, exist_ok=True)
        labels_dir.mkdir(parents=True, exist_ok=True)
        
        print(f"摄像头初始化中 (置信度={conf})...", flush=True)
        print(f"数据集保存到: {dataset_dir}", flush=True)
        
        cap = cv2.VideoCapture(0)
        
        if not cap.isOpened():
            print(json.dumps({"error": "无法打开摄像头"}))
            sys.exit(1)
        
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        
        print(f"摄像头已打开，分辨率: {int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))}x{int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))}", flush=True)
        print("按 'q' 或 'ESC' 退出", flush=True)
        print("按 's' 保存当前帧到数据集", flush=True)
        
        windowName = 'YOLO Pose Detection'
        cv2.namedWindow(windowName, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(windowName, 640, 480)
        
        sample_idx = 0
        frame_idx = 0
        last_save_minute = -1
        frames_per_minute = int(fps * 60)
        
        while True:
            ret, frame = cap.read()
            if not ret:
                print("读取帧失败", flush=True)
                break
            
            persons = detect_frame(frame, conf)
            
            for person in persons:
                keypoints = person["keypoints"]
                
                for i1, i2 in [(5, 6), (5, 7), (7, 9), (6, 8), (8, 10), (5, 11), (6, 12), (11, 12), (11, 13), (13, 15), (12, 14), (14, 16)]:
                    if keypoints[i1]["confidence"] > conf and keypoints[i2]["confidence"] > conf:
                        pt1 = (int(keypoints[i1]["x"]), int(keypoints[i1]["y"]))
                        pt2 = (int(keypoints[i2]["x"]), int(keypoints[i2]["y"]))
                        cv2.line(frame, pt1, pt2, (0, 255, 0), 3)
                
                for i, kp in enumerate(keypoints):
                    if kp["confidence"] > conf:
                        cv2.circle(frame, (int(kp["x"]), int(kp["y"])), 5, (0, 0, 255), -1)
            
            cv2.imshow(windowName, frame)
            
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == 27:
                break
            elif key == ord('s') and persons:
                save_sample(frame, persons, images_dir, labels_dir, sample_idx)
                sample_idx += 1
                print(f"保存样本 {sample_idx}: 检测到 {len(persons)} 人", flush=True)
            
            current_minute = frame_idx // frames_per_minute
            if current_minute > last_save_minute and frame_idx > 0 and persons:
                save_sample(frame, persons, images_dir, labels_dir, sample_idx)
                sample_idx += 1
                last_save_minute = current_minute
                print(f"自动采样样本 {sample_idx} (第 {current_minute} 分钟)", flush=True)
            
            frame_idx += 1
        
        cap.release()
        cv2.destroyAllWindows()
        print(json.dumps({"success": True, "message": f"摄像头已关闭，已保存 {sample_idx} 个样本"}))

    elif mode == "stream":
        conf = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
        stream_loop(conf)


if __name__ == "__main__":
    main()
