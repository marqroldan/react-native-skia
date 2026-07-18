import { itRunsE2eOnly } from "../../../__tests__/setup";
import type { Skia as SkiaApi, SkCanvas } from "../../../skia/types";
import { surface } from "../setup";

import { PDF_SCENES } from "./setup/pdf-scenes";
import type { PDFScene } from "./setup/pdf-scenes";
import {
  decodePng,
  diffImages,
  rasterizePdfPage,
  rgbaToPngBuffer,
  writeParityArtifacts,
} from "./setup/pdf-parity";
import { parsePdf } from "./setup/pdf-utils";

/**
 * Skia → PDF conformance/parity suite.
 *
 * For every scene in pdf-scenes.ts, ONE `surface.eval` on the device:
 *   1. revives the scene's draw source (`eval("(" + drawSrc + ")")` — the
 *      same mechanism the harness itself uses to revive this callback, see
 *      apps/example/src/Tests/Tests.tsx),
 *   2. renders it onto a white offscreen surface at scale 1 (page points ==
 *      pixels) and snapshots it as the raster reference PNG, and
 *   3. renders the SAME function onto a PDF page of identical size.
 *
 * The host then rasterizes the PDF page with pdfjs at the reference's pixel
 * size and pixel-diffs the two renderings, plus runs structural quality
 * gates (image count, text extraction, font embedding, size budget) via
 * parsePdf. The single-draw-function design guarantees a failure is a
 * backend divergence, not a scene-authoring divergence.
 */

/**
 * Default tolerance for pure-vector scenes (percent of page pixels).
 *
 * Both renderings describe identical resolution-independent geometry, so the
 * only legitimate differences are edge rasterization and color rounding.
 * blazediff already excludes detected anti-aliased pixels, but Skia and
 * pdfjs disagree on more than the 1px AA fringe for hairline-adjacent
 * geometry, dash phase rounding, and gradient interpolation, so 5% gives
 * headroom without masking real defects (a missing/misplaced shape on these
 * scenes moves the diff by well over 5%).
 */
const VECTOR_TOLERANCE_PCT = 5;

/**
 * Default tolerance for text, raster-fallback and mixed scenes.
 *
 * Text: glyph rasterization differs legitimately between the device's Skia
 * raster backend and pdfjs's font renderer (hinting, stem darkening, subpixel
 * positioning) — every glyph edge lands slightly differently. Raster
 * fallback: SkPDF rasterizes at metadata.rasterDPI (default 300) and the
 * result is resampled to page resolution by pdfjs, spreading 1-2 value
 * differences across large areas. 12% absorbs both while still failing
 * loudly when content is missing, misplaced, or rendered as .notdef boxes.
 */
const FALLBACK_TOLERANCE_PCT = 12;

const toleranceFor = (scene: PDFScene) => {
  if (scene.tolerancePct !== undefined) {
    return scene.tolerancePct;
  }
  return scene.expected === "vector" && !scene.expectsText
    ? VECTOR_TOLERANCE_PCT
    : FALLBACK_TOLERANCE_PCT;
};

interface SceneRenderResult {
  refPng: string;
  pdf: string;
  genMs: number;
}

describe("PDF parity", () => {
  PDF_SCENES.forEach((scene) => {
    itRunsE2eOnly(`${scene.key}: ${scene.title}`, async () => {
      const result = await surface.eval<
        { drawSrc: string; width: number; height: number },
        SceneRenderResult
      >(
        (Skia, ctx) => {
          // The draw function arrives as source text because eval callbacks
          // cannot close over anything (see pdf-scenes.ts module docs).
          const draw = eval(`(${ctx.drawSrc})`) as (
            skiaApi: SkiaApi,
            target: SkCanvas
          ) => void;

          // (a) Raster reference: white-backed offscreen surface, scale 1.
          const offscreen = Skia.Surface.MakeOffscreen(ctx.width, ctx.height);
          if (!offscreen) {
            throw new Error("Could not create the reference offscreen surface");
          }
          const rasterCanvas = offscreen.getCanvas();
          rasterCanvas.drawColor(Skia.Color("white"));
          draw(Skia, rasterCanvas);
          offscreen.flush();
          const refPng = offscreen.makeImageSnapshot().encodeToBase64();

          // (b) PDF page of identical size, driven by the SAME function. The
          // white background is part of the harness and is applied to both
          // targets so the recorded operations stay strictly identical.
          const start = Date.now();
          const doc = Skia.PDF.MakeDocument();
          const pageCanvas = doc.beginPage(ctx.width, ctx.height);
          pageCanvas.drawColor(Skia.Color("white"));
          draw(Skia, pageCanvas);
          doc.endPage();
          doc.close();
          const pdf = doc.getBase64();
          const genMs = Date.now() - start;

          return { refPng, pdf, genMs };
        },
        { drawSrc: scene.draw, width: scene.width, height: scene.height }
      );

      const refPngBuffer = Buffer.from(result.refPng, "base64");
      const pdfBytes = Buffer.from(result.pdf, "base64");
      const ref = decodePng(refPngBuffer);
      expect(ref.width).toBe(scene.width);
      expect(ref.height).toBe(scene.height);

      // Rasterize + diff, writing artifacts BEFORE any quality gate so every
      // scene leaves visual evidence regardless of pass/fail. If pdfjs cannot
      // even rasterize the page, at least the reference is preserved.
      let diffPct: number;
      try {
        const pdfRaster = await rasterizePdfPage(
          result.pdf,
          0,
          ref.width,
          ref.height
        );
        const { diffPct: measuredDiffPct, heatmapPng } = diffImages(
          ref,
          pdfRaster
        );
        diffPct = measuredDiffPct;
        writeParityArtifacts(
          scene.key,
          refPngBuffer,
          rgbaToPngBuffer(pdfRaster),
          heatmapPng
        );
      } catch (e) {
        writeParityArtifacts(scene.key, refPngBuffer, Buffer.alloc(0));
        throw e;
      }

      const parsed = await parsePdf(result.pdf);
      expect(parsed.numPages).toBe(1);
      const [page] = parsed.pages;
      expect(page.width).toBe(scene.width);
      expect(page.height).toBe(scene.height);

      console.log(
        `[pdf-parity] ${scene.key}: diff=${diffPct.toFixed(2)}% ` +
          `images=${page.imageCount} bytes=${pdfBytes.length} ` +
          `genMs=${result.genMs}`
      );

      // Pixel parity.
      expect(diffPct).toBeLessThanOrEqual(toleranceFor(scene));

      // Structural quality gates.
      if (scene.expected === "vector") {
        expect(page.imageCount).toBe(0);
      } else if (scene.expected === "raster-fallback") {
        expect(page.imageCount).toBeGreaterThanOrEqual(1);
      }
      // "mixed": intentionally no image-count assertion (see PDFScene docs).

      if (scene.expectsText) {
        expect(page.text.length).toBeGreaterThan(0);
        expect(page.fonts.length).toBeGreaterThanOrEqual(1);
        page.fonts.forEach((font) => {
          // Type3 fonts (e.g. bitmap emoji) carry their glyph programs as
          // PDF content streams instead of an embedded font file; pdfjs has
          // no FontFile to report for them, so they count as embedded.
          expect(font.embedded || font.isType3Font).toBe(true);
        });
      }

      if (scene.sizeBudgetBytes !== undefined) {
        expect(pdfBytes.length).toBeLessThanOrEqual(scene.sizeBudgetBytes);
      }
    });
  });
});
