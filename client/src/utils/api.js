const API_BASE = import.meta.env.BASE_URL || '/yolo/';

export const API_ENDPOINTS = {
  status: `${API_BASE}api/status`,
  upload: `${API_BASE}api/upload`,
  processVideo: `${API_BASE}api/process-video`,
  detectFrame: `${API_BASE}api/detect-frame`,
  saveDataset: `${API_BASE}api/save-dataset`
};

export function getFullUrl(path) {
  if (path.startsWith('http')) return path;
  if (path.startsWith('/')) return path;
  return `${API_BASE}${path}`;
}
