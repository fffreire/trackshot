// Copies the tesseract.js worker, its LSTM-only WASM cores and the English model into public/ocr,
// so OCR is served from this app instead of a CDN.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const dir = (pkg) => dirname(require.resolve(`${pkg}/package.json`));
const out = join(import.meta.dirname, "..", "public", "ocr");

const files = [
  [join(dir("tesseract.js"), "dist/worker.min.js"), "worker.min.js"],
  // The worker picks one of these by browser support (relaxed SIMD, SIMD, plain); each embeds its WASM.
  ...["relaxedsimd-lstm", "simd-lstm", "lstm"].map((core) => [
    join(dir("tesseract.js-core"), `tesseract-core-${core}.wasm.js`),
    `tesseract-core-${core}.wasm.js`,
  ]),
  [join(dir("@tesseract.js-data/eng"), "4.0.0_best_int/eng.traineddata.gz"), "eng.traineddata.gz"],
];

mkdirSync(out, { recursive: true });
for (const [from, to] of files) copyFileSync(from, join(out, to));
console.log(`Copied ${files.length} OCR files to public/ocr`);
