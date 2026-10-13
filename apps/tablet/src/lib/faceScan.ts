import { FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import type { FaceSample } from '@swag/avatar';

// "Créer mon avatar" camera step. Everything runs on the tablet: the WebAssembly engine and the
// face model ship with the app (no CDN), the frame is analysed in memory and only a few
// numbers come out (two average colours and two ratios). Nothing is uploaded or saved.
// This file is loaded on demand, so the 13 MB engine is only read when the camera is used.

let landmarker: Promise<FaceLandmarker> | null = null;

function getLandmarker() {
  landmarker ??= FaceLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate: 'CPU' },
      runningMode: 'IMAGE',
      numFaces: 1,
    },
  ).catch((err: unknown) => {
    landmarker = null;
    throw err;
  });
  return landmarker;
}

/** Starts loading the engine while the child is still placing their face. */
export const preloadFaceScan = () => void getLandmarker().catch(() => undefined);

// Face mesh points (https://github.com/google-ai-edge/mediapipe face_mesh map).
const FOREHEAD = 10;
const CHIN = 152;
const CHEEKBONE_L = 234;
const CHEEKBONE_R = 454;
const JAW_L = 172;
const JAW_R = 397;
const CHEEK_L = 50;
const CHEEK_R = 280;

/** Analyses one video frame. Returns null when no face is clearly visible. */
export async function scanFace(video: HTMLVideoElement): Promise<FaceSample | null> {
  const lm = await getLandmarker();
  const w = video.videoWidth;
  const h = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0, w, h);

  try {
    const points = lm.detect(canvas).faceLandmarks[0];
    if (!points) return null;
    const at = (i: number) => ({ x: points[i]!.x * w, y: points[i]!.y * h });
    const dist = (a: number, b: number) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);

    const faceW = dist(CHEEKBONE_L, CHEEKBONE_R);
    const faceH = dist(FOREHEAD, CHIN);
    if (faceW < w * 0.15) return null; // too far away to read colours reliably

    const r = Math.max(3, Math.round(faceW * 0.04));
    const average = (x: number, y: number): [number, number, number] | null => {
      const x0 = Math.round(x - r);
      const y0 = Math.round(y - r);
      if (x0 < 0 || y0 < 0 || x0 + 2 * r > w || y0 + 2 * r > h) return null;
      const d = ctx.getImageData(x0, y0, 2 * r, 2 * r).data;
      let [sr, sg, sb] = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) [sr, sg, sb] = [sr + d[i]!, sg + d[i + 1]!, sb + d[i + 2]!];
      const n = d.length / 4;
      return [sr / n, sg / n, sb / n];
    };

    const left = average(at(CHEEK_L).x, at(CHEEK_L).y);
    const right = average(at(CHEEK_R).x, at(CHEEK_R).y);
    if (!left || !right) return null;
    // Just above the forehead, along the chin -> forehead line.
    const top = at(FOREHEAD);
    const chin = at(CHIN);
    const hair = average(top.x + (top.x - chin.x) * 0.12, top.y + (top.y - chin.y) * 0.12);

    return {
      skin: [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2],
      hair,
      widthToHeight: faceW / faceH,
      jawToCheek: dist(JAW_L, JAW_R) / faceW,
    };
  } finally {
    // Drop the frame straight away.
    ctx.clearRect(0, 0, w, h);
    canvas.width = 0;
    canvas.height = 0;
  }
}
