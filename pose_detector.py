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
import traceback
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
mp_hands_module = None

SKELETON = [
    (0, 1), (0, 2), (1, 3), (2, 4),
    (5, 6),
    (5, 7), (7, 9),
    (6, 8), (8, 10),
    (5, 11), (6, 12),
    (11, 12),
    (11, 13), (13, 15),
    (12, 14), (14, 16)
]

HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (0, 9), (9, 10), (10, 11), (11, 12),
    (0, 13), (13, 14), (14, 15), (15, 16),
    (0, 17), (17, 18), (18, 19), (19, 20),
    (5, 9), (9, 13), (13, 17)
]

HAND_TIPS = {
    4: "T",
    8: "I",
    12: "M",
    16: "R",
    20: "P"
}


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


def get_hands_detector():
    global mp_hands_module
    if mp_hands_module is False:
        return None
    if mp_hands_module is None:
        try:
            import mediapipe as mp
            mp_hands_module = mp.solutions.hands
        except Exception as error:
            print(f"MediaPipe Hands unavailable: {error}", file=sys.stderr, flush=True)
            mp_hands_module = False
            return None
    return mp_hands_module


def detect_hands(frame, hands_detector):
    if hands_detector is None:
        return []

    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = hands_detector.process(rgb_frame)
    if not results.multi_hand_landmarks:
        return []

    hands = []
    h, w = frame.shape[:2]
    handedness = results.multi_handedness or []
    for index, hand_landmarks in enumerate(results.multi_hand_landmarks):
        label = ""
        score = 0.0
        if index < len(handedness) and handedness[index].classification:
            cls = handedness[index].classification[0]
            label = cls.label
            score = float(cls.score)

        keypoints = []
        for landmark in hand_landmarks.landmark:
            keypoints.append({
                "x": float(landmark.x * w),
                "y": float(landmark.y * h),
                "z": float(landmark.z),
                "confidence": score
            })
        hands.append({"label": label, "confidence": score, "keypoints": keypoints})
    return hands


def estimate_missing_hand_joints(persons, detected_hands, conf_threshold=0.3):
    estimated = []
    existing_wrists = []
    for hand in detected_hands:
        keypoints = hand.get("keypoints", [])
        if keypoints:
            existing_wrists.append(np.array([keypoints[0]["x"], keypoints[0]["y"]], dtype=np.float32))

    for person_idx, person in enumerate(persons):
        keypoints = person.get("keypoints", [])
        for label, wrist_idx, elbow_idx, direction_sign in (("Left", 9, 7, -1), ("Right", 10, 8, 1)):
            if wrist_idx >= len(keypoints):
                continue
            wrist = keypoints[wrist_idx]
            if wrist.get("confidence", 0) <= conf_threshold:
                continue

            wrist_xy = np.array([wrist["x"], wrist["y"]], dtype=np.float32)
            if any(np.linalg.norm(wrist_xy - existing) < 90 for existing in existing_wrists):
                continue

            if elbow_idx < len(keypoints) and keypoints[elbow_idx].get("confidence", 0) > conf_threshold:
                elbow = keypoints[elbow_idx]
                forward = wrist_xy - np.array([elbow["x"], elbow["y"]], dtype=np.float32)
            else:
                forward = np.array([0, -1], dtype=np.float32)
            norm = np.linalg.norm(forward)
            if norm < 1:
                forward = np.array([0, -1], dtype=np.float32)
            else:
                forward = forward / norm

            side = np.array([-forward[1], forward[0]], dtype=np.float32) * direction_sign
            body_scale = 70.0
            if len(keypoints) > 6:
                left_shoulder = keypoints[5]
                right_shoulder = keypoints[6]
                if left_shoulder.get("confidence", 0) > conf_threshold and right_shoulder.get("confidence", 0) > conf_threshold:
                    body_scale = max(
                        np.linalg.norm(
                            np.array([left_shoulder["x"], left_shoulder["y"]], dtype=np.float32) -
                            np.array([right_shoulder["x"], right_shoulder["y"]], dtype=np.float32)
                        ) * 0.32,
                        38.0
                    )

            hand_points = [{"x": float(wrist_xy[0]), "y": float(wrist_xy[1]), "z": 0.0, "confidence": wrist["confidence"]}]
            finger_bases = [
                (-0.48, 0.62, [0.42, 0.36, 0.30, 0.25]),
                (-0.22, 0.92, [0.38, 0.32, 0.28, 0.23]),
                (0.00, 1.00, [0.42, 0.36, 0.31, 0.25]),
                (0.22, 0.90, [0.39, 0.33, 0.28, 0.23]),
                (0.44, 0.72, [0.34, 0.28, 0.24, 0.20])
            ]
            for spread, reach, segments in finger_bases:
                base = wrist_xy + side * (spread * body_scale) + forward * (0.16 * body_scale)
                finger_dir = forward * reach + side * (spread * 0.22)
                finger_dir = finger_dir / max(np.linalg.norm(finger_dir), 1.0)
                current = base
                for length in segments:
                    current = current + finger_dir * (length * body_scale)
                    hand_points.append({
                        "x": float(current[0]),
                        "y": float(current[1]),
                        "z": 0.0,
                        "confidence": wrist["confidence"]
                    })

            estimated.append({
                "label": label,
                "confidence": wrist["confidence"],
                "estimated": True,
                "person_index": person_idx,
                "keypoints": hand_points
            })

    return detected_hands + estimated


