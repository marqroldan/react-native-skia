/**
 * Scene registry for the Skia → PDF conformance/parity harness
 * (PDFParity.spec.tsx).
 *
 * ## Design: one draw function per scene, shipped as source text
 *
 * The core invariant of the harness is that a single draw function drives
 * BOTH outputs compared by a test:
 *
 *   1. the raster reference — an offscreen surface snapshot (PNG), and
 *   2. the PDF page — Skia.PDF.MakeDocument() → beginPage() → endPage(),
 *
 * so any parity failure is a backend difference, never a scene-authoring
 * difference.
 *
 * Both renderings happen ON THE DEVICE inside a single `surface.eval()`
 * call (the host never draws). `surface.eval` serializes its callback with
 * `Function.prototype.toString()` and the example app revives it with
 * `eval` — which means the callback cannot close over ANYTHING from this
 * module: no imports, no enums, no helper functions, only its `(Skia, ctx)`
 * parameters. A registry of plain functions therefore cannot be passed to
 * the eval callback; it would arrive as a dead reference.
 *
 * Instead each scene stores the BODY of its draw function as source text: a
 * plain-JS arrow function `(Skia, canvas) => { ... }` inside a template
 * string. The spec forwards it through the JSON-serializable eval context
 * (`ctx.drawSrc`) and the device revives it with
 * `eval("(" + ctx.drawSrc + ")")` — the exact mechanism the harness itself
 * uses one level up (see apps/example/src/Tests/Tests.tsx), so it is proven
 * to work on Hermes with the test app's eval support.
 *
 * ## Authoring rules for `draw` sources
 *
 * - Plain JavaScript only. The text is NEVER transpiled — no TypeScript
 *   annotations, no non-Hermes syntax. (Arrows, const/let, default args and
 *   template literals are all fine on Hermes; avoid backticks anyway so the
 *   surrounding template string stays trivial.)
 * - Self-contained: only `Skia` and `canvas` are in scope. Enum values from
 *   `skia/types` are NOT available — inline their numeric values with a
 *   trailing comment (e.g. `paint.setStyle(1 /* PaintStyle.Stroke *\/)`).
 *   The values used below are verified against src/skia/types.
 * - ASCII only. Non-ASCII text (CJK, emoji) must be produced at runtime via
 *   `String.fromCodePoint(...)` — non-BMP literals do not survive the
 *   JSON/eval round-trip reliably, and keeping the source pure ASCII avoids
 *   the problem entirely.
 * - Deterministic: no Date.now(), no Math.random(), no async.
 * - No assets: images must be created in-memory
 *   (Skia.Surface.MakeOffscreen → snapshot) inside the draw function.
 * - The same function runs against a raster canvas AND a PDF page canvas;
 *   don't call surface- or document-level APIs from inside it.
 */

export interface PDFScene {
  key: string;
  title: string;
  concept: string;
  /** Page size in PDF points; the raster reference uses the same px at scale 1. */
  width: number;
  height: number;
  /**
   * How SkPDF is expected to encode the content:
   * - "vector": pure vector output — the parsed page must contain 0 images.
   * - "raster-fallback": at least one image XObject is expected, either
   *   because the scene intentionally embeds an image or because PDF cannot
   *   express the feature and SkPDF rasterizes it (at metadata.rasterDPI).
   * - "mixed": no image-count assertion — e.g. color-emoji glyphs may be
   *   encoded as Type3/bitmap fonts, as inline images, or subset out
   *   depending on the platform emoji font.
   */
  expected: "vector" | "raster-fallback" | "mixed";
  /** Text must be extractable from the PDF and all fonts embedded. */
  expectsText?: boolean;
  /** Per-scene diff tolerance override (percent of page pixels; default is harness-level). */
  tolerancePct?: number;
  /** Sanity budget for the finalized document size. */
  sizeBudgetBytes?: number;
  /** BODY of a `(Skia, canvas) => void` function, as source text (see module docs). */
  draw: string;
}

/**
 * Most scenes use a small square page: it keeps the eval payloads (two
 * base64 blobs per scene) and the pixel diffs cheap while remaining large
 * enough for AA behavior to be representative.
 */
const PAGE = 256;

