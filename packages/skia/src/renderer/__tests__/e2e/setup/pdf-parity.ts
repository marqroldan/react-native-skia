import fs from "fs";
import path from "path";

import { PNG } from "pngjs";
import blazediff from "@blazediff/core";
import type * as Pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type * as NapiCanvas from "@napi-rs/canvas";

// pdfjs-dist v6 ships ESM-only builds that use import.meta, which Jest's
// sandboxed CommonJS runtime cannot parse (and Jest also wraps createRequire,
// so requiring through "module" hits the same sandbox). Node >= 22.12 can
// require() synchronous ESM graphs natively, so we grab the genuine
// node:module via process.getBuiltinModule — the one escape hatch Jest cannot
// intercept — and load pdfjs with Node's own require. (Same pattern as
// pdf-utils.ts.)
//
// @napi-rs/canvas is loaded through the same native require so that we share
// the exact module instance pdfjs's own NodeCanvasFactory resolves when it
// needs auxiliary canvases during page rendering.
const nativeRequire = process
  .getBuiltinModule("module")
  .createRequire(__filename);
const { getDocument } = nativeRequire(
  "pdfjs-dist/legacy/build/pdf.mjs"
) as typeof Pdfjs;
const { createCanvas } = nativeRequire("@napi-rs/canvas") as typeof NapiCanvas;

export interface RGBAImage {
  /** Tightly packed RGBA, 4 bytes per pixel. */
  data: Uint8ClampedArray | Uint8Array | Buffer;
  width: number;
  height: number;
}

export interface ImageDiffResult {
  /** Differing pixels as a percentage of total pixels (0–100). */
  diffPct: number;
  /** Encoded PNG visualization: red = differing, yellow = anti-aliased. */
  heatmapPng?: Buffer;
}

/**
 * Rasterizes one page of a base64-encoded PDF to raw RGBA using pdfjs-dist
 * (legacy Node build) with @napi-rs/canvas as the render target. pdfjs
 * renders on a white background by default, matching the white-backed raster
 * reference produced on the device.
 *
 * The caller controls the scale by choosing targetW/targetH (the parity spec
 * passes the reference PNG's pixel size, i.e. scale 1: page points == px).
 */
export const rasterizePdfPage = async (
  base64: string,
  pageIndex: number,
  targetW: number,
  targetH: number
): Promise<RGBAImage> => {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(pageIndex + 1);
    const base = page.getViewport({ scale: 1 });
    const scaleX = targetW / base.width;
    const scaleY = targetH / base.height;
    if (Math.abs(scaleX - scaleY) > 1e-3) {
      throw new Error(
        `Target size ${targetW}x${targetH} does not preserve the page aspect ` +
          `ratio (${base.width}x${base.height})`
      );
    }
    const viewport = page.getViewport({ scale: scaleX });
    const canvas = createCanvas(targetW, targetH);
    // pdfjs 6.x accepts the canvas object directly (it is what its own
    // NodeCanvasFactory produces); the HTMLCanvasElement type is DOM-only.
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
    }).promise;
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, targetW, targetH);
    return {
      data: new Uint8ClampedArray(imageData.data),
      width: targetW,
      height: targetH,
    };
  } finally {
    await loadingTask.destroy();
  }
};

/**
 * Pixel-diffs two same-sized RGBA images with @blazediff/core — the same
 * comparator checkImage (src/__tests__/setup.ts) uses for raster snapshot
 * tests — and returns the differing-pixel percentage plus an encoded PNG
 * heatmap. Anti-aliased pixels are detected and excluded from the count
 * (blazediff default), which is exactly what a cross-rasterizer comparison
 * needs: Skia and pdfjs never anti-alias edges identically.
 *
 * Dimensions must already match; scaling is the caller's responsibility
 * (rasterizePdfPage takes the target size for that reason).
 */
export const diffImages = (
  a: RGBAImage,
  b: RGBAImage,
  options?: { threshold?: number }
): ImageDiffResult => {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `Image sizes don't match: ${a.width}x${a.height} vs ${b.width}x${b.height}`
    );
  }
  const heatmap = new PNG({ width: a.width, height: a.height });
  const diffPixels = blazediff(
    a.data,
    b.data,
    heatmap.data,
    a.width,
    a.height,
    {
      // Same perceptual threshold as checkImage's default.
      threshold: options?.threshold ?? 0.1,
      // The buffers come from two different decoders and are never literally
      // identical; skip the Buffer.compare fast path (which also chokes on
      // mixed Buffer/Uint8ClampedArray inputs).
      fastBufferCheck: false,
    }
  );
  return {
    diffPct: (diffPixels / (a.width * a.height)) * 100,
    heatmapPng: PNG.sync.write(heatmap),
  };
};

/** Encodes a raw RGBA image as a PNG buffer (for artifact output). */
export const rgbaToPngBuffer = (image: RGBAImage): Buffer => {
  const png = new PNG({ width: image.width, height: image.height });
  Buffer.from(
    image.data.buffer,
    image.data.byteOffset,
    image.data.byteLength
  ).copy(png.data);
  return PNG.sync.write(png);
};

/** Decodes a PNG buffer to raw RGBA (pngjs). */
export const decodePng = (buffer: Buffer): RGBAImage => {
  const png = PNG.sync.read(buffer);
  return { data: png.data, width: png.width, height: png.height };
};

/**
 * Default artifact directory. NOTE: packages/skia has no .gitignore, so this
 * directory shows up as untracked output — it is debug evidence only and is
 * not meant to be committed (add `src/renderer/__tests__/e2e/__pdf_parity__/`
 * to a .gitignore if one is ever introduced).
 */
export const PDF_PARITY_ARTIFACT_DIR = path.resolve(
  __dirname,
  "..",
  "__pdf_parity__"
);

/**
 * Writes the three per-scene artifacts — device raster reference, pdfjs
 * rasterization of the PDF page, and the diff heatmap — as
 * `<key>-{ref,pdf,heatmap}.png`. Called for every scene regardless of
 * pass/fail so failures always come with visual evidence.
 */
export const writeParityArtifacts = (
  key: string,
  refPng: Buffer,
  pdfPng: Buffer,
  heatmapPng?: Buffer,
  dir: string = PDF_PARITY_ARTIFACT_DIR
) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}-ref.png`), refPng);
  fs.writeFileSync(path.join(dir, `${key}-pdf.png`), pdfPng);
  if (heatmapPng) {
    fs.writeFileSync(path.join(dir, `${key}-heatmap.png`), heatmapPng);
  }
  return dir;
};