def create_hands_detector(static_image_mode=False):
    hands_module = get_hands_detector()
    if not hands_module:
        return None
    return hands_module.Hands(
        static_image_mode=static_image_mode,
        max_num_hands=4,
        model_complexity=1,
        min_detection_confidence=0.25,
        min_tracking_confidence=0.25
    )


def draw_annotations(frame, persons, hands, conf_threshold=0.3):
    annotated = frame.copy()

    for person_idx, person in enumerate(persons):
        keypoints = person.get("keypoints", [])
        color = ((37 + person_idx * 53) % 255, (211 + person_idx * 47) % 255, (102 + person_idx * 31) % 255)
        for a, b in SKELETON:
            if a >= len(keypoints) or b >= len(keypoints):
                continue
            kp_a = keypoints[a]
            kp_b = keypoints[b]
            if kp_a["confidence"] > conf_threshold and kp_b["confidence"] > conf_threshold:
                cv2.line(
                    annotated,
                    (int(kp_a["x"]), int(kp_a["y"])),
                    (int(kp_b["x"]), int(kp_b["y"])),
                    color,
                    3
                )
        for kp in keypoints:
            if kp["confidence"] > conf_threshold:
                cv2.circle(annotated, (int(kp["x"]), int(kp["y"])), 5, color, -1)
                cv2.circle(annotated, (int(kp["x"]), int(kp["y"])), 7, (255, 255, 255), 1)

    for hand_idx, hand in enumerate(hands):
        keypoints = hand.get("keypoints", [])
        color = (255, 183, 3) if hand.get("label") == "Left" else (251, 86, 7)
        for a, b in HAND_CONNECTIONS:
            if a < len(keypoints) and b < len(keypoints):
                pt_a = (int(keypoints[a]["x"]), int(keypoints[a]["y"]))
                pt_b = (int(keypoints[b]["x"]), int(keypoints[b]["y"]))
                cv2.line(annotated, pt_a, pt_b, (0, 0, 0), 5)
                cv2.line(
                    annotated,
                    pt_a,
                    pt_b,
                    color,
                    3
                )
        for point_idx, kp in enumerate(keypoints):
            point = (int(kp["x"]), int(kp["y"]))
            cv2.circle(annotated, point, 7, (0, 0, 0), -1)
            cv2.circle(annotated, point, 5, color, -1)
            cv2.circle(annotated, point, 7, (255, 255, 255), 1)
            label = HAND_TIPS.get(point_idx)
            if label:
                cv2.putText(
                    annotated,
                    label,
                    (int(kp["x"]) + 4, int(kp["y"]) - 4),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.45,
                    (255, 255, 255),
                    1,
                    cv2.LINE_AA
                )
        if keypoints:
            cv2.putText(
                annotated,
                f"{hand.get('label') or 'Hand'} {hand_idx + 1}{' est' if hand.get('estimated') else ''}",
                (int(keypoints[0]["x"]) + 6, int(keypoints[0]["y"]) + 18),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                color,
                2,
                cv2.LINE_AA
            )

    return annotated


def read_exactly(stream, size):
    data = bytearray()
    while len(data) < size:
        chunk = stream.read(size - len(data))
        if not chunk:
            return None
        data.extend(chunk)
    return bytes(data)