export const PDF_SCENES: PDFScene[] = [
  {
    key: "shapes-basic",
    title: "Basic shape fills",
    concept: "drawRect / drawRRect / drawCircle / drawOval",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const fill = (color) => {
        const p = Skia.Paint();
        p.setColor(Skia.Color(color));
        return p;
      };
      canvas.drawRect(Skia.XYWHRect(16, 16, 96, 72), fill("#c62828"));
      canvas.drawRRect(
        Skia.RRectXY(Skia.XYWHRect(144, 16, 96, 72), 16, 16),
        fill("#1565c0")
      );
      canvas.drawCircle(64, 184, 48, fill("#2e7d32"));
      canvas.drawOval(Skia.XYWHRect(144, 148, 96, 72), fill("#f9a825"));
    }`,
  },
  {
    key: "paths-arcs",
    title: "Path segments and arcs",
    concept: "moveTo / lineTo / quadTo / cubicTo / arcToOval / addArc",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color("#4527a0"));
      const path = Skia.Path.Make();
      path.moveTo(24, 128);
      path.cubicTo(24, 40, 120, 24, 128, 96);
      path.quadTo(180, 40, 232, 96);
      path.lineTo(232, 152);
      path.arcToOval(Skia.XYWHRect(96, 104, 136, 96), 0, 120, false);
      path.close();
      canvas.drawPath(path, paint);
      const arc = Skia.Path.Make();
      arc.addArc(Skia.XYWHRect(48, 168, 72, 72), 30, 270);
      const stroke = Skia.Paint();
      stroke.setColor(Skia.Color("#00838f"));
      stroke.setStyle(1 /* PaintStyle.Stroke */);
      stroke.setStrokeWidth(6);
      canvas.drawPath(arc, stroke);
    }`,
  },
  {
    key: "fill-rule-evenodd",
    title: "Even-odd fill rule",
    concept: "FillType.EvenOdd with overlapping contours",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color("#ad1457"));
      const path = Skia.Path.Make();
      path.addCircle(104, 104, 72);
      path.addCircle(152, 152, 72);
      path.addRect(Skia.XYWHRect(88, 88, 80, 80));
      path.setFillType(1 /* FillType.EvenOdd */);
      canvas.drawPath(path, paint);
    }`,
  },
  {
    key: "stroke-caps-joins",
    title: "Stroke widths, caps, joins and miter",
    concept: "StrokeCap / StrokeJoin / strokeMiter / stroke widths",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const caps = [0 /* Butt */, 1 /* Round */, 2 /* Square */];
      for (let i = 0; i < caps.length; i++) {
        const p = Skia.Paint();
        p.setColor(Skia.Color("#37474f"));
        p.setStyle(1 /* PaintStyle.Stroke */);
        p.setStrokeWidth(8 + 4 * i);
        p.setStrokeCap(caps[i]);
        canvas.drawLine(32, 32 + 28 * i, 224, 32 + 28 * i, p);
      }
      const joins = [0 /* Miter */, 1 /* Round */, 2 /* Bevel */];
      for (let i = 0; i < joins.length; i++) {
        const zig = Skia.Path.Make();
        zig.moveTo(32 + 68 * i, 224);
        zig.lineTo(56 + 68 * i, 136);
        zig.lineTo(80 + 68 * i, 224);
        const p = Skia.Paint();
        p.setColor(Skia.Color("#bf360c"));
        p.setStyle(1 /* PaintStyle.Stroke */);
        p.setStrokeWidth(12);
        p.setStrokeJoin(joins[i]);
        p.setStrokeMiter(i === 0 ? 10 : 2);
        canvas.drawPath(zig, p);
      }
    }`,
  },
  {
    key: "dash-effect",
    title: "Dashed strokes",
    concept: "PathEffect.MakeDash on lines and curves",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const p = Skia.Paint();
      p.setColor(Skia.Color("#1a237e"));
      p.setStyle(1 /* PaintStyle.Stroke */);
      p.setStrokeWidth(4);
      p.setPathEffect(Skia.PathEffect.MakeDash([16, 8], 0));
      canvas.drawLine(24, 48, 232, 48, p);
      const wave = Skia.Path.Make();
      wave.moveTo(24, 128);
      wave.cubicTo(88, 64, 168, 192, 232, 128);
      canvas.drawPath(wave, p);
      const p2 = Skia.Paint();
      p2.setColor(Skia.Color("#e65100"));
      p2.setStyle(1 /* PaintStyle.Stroke */);
      p2.setStrokeWidth(6);
      p2.setPathEffect(Skia.PathEffect.MakeDash([4, 10], 5));
      canvas.drawCircle(128, 196, 40, p2);
    }`,
  },
  {
    key: "transforms-nested",
    title: "Nested canvas transforms",
    concept: "translate / rotate / scale / skew across save/restore",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const box = (color) => {
        const p = Skia.Paint();
        p.setColor(Skia.Color(color));
        canvas.drawRect(Skia.XYWHRect(-24, -16, 48, 32), p);
      };
      canvas.save();
      canvas.translate(64, 56);
      box("#c62828");
      canvas.save();
      canvas.translate(128, 0);
      canvas.rotate(30, 0, 0);
      box("#1565c0");
      canvas.restore();
      canvas.save();
      canvas.translate(0, 120);
      canvas.scale(1.6, 0.8);
      box("#2e7d32");
      canvas.save();
      canvas.translate(80, 0);
      canvas.skew(0.4, 0.1);
      box("#f9a825");
      canvas.restore();
      canvas.restore();
      canvas.restore();
    }`,
  },
  {
    key: "clip-rect",
    title: "Rectangular clip",
    concept: "clipRect(Intersect) with overflowing content",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      canvas.save();
      canvas.clipRect(
        Skia.XYWHRect(48, 48, 160, 160),
        1 /* ClipOp.Intersect */,
        true
      );
      const p = Skia.Paint();
      p.setColor(Skia.Color("#00695c"));
      canvas.drawCircle(48, 48, 100, p);
      const p2 = Skia.Paint();
      p2.setColor(Skia.Color("#ff8f00"));
      canvas.drawCircle(208, 208, 100, p2);
      canvas.restore();
    }`,
  },
  {
    key: "clip-path",
    title: "Path clip",
    concept: "clipPath with a non-rectangular contour",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const star = Skia.Path.Make();
      const cx = 128;
      const cy = 128;
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 104 : 44;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) {
          star.moveTo(x, y);
        } else {
          star.lineTo(x, y);
        }
      }
      star.close();
      canvas.save();
      canvas.clipPath(star, 1 /* ClipOp.Intersect */, true);
      const p = Skia.Paint();
      p.setColor(Skia.Color("#6a1b9a"));
      canvas.drawRect(Skia.XYWHRect(0, 0, 256, 128), p);
      const p2 = Skia.Paint();
      p2.setColor(Skia.Color("#0277bd"));
      canvas.drawRect(Skia.XYWHRect(0, 128, 256, 128), p2);
      canvas.restore();
    }`,
  },
  {
    key: "alpha-save-restore",
    title: "Per-paint alpha with save/restore",
    concept: "setAlphaf compositing across a save/restore stack",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const circle = (x, y, color, alpha) => {
        const p = Skia.Paint();
        p.setColor(Skia.Color(color));
        p.setAlphaf(alpha);
        canvas.drawCircle(x, y, 64, p);
      };
      circle(96, 96, "#d32f2f", 0.5);
      canvas.save();
      canvas.translate(64, 0);
      circle(96, 96, "#1976d2", 0.5);
      canvas.save();
      canvas.translate(-32, 64);
      circle(96, 96, "#388e3c", 0.5);
      canvas.restore();
      canvas.restore();
      circle(96, 224, "#f57f17", 0.8);
    }`,
  },
  {
    key: "save-layer-alpha",
    title: "saveLayer with layer alpha",
    concept: "flatten-then-fade semantics of saveLayer(paint)",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const opaque = (x, y, color) => {
        const p = Skia.Paint();
        p.setColor(Skia.Color(color));
        canvas.drawCircle(x, y, 64, p);
      };
      // Two opaque circles flattened by the layer, THEN faded to 50% as a
      // unit — the overlap must not darken like per-shape alpha would.
      const layerPaint = Skia.Paint();
      layerPaint.setAlphaf(0.5);
      canvas.saveLayer(layerPaint);
      opaque(96, 112, "#c62828");
      opaque(160, 112, "#1565c0");
      canvas.restore();
      // Bottom band drawn outside any layer as an anchor.
      const anchor = Skia.Paint();
      anchor.setColor(Skia.Color("#455a64"));
      canvas.drawRect(Skia.XYWHRect(32, 208, 192, 24), anchor);
    }`,
  },
  {
    key: "gradient-linear",
    title: "Linear gradient",
    concept: "Shader.MakeLinearGradient → PDF axial (Type 2) shading",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 150_000,
    draw: `(Skia, canvas) => {
      const paint = Skia.Paint();
      paint.setShader(
        Skia.Shader.MakeLinearGradient(
          Skia.Point(16, 16),
          Skia.Point(240, 240),
          [Skia.Color("#e53935"), Skia.Color("#fdd835"), Skia.Color("#1e88e5")],
          [0, 0.5, 1],
          0 /* TileMode.Clamp */
        )
      );
      canvas.drawRect(Skia.XYWHRect(16, 16, 224, 224), paint);
    }`,
  },
  {
    key: "gradient-radial",
    title: "Radial gradient",
    concept: "Shader.MakeRadialGradient → PDF radial (Type 3) shading",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 150_000,
    draw: `(Skia, canvas) => {
      const paint = Skia.Paint();
      paint.setShader(
        Skia.Shader.MakeRadialGradient(
          Skia.Point(128, 128),
          112,
          [Skia.Color("#ffffff"), Skia.Color("#43a047"), Skia.Color("#1b5e20")],
          [0, 0.6, 1],
          0 /* TileMode.Clamp */
        )
      );
      canvas.drawCircle(128, 128, 112, paint);
    }`,
  },
  {
    key: "gradient-sweep",
    title: "Sweep gradient",
    concept:
      "Shader.MakeSweepGradient (no native PDF equivalent; SkPDF emits a function-based shading)",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    // Sweep gradients round-trip through a sampled PostScript (Type 4)
    // function in the PDF; pdfjs evaluates it with its own sampling, so the
    // angular color ramp lands slightly differently than Skia's analytic
    // evaluation. Allow a bit more than plain-geometry scenes.
    tolerancePct: 8,
    sizeBudgetBytes: 300_000,
    draw: `(Skia, canvas) => {
      const paint = Skia.Paint();
      paint.setShader(
        Skia.Shader.MakeSweepGradient(
          128,
          128,
          [
            Skia.Color("#e53935"),
            Skia.Color("#8e24aa"),
            Skia.Color("#3949ab"),
            Skia.Color("#e53935"),
          ],
          [0, 0.4, 0.7, 1],
          0 /* TileMode.Clamp */
        )
      );
      canvas.drawCircle(128, 128, 104, paint);
    }`,
  },
  {
    key: "blend-multiply-screen",
    title: "Multiply and Screen blend modes",
    concept: "setBlendMode → PDF ExtGState /BM",
    width: PAGE,
    height: PAGE,
    expected: "vector",
    sizeBudgetBytes: 100_000,
    draw: `(Skia, canvas) => {
      const base = Skia.Paint();
      base.setColor(Skia.Color("#90a4ae"));
      canvas.drawRect(Skia.XYWHRect(16, 16, 224, 104), base);
      const base2 = Skia.Paint();
      base2.setColor(Skia.Color("#37474f"));
      canvas.drawRect(Skia.XYWHRect(16, 136, 224, 104), base2);
      const multiply = Skia.Paint();
      multiply.setColor(Skia.Color("#ef5350"));
      multiply.setBlendMode(24 /* BlendMode.Multiply */);
      canvas.drawCircle(88, 68, 44, multiply);
      const multiply2 = Skia.Paint();
      multiply2.setColor(Skia.Color("#42a5f5"));
      multiply2.setBlendMode(24 /* BlendMode.Multiply */);
      canvas.drawCircle(152, 68, 44, multiply2);
      const screen = Skia.Paint();
      screen.setColor(Skia.Color("#ef5350"));
      screen.setBlendMode(14 /* BlendMode.Screen */);
      canvas.drawCircle(88, 188, 44, screen);
      const screen2 = Skia.Paint();
      screen2.setColor(Skia.Color("#42a5f5"));
      screen2.setBlendMode(14 /* BlendMode.Screen */);
      canvas.drawCircle(152, 188, 44, screen2);
    }`,
  },
  {
    key: "image-embed",
    title: "In-memory image via drawImage",
    concept: "offscreen snapshot embedded as a PDF image XObject",
    width: PAGE,
    height: PAGE,
    // The image here is intentional (not a fallback), but the quality gate is
    // the same: the parsed page must contain at least one image.
    expected: "raster-fallback",
    sizeBudgetBytes: 300_000,
    draw: `(Skia, canvas) => {
      const s = Skia.Surface.MakeOffscreen(64, 64);
      if (!s) {
        throw new Error("Could not create the in-scene offscreen surface");
      }
      const c = s.getCanvas();
      c.drawColor(Skia.Color("#ffe082"));
      const p = Skia.Paint();
      p.setColor(Skia.Color("#6a1b9a"));
      c.drawCircle(32, 32, 24, p);
      const p2 = Skia.Paint();
      p2.setColor(Skia.Color("#004d40"));
      c.drawRect(Skia.XYWHRect(4, 4, 20, 20), p2);
      s.flush();
      // makeNonTextureImage: the snapshot may be texture-backed; SkPDF
      // serializes encoded pixels, so force a CPU-readable image first.
      const snapshot = s.makeImageSnapshot();
      const image = snapshot.makeNonTextureImage() || snapshot;
      canvas.drawImage(image, 32, 32);
      canvas.drawImage(image, 160, 160);
    }`,
  },
  {
    key: "image-rect-crop",
    title: "Cropped and scaled image",
    concept: "drawImageRect with a src crop and non-uniform dst scale",
    width: PAGE,
    height: PAGE,
    expected: "raster-fallback",
    sizeBudgetBytes: 300_000,
    draw: `(Skia, canvas) => {
      const s = Skia.Surface.MakeOffscreen(64, 64);
      if (!s) {
        throw new Error("Could not create the in-scene offscreen surface");
      }
      const c = s.getCanvas();
      c.drawColor(Skia.Color("#b3e5fc"));
      const q = Skia.Paint();
      q.setColor(Skia.Color("#e65100"));
      c.drawRect(Skia.XYWHRect(0, 0, 32, 32), q);
      const q2 = Skia.Paint();
      q2.setColor(Skia.Color("#1b5e20"));
      c.drawRect(Skia.XYWHRect(32, 32, 32, 32), q2);
      s.flush();
      const snapshot = s.makeImageSnapshot();
      const image = snapshot.makeNonTextureImage() || snapshot;
      const paint = Skia.Paint();
      // Top-left quadrant of the source, stretched wide.
      canvas.drawImageRect(
        image,
        Skia.XYWHRect(0, 0, 32, 32),
        Skia.XYWHRect(24, 24, 208, 80),
        paint
      );
      // Bottom-right quadrant, stretched tall.
      canvas.drawImageRect(
        image,
        Skia.XYWHRect(32, 32, 32, 32),
        Skia.XYWHRect(88, 128, 80, 104),
        paint
      );
    }`,
  },
  {
    key: "text-sans",
    title: "Latin text with the system sans-serif",
    concept: "drawText with an embedded, subsetted system font",
    width: 480,
    height: 160,
    expected: "vector",
    expectsText: true,
    sizeBudgetBytes: 300_000,
    draw: `(Skia, canvas) => {
      const fontMgr = Skia.FontMgr.System();
      // "sans-serif" resolves on the Android target; never use "Roboto"
      // directly (it resolves to .notdef glyphs on the target device).
      const typeface = fontMgr.matchFamilyStyle("sans-serif", {
        weight: 400,
        width: 5,
        slant: 0,
      });
      if (!typeface) {
        throw new Error("sans-serif typeface did not resolve");
      }
      const font = Skia.Font(typeface, 18);
      const paint = Skia.Paint();
      paint.setColor(Skia.Color("black"));
      canvas.drawText(
        "The quick brown fox jumps over the lazy dog",
        16,
        56,
        paint,
        font
      );
      canvas.drawText("0123456789 <=> (100%) [OK]", 16, 96, paint, font);
    }`,
  },
  {
    key: "text-cjk-emoji",
    title: "CJK and emoji text",
    concept:
      "font fallback + non-BMP codepoints (emoji may become Type3/bitmap)",
    width: 400,
    height: 200,
    expected: "mixed",
    expectsText: true,
    sizeBudgetBytes: 1_500_000,
    draw: `(Skia, canvas) => {
      // Sources must stay pure ASCII: build the text at runtime.
      const cjk = String.fromCodePoint(0x4f60, 0x597d, 0x4e16, 0x754c);
      const emoji = String.fromCodePoint(0x1f600, 0x1f680);
      const builder = Skia.ParagraphBuilder.Make({});
      builder.pushStyle({ fontSize: 28, color: Skia.Color("black") });
      builder.addText("Hi " + cjk + " " + emoji);
      const paragraph = builder.build();
      paragraph.layout(368);
      paragraph.paint(canvas, 16, 32);
    }`,
  },
  {
    key: "blur-mask-filter",
    title: "Blur mask filter",
    concept:
      "MaskFilter.MakeBlur over rect + text (PDF has no blur → rasterized)",
    width: PAGE,
    height: PAGE,
    expected: "raster-fallback",
    // Blurred text is rasterized, so no text extraction is expected here.
    sizeBudgetBytes: 3_000_000,
    draw: `(Skia, canvas) => {
      const paint = Skia.Paint();
      paint.setColor(Skia.Color("#283593"));
      paint.setMaskFilter(
        Skia.MaskFilter.MakeBlur(0 /* BlurStyle.Normal */, 8, true)
      );
      canvas.drawRect(Skia.XYWHRect(48, 40, 160, 88), paint);
      const fontMgr = Skia.FontMgr.System();
      const typeface = fontMgr.matchFamilyStyle("sans-serif", {
        weight: 400,
        width: 5,
        slant: 0,
      });
      const font = Skia.Font(typeface, 28);
      const textPaint = Skia.Paint();
      textPaint.setColor(Skia.Color("#b71c1c"));
      textPaint.setMaskFilter(
        Skia.MaskFilter.MakeBlur(0 /* BlurStyle.Normal */, 2, true)
      );
      canvas.drawText("Blurred", 72, 196, textPaint, font);
    }`,
  },
  {
    key: "runtime-effect",
    title: "Runtime effect shader",
    concept: "SkSL shader fill (PDF cannot express SkSL → rasterized)",
    width: PAGE,
    height: PAGE,
    expected: "raster-fallback",
    sizeBudgetBytes: 4_000_000,
    draw: `(Skia, canvas) => {
      const source =
        "uniform vec2 c;" +
        "half4 main(vec2 xy) {" +
        "  float d = distance(xy, c) / 180.0;" +
        "  return half4(d, 0.3, 1.0 - d, 1.0);" +
        "}";
      const effect = Skia.RuntimeEffect.Make(source);
      if (!effect) {
        throw new Error("Runtime effect failed to compile");
      }
      const paint = Skia.Paint();
      paint.setShader(effect.makeShader([128, 128]));
      canvas.drawRect(Skia.XYWHRect(16, 16, 224, 224), paint);
    }`,
  },
  {
    key: "landscape-page",
    title: "Landscape US-letter page",
    concept: "non-portrait page geometry (792x612)",
    width: 792,
    height: 612,
    expected: "vector",
    sizeBudgetBytes: 150_000,
    draw: `(Skia, canvas) => {
      const border = Skia.Paint();
      border.setColor(Skia.Color("#263238"));
      border.setStyle(1 /* PaintStyle.Stroke */);
      border.setStrokeWidth(4);
      canvas.drawRect(Skia.XYWHRect(24, 24, 744, 564), border);
      const diag = Skia.Paint();
      diag.setColor(Skia.Color("#8d6e63"));
      diag.setStyle(1 /* PaintStyle.Stroke */);
      diag.setStrokeWidth(2);
      canvas.drawLine(24, 24, 768, 588, diag);
      canvas.drawLine(768, 24, 24, 588, diag);
      const corner = Skia.Paint();
      corner.setColor(Skia.Color("#00838f"));
      canvas.drawCircle(72, 72, 32, corner);
      canvas.drawCircle(720, 72, 32, corner);
      canvas.drawCircle(72, 540, 32, corner);
      canvas.drawCircle(720, 540, 32, corner);
      const center = Skia.Paint();
      center.setColor(Skia.Color("#c62828"));
      canvas.drawRect(Skia.XYWHRect(376, 286, 40, 40), center);
    }`,
  },
];
