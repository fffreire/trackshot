import { createWorker } from "tesseract.js";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

export type ImageValidation = { ok: true } | { ok: false; error: string };

export function validateImage(file: File): ImageValidation {
  if (!ACCEPTED_TYPES.includes(file.type)) return { ok: false, error: "Please upload a PNG, JPEG or WebP image." };
  if (file.size > MAX_BYTES) return { ok: false, error: "This image is larger than 10 MB. Try a smaller screenshot." };
  return { ok: true };
}

// OCR runs entirely in the browser; the image is never uploaded.
// The worker, WASM core and English model are served by this app from /ocr (see scripts/ocr-assets.mjs), not a CDN.
export async function readImage(file: File, onProgress?: (pct: number) => void): Promise<string> {
  const worker = await createWorker("eng", undefined, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr",
    langPath: "/ocr",
    logger: (message) => {
      if (message.status === "recognizing text") onProgress?.(Math.round(message.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(file);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