def stream_loop(initial_conf=0.3):
    output = sys.stdout.buffer
    input_stream = sys.stdin.buffer
    hands_detector = create_hands_detector(static_image_mode=False)
    if hands_detector:
        print("MediaPipe Hands enabled for realtime stream", file=sys.stderr, flush=True)

    while True:
        try:
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
                    persons = detect_frame(frame, conf)
                    hands = detect_hands(frame, hands_detector) if hands_detector else []
                    hands = estimate_missing_hand_joints(persons, hands, conf)
                    result = {"success": True, "persons": persons, "hands": hands}
                else:
                    result = {"success": False, "error": "Failed to decode frame"}
            else:
                result = {"success": False, "error": "imageData is required"}
        except Exception as error:
            print(f"stream request error: {error}", file=sys.stderr, flush=True)
            result = {"success": False, "error": str(error)}

        response = json.dumps(result).encode("utf-8")
        output.write(struct.pack(">I", len(response)))
        output.write(response)
        output.flush()

    if hands_detector:
        hands_detector.close()


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
        if frame is None:
            print(json.dumps({"success": False, "error": "Failed to decode frame"}))
            sys.exit(0)
        
        conf = float(sys.argv[2]) if len(sys.argv) > 2 else 0.3
        persons = detect_frame(frame, conf)
        hands_detector = create_hands_detector(static_image_mode=True)
        hands = detect_hands(frame, hands_detector) if hands_detector else []
        hands = estimate_missing_hand_joints(persons, hands, conf)
        if hands_detector:
            hands_detector.close()
        
        result = {"success": True, "persons": persons, "hands": hands}
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
        skip_frames = int(sys.argv[4]) if len(sys.argv) > 4 else -1
        target_fps = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
        annotated_video_path = sys.argv[6] if len(sys.argv) > 6 else None
        
        if not Path(video_path).exists():
            print(json.dumps({"error": f"文件不存在: {video_path}"}))
            sys.exit(1)
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print(f"Failed to open video: {video_path}", file=sys.stderr, flush=True)
            print(json.dumps({"error": f"无法打开视频文件: {video_path}"}))
            sys.exit(2)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = cap.get(cv2.CAP_PROP_FPS)
        frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        auto_sample = skip_frames < 0
        if auto_sample:
            target_fps = max(target_fps, 0.1)
            skip_frames = max(int(round((fps or target_fps) / target_fps)) - 1, 0)
        print(
            f"Video opened path={video_path} frames={total_frames} fps={fps} size={frame_width}x{frame_height} conf={conf_threshold} skip={skip_frames} auto_sample={auto_sample} target_fps={target_fps}",
            file=sys.stderr,
            flush=True
        )
        writer = None
        hands_detector = None
        if annotated_video_path:
            output_fps = fps or target_fps or 1.0
            if skip_frames > 0:
                output_fps = max(output_fps / (skip_frames + 1), 1.0)
            if auto_sample:
                output_fps = min(max(target_fps, 1.0), fps or target_fps or 1.0)
            Path(annotated_video_path).parent.mkdir(parents=True, exist_ok=True)
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(annotated_video_path, fourcc, output_fps, (frame_width, frame_height))
            if not writer.isOpened():
                print(f"Failed to create annotated video: {annotated_video_path}", file=sys.stderr, flush=True)
                writer = None
            hands_detector = create_hands_detector(static_image_mode=False)
            if hands_detector:
                print("MediaPipe Hands enabled for hand joints", file=sys.stderr, flush=True)
        frames_data = []
        frame_idx = 0
        output_idx = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            
            if skip_frames == 0 or frame_idx % (skip_frames + 1) == 0:
                try:
                    persons = detect_frame(frame, conf_threshold)
                    hands = detect_hands(frame, hands_detector) if hands_detector else []
                    hands = estimate_missing_hand_joints(persons, hands, conf_threshold)
                except Exception:
                    print(f"Detection failed at frame={frame_idx}", file=sys.stderr, flush=True)
                    traceback.print_exc(file=sys.stderr)
                    if hands_detector:
                        hands_detector.close()
                    if writer:
                        writer.release()
                    cap.release()
                    sys.exit(1)
                frames_data.append({
                    "frame": frame_idx,
                    "output_frame": output_idx,
                    "persons": persons,
                    "hands": hands
                })
                if writer:
                    writer.write(draw_annotations(frame, persons, hands, conf_threshold))
                output_idx += 1
                if output_idx == 1 or output_idx % 10 == 0:
                    print(
                        f"Detected output_frames={output_idx} input_frame={frame_idx}/{total_frames} persons={len(persons)} hands={len(hands)}",
                        file=sys.stderr,
                        flush=True
                    )
            
            frame_idx += 1
            
            if fps and frame_idx > 0 and frame_idx % int(60 * fps) == 0:
                print(f"Processed {frame_idx}/{total_frames} frames...", file=sys.stderr, flush=True)
        
        cap.release()
        if hands_detector:
            hands_detector.close()
        if writer:
            writer.release()
        
        result = {
            "success": True,
            "total_input_frames": total_frames,
            "total_output_frames": len(frames_data),
            "input_fps": fps,
            "frame_width": frame_width,
            "frame_height": frame_height,
            "sampling_rate": f"target {target_fps:g} fps" if auto_sample else (f"every {skip_frames + 1} frame(s)" if skip_frames > 0 else "all frames"),
            "annotated_video_path": annotated_video_path,
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
