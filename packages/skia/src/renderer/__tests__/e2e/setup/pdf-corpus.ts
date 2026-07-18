import fs from "fs";
import path from "path";

import type {
  ClipOp,
  PaintStyle,
  SkCanvas,
  Skia,
  SkTypeface,
  TileMode,
} from "../../../../skia/types";

/**
 * Realistic multi-page document builders for the Skia PDF backend, plus the
 * compatibility-report accumulator shared by PDFCorpus.spec.tsx and
 * PDFEdgeCases.spec.tsx.
 *
 * Every `build` function below is DEVICE-SIDE SOURCE: the spec hands it to
 * `surface.eval`, which serializes it with `fn.toString()` and evaluates it on
 * the connected device. That imposes hard constraints on how these functions
 * are written:
 *
 * - They may close over NOTHING but their `(Skia)` parameter — no imports, no
 *   module constants, no shared helpers. Anything they need is declared inside
 *   the function body (which is why the small `para`/font helpers are
 *   duplicated across builders).
 * - Enum values (TileMode, ClipOp, PaintStyle) are inlined as numeric literals
 *   with an erased `as` cast: the TS enum object does not exist on the device.
 * - Return values must be JSON-serializable (they travel back over the test
 *   websocket).
 * - Non-BMP characters must be produced via String.fromCodePoint, and text is
 *   laid out with fontFamilies ["sans-serif"] (never "Roboto") so the same
 *   source works on iOS and Android system font managers.
 */

export interface CorpusBuildResult {
  /** The finalized document, base64 encoded. */
  b64: string;
  /** Wall-clock generation time measured on the device, in milliseconds. */
  genMs: number;
  /** Small JSON-friendly facts measured on-device. */
  meta: Record<string, number | string>;
}

export interface ExpectedSnippet {
  /** 1-based page number the snippet must appear on. */
  page: number;
  /** Substring that must be extractable from that page via pdfjs. */
  snippet: string;
}

export interface CorpusDoc {
  key: string;
  title: string;
  /** Expected page count. */
  pages: number;
  /**
   * Byte-size budget. These are regression tripwires, not hard truths: the
   * numbers are several times larger than the expected output so that normal
   * variation (font metrics, compression level) never trips them, while a
   * structural regression (e.g. vector content silently rasterizing at
   * rasterDPI=300, or font subsetting being disabled so whole system fonts
   * get embedded) blows straight past them.
   */
  maxBytes: number;
  /** Text snippets that must be extractable, per page. */
  expectedText: ExpectedSnippet[];
  /** Expected pdfjs image-XObject paint count per page (index 0 = page 1). */
  expectedImagesPerPage: number[];
  /**
   * Device-side builder. Serialized via toString() and evaluated on the
   * device — see the module comment for the closure rules.
   */
  build: (Skia: Skia) => CorpusBuildResult;
}

/**
 * A 3-page invoice: logo (the document's only raster image, produced from an
 * in-memory Surface snapshot), header text, two Paragraph address blocks, a
 * 12-row x 4-column line-item table drawn with lines + drawText, a second
 * detail table, totals, terms, and per-page footer page numbers.
 *
 * Budget rationale (< 300 KB): the document is almost entirely vector ops +
 * one or two subset fonts (usually 10-60 KB) + one 96x96 losslessly encoded
 * logo (a few KB deflated). Typical output is well under 150 KB; 300 KB only
 * trips when something structural regresses.
 */
const invoiceDoc: CorpusDoc = {
  key: "invoice",
  title: "3-page invoice (table, logo image, address paragraphs)",
  pages: 3,
  maxBytes: 300 * 1024,
  expectedText: [
    { page: 1, snippet: "INVOICE" },
    { page: 1, snippet: "Acme Corporation" },
    { page: 1, snippet: "Line items" },
    { page: 2, snippet: "materials" },
    { page: 2, snippet: "Sprint" },
    { page: 3, snippet: "TOTAL" },
    { page: 3, snippet: "Net 30" },
  ],
  expectedImagesPerPage: [1, 0, 0],
  build: (Skia: Skia): CorpusBuildResult => {
    const t0 = Date.now();
    const W = 612;
    const H = 792;
    const doc = Skia.PDF.MakeDocument({
      title: "Invoice INV-2042",
      author: "Corpus Suite",
      creator: "pdf-corpus.ts (invoice)",
    });

    const fontMgr = Skia.FontMgr.System();
    let typeface: SkTypeface;
    try {
      typeface = fontMgr.matchFamilyStyle("sans-serif", { weight: 400 });
    } catch {
      // iOS system font managers have no "sans-serif" alias — fall back to
      // the first installed family.
      typeface = fontMgr.matchFamilyStyle(fontMgr.getFamilyName(0), {
        weight: 400,
      });
    }
    const bodyFont = Skia.Font(typeface, 9);
    const smallFont = Skia.Font(typeface, 8);

    const ink = Skia.Paint();
    ink.setColor(Skia.Color("#1A1A1A"));
    const faint = Skia.Paint();
    faint.setColor(Skia.Color("#707070"));
    const rule = Skia.Paint();
    rule.setColor(Skia.Color("#B5B5B5"));
    rule.setStyle(1 as PaintStyle); // PaintStyle.Stroke
    rule.setStrokeWidth(0.75);

    const para = (text: string, size: number, color: string, width: number) => {
      const builder = Skia.ParagraphBuilder.Make({});
      builder.pushStyle({
        fontSize: size,
        fontFamilies: ["sans-serif"],
        color: Skia.Color(color),
      });
      builder.addText(text);
      const p = builder.build();
      p.layout(width);
      return p;
    };

    // 4-column table drawn with grid lines + one drawText per cell.
    const columns = [54, 306, 396, 486];
    const colEdges = [48, 300, 390, 480, 564];
    const rowH = 24;
    const drawTable = (
      canvas: SkCanvas,
      top: number,
      header: string[],
      rows: string[][]
    ) => {
      const bottom = top + rowH * (rows.length + 1);
      for (let r = 0; r <= rows.length + 1; r++) {
        const y = top + r * rowH;
        canvas.drawLine(colEdges[0], y, colEdges[colEdges.length - 1], y, rule);
      }
      for (let c = 0; c < colEdges.length; c++) {
        canvas.drawLine(colEdges[c], top, colEdges[c], bottom, rule);
      }
      header.forEach((cell, c) => {
        canvas.drawText(cell, columns[c], top + 16, ink, bodyFont);
      });
      rows.forEach((cells, r) => {
        cells.forEach((cell, c) => {
          canvas.drawText(
            cell,
            columns[c],
            top + rowH * (r + 1) + 16,
            ink,
            bodyFont
          );
        });
      });
      return bottom;
    };

    const footer = (canvas: SkCanvas, page: number) => {
      canvas.drawText("INV-2042", 48, H - 36, faint, smallFont);
      canvas.drawText("Page " + page + " of 3", 270, H - 36, faint, smallFont);
    };

    // --- Page 1: logo, invoice header, address blocks, line-item table ---
    let canvas = doc.beginPage(W, H);

    // The logo is the only raster image in the whole document: drawn on an
    // offscreen surface, snapshotted, and converted to a raster (non-texture)
    // image so SkPDF can serialize its pixels without a GPU context.
    const logoSurface = Skia.Surface.MakeOffscreen(96, 96);
    if (!logoSurface) {
      throw new Error("invoice: could not create the offscreen logo surface");
    }
    const logoCanvas = logoSurface.getCanvas();
    const logoBg = Skia.Paint();
    logoBg.setColor(Skia.Color("#1E4FBF"));
    logoCanvas.drawRRect(
      Skia.RRectXY(Skia.XYWHRect(0, 0, 96, 96), 20, 20),
      logoBg
    );
    const logoFg = Skia.Paint();
    logoFg.setColor(Skia.Color("white"));
    logoCanvas.drawCircle(48, 48, 26, logoFg);
    logoCanvas.drawRect(Skia.XYWHRect(44, 16, 8, 64), logoBg);
    logoSurface.flush();
    const logo = logoSurface.makeImageSnapshot().makeNonTextureImage();
    if (!logo) {
      throw new Error("invoice: could not rasterize the logo snapshot");
    }
    const imgPaint = Skia.Paint();
    canvas.drawImageRect(
      logo,
      Skia.XYWHRect(0, 0, 96, 96),
      Skia.XYWHRect(48, 42, 48, 48),
      imgPaint
    );

    para("INVOICE", 26, "#1A1A1A", 300).paint(canvas, 120, 42);
    para(
      "Invoice INV-2042 - issued 2026-07-18 - due 2026-08-17",
      10,
      "#707070",
      440
    ).paint(canvas, 120, 78);

    // Address blocks as Paragraphs (multi-line, wrapped).
    para(
      "Billed to:\nAcme Corporation\n1200 Industrial Way\nSpringfield, OR 97477",
      10,
      "#1A1A1A",
      220
    ).paint(canvas, 48, 120);
    para(
      "From:\nNorth Beach Studio\n77 Harbor Lane\nReykjavik, IS 101",
      10,
      "#1A1A1A",
      220
    ).paint(canvas, 320, 120);

    canvas.drawText("Line items", 48, 230, ink, bodyFont);
    drawTable(
      canvas,
      240,
      ["Item", "Qty", "Unit", "Amount"],
      [
        ["Design workshop", "4", "120.00", "480.00"],
        ["Wireframe review", "2", "95.00", "190.00"],
        ["Component library", "8", "110.00", "880.00"],
        ["Prototype build", "6", "130.00", "780.00"],
        ["Usability testing", "3", "105.00", "315.00"],
        ["Accessibility audit", "2", "125.00", "250.00"],
        ["Design tokens", "5", "90.00", "450.00"],
        ["Icon set", "1", "240.00", "240.00"],
        ["Motion studies", "4", "115.00", "460.00"],
        ["Handoff docs", "2", "85.00", "170.00"],
        ["QA support", "6", "75.00", "450.00"],
        ["Project management", "5", "45.00", "225.00"],
      ]
    );
    footer(canvas, 1);
    doc.endPage();

    // --- Page 2: time & materials detail table ---
    const detail: string[][] = [];
    for (let i = 0; i < 12; i++) {
      const days = 8 + (i % 3);
      detail.push([
        "Sprint " + (i + 1) + " engineering",
        String(days),
        "140.00",
        (140 * days).toFixed(2),
      ]);
    }
    canvas = doc.beginPage(W, H);
    para("Time and materials detail", 16, "#1A1A1A", 440).paint(canvas, 48, 48);
    drawTable(canvas, 96, ["Work package", "Days", "Rate", "Cost"], detail);
    para(
      "All figures in USD. Detail continues from page one.",
      9,
      "#707070",
      460
    ).paint(canvas, 48, 430);
    footer(canvas, 2);
    doc.endPage();

    // --- Page 3: totals + payment terms ---
    canvas = doc.beginPage(W, H);
    para("Summary", 16, "#1A1A1A", 440).paint(canvas, 48, 48);
    canvas.drawText("Subtotal", 360, 110, ink, bodyFont);
    canvas.drawText("4,890.00", 486, 110, ink, bodyFont);
    canvas.drawText("Tax (8.0%)", 360, 134, ink, bodyFont);
    canvas.drawText("391.20", 486, 134, ink, bodyFont);
    canvas.drawLine(354, 148, 564, 148, rule);
    canvas.drawText("TOTAL", 360, 170, ink, bodyFont);
    canvas.drawText("5,281.20", 486, 170, ink, bodyFont);
    para(
      "Payment terms:\nNet 30. Late payments accrue 1.5% monthly interest. " +
        "Wire transfers preferred; reference INV-2042 on all payments.",
      10,
      "#1A1A1A",
      480
    ).paint(canvas, 48, 210);
    footer(canvas, 3);
    doc.endPage();

    doc.close();
    return {
      b64: doc.getBase64(),
      genMs: Date.now() - t0,
      meta: { pages: 3, state: doc.state },
    };
  },
};

/**
 * A single A3-ish (842x1191 pt) poster: full-bleed linear-gradient background
 * (kept as a native PDF shading pattern, NOT an image), rotated headline
 * paragraphs, one path-clipped raster image (surface snapshot), and rounded
 * badge chips.
 *
 * Budget rationale (< 2 MB): the only raster content is a 256x256 losslessly
 * encoded snapshot (worst case ~260 KB before deflate); everything else is
 * vector. 2 MB is the tripwire for the gradient background accidentally
 * rasterizing — a full A3 raster at the default rasterDPI of 300 would be
 * tens of MB.
 */
const posterDoc: CorpusDoc = {
  key: "poster",
  title: "A3 poster (gradient, rotated headline, clipped image, badges)",
  pages: 1,
  maxBytes: 2 * 1024 * 1024,
  expectedText: [
    { page: 1, snippet: "AURORA" },
    { page: 1, snippet: "FESTIVAL" },
    { page: 1, snippet: "FREE ENTRY" },
  ],
  expectedImagesPerPage: [1],
  build: (Skia: Skia): CorpusBuildResult => {
    const t0 = Date.now();
    const W = 842;
    const H = 1191;
    const doc = Skia.PDF.MakeDocument({
      title: "Aurora Festival Poster",
      author: "Corpus Suite",
      creator: "pdf-corpus.ts (poster)",
    });
    const canvas = doc.beginPage(W, H);

    const para = (text: string, size: number, color: string, width: number) => {
      const builder = Skia.ParagraphBuilder.Make({});
      builder.pushStyle({
        fontSize: size,
        fontFamilies: ["sans-serif"],
        color: Skia.Color(color),
      });
      builder.addText(text);
      const p = builder.build();
      p.layout(width);
      return p;
    };

    // Full-bleed gradient background. Clamped linear gradients map to native
    // PDF shading patterns, so this must NOT add to the page's image count.
    const bg = Skia.Paint();
    bg.setShader(
      Skia.Shader.MakeLinearGradient(
        Skia.Point(0, 0),
        Skia.Point(0, H),
        [Skia.Color("#0B1026"), Skia.Color("#26356B"), Skia.Color("#0B1026")],
        [0, 0.55, 1],
        0 as TileMode // TileMode.Clamp (inlined: evaluated on-device)
      )
    );
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), bg);

    // Rotated headline.
    canvas.save();
    canvas.rotate(-8, 110, 320);
    para("AURORA", 110, "#FFFFFF", 720).paint(canvas, 96, 190);
    para("FESTIVAL", 64, "#9FE8FF", 720).paint(canvas, 100, 320);
    canvas.restore();

    // Hero image: an offscreen snapshot (radial gradient + a deterministic
    // star field), clipped to a diamond path. This is the poster's only
    // raster image.
    const heroSurface = Skia.Surface.MakeOffscreen(256, 256);
    if (!heroSurface) {
      throw new Error("poster: could not create the offscreen hero surface");
    }
    const heroCanvas = heroSurface.getCanvas();
    const heroBg = Skia.Paint();
    heroBg.setShader(
      Skia.Shader.MakeRadialGradient(
        Skia.Point(128, 96),
        190,
        [Skia.Color("#3E7BD1"), Skia.Color("#101A3A")],
        null,
        0 as TileMode // TileMode.Clamp
      )
    );
    heroCanvas.drawRect(Skia.XYWHRect(0, 0, 256, 256), heroBg);
    const star = Skia.Paint();
    star.setColor(Skia.Color("#FFFFFF"));
    let seed = 7;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 40; i++) {
      heroCanvas.drawCircle(
        rand() * 256,
        rand() * 256,
        0.8 + rand() * 1.6,
        star
      );
    }
    const moon = Skia.Paint();
    moon.setColor(Skia.Color("#F2E9C9"));
    heroCanvas.drawCircle(190, 66, 22, moon);
    heroSurface.flush();
    const hero = heroSurface.makeImageSnapshot().makeNonTextureImage();
    if (!hero) {
      throw new Error("poster: could not rasterize the hero snapshot");
    }

    const clip = Skia.Path.Make();
    clip.moveTo(421, 430);
    clip.lineTo(661, 670);
    clip.lineTo(421, 910);
    clip.lineTo(181, 670);
    clip.close();
    canvas.save();
    canvas.clipPath(clip, 1 as ClipOp, true); // ClipOp.Intersect
    const imgPaint = Skia.Paint();
    canvas.drawImageRect(
      hero,
      Skia.XYWHRect(0, 0, 256, 256),
      Skia.XYWHRect(181, 430, 480, 480),
      imgPaint
    );
    canvas.restore();

    // Rounded badge chips.
    const badges = ["3 NIGHTS", "42 ACTS", "FREE ENTRY"];
    badges.forEach((label, i) => {
      const x = 96 + i * 230;
      const y = 980;
      const fill = Skia.Paint();
      fill.setColor(Skia.Color("#FFFFFF"));
      fill.setAlphaf(0.14);
      canvas.drawRRect(
        Skia.RRectXY(Skia.XYWHRect(x, y, 200, 72), 16, 16),
        fill
      );
      const outline = Skia.Paint();
      outline.setColor(Skia.Color("#9FE8FF"));
      outline.setStyle(1 as PaintStyle); // PaintStyle.Stroke
      outline.setStrokeWidth(1.5);
      canvas.drawRRect(
        Skia.RRectXY(Skia.XYWHRect(x, y, 200, 72), 16, 16),
        outline
      );
      para(label, 20, "#FFFFFF", 180).paint(canvas, x + 28, y + 22);
    });

    para(
      "December 12-14 - Ludvika Fjord Amphitheatre - aurora.example.com",
      14,
      "#C9D6FF",
      680
    ).paint(canvas, 96, 1100);

    doc.endPage();
    doc.close();
    return {
      b64: doc.getBase64(),
      genMs: Date.now() - t0,
      meta: { pages: 1, state: doc.state },
    };
  },
};

/**
 * A 4-page chart report: line chart (50-point path), bar chart (30 rects),
 * pie chart (arcs), scatter plot (200 circles). Every page repeats the same
 * header component, axis labels are plain drawText, and both the line and bar
 * pages include a semi-transparent overlay series.
 *
 * Budget rationale (< 500 KB): pure vector + subset fonts. The tripwire fires
 * if the semi-transparent overlays (SMask/ExtGState territory) start being
 * rasterized instead of expressed as vector content with alpha.
 */
const chartReportDoc: CorpusDoc = {
  key: "chart-report",
  title: "4-page chart report (line, bars, pie, scatter, shared header)",
  pages: 4,
  maxBytes: 500 * 1024,
  expectedText: [
    { page: 1, snippet: "Quarterly" },
    { page: 2, snippet: "Quarterly" },
    { page: 3, snippet: "Quarterly" },
    { page: 4, snippet: "Quarterly" },
    { page: 1, snippet: "Revenue" },
    { page: 2, snippet: "region" },
    { page: 3, snippet: "Organic" },
    { page: 4, snippet: "Latency" },
  ],
  expectedImagesPerPage: [0, 0, 0, 0],
  build: (Skia: Skia): CorpusBuildResult => {
    const t0 = Date.now();
    const W = 612;
    const H = 792;
    const doc = Skia.PDF.MakeDocument({
      title: "Quarterly Metrics Report",
      author: "Corpus Suite",
      creator: "pdf-corpus.ts (chart-report)",
    });

    const fontMgr = Skia.FontMgr.System();
    let typeface: SkTypeface;
    try {
      typeface = fontMgr.matchFamilyStyle("sans-serif", { weight: 400 });
    } catch {
      typeface = fontMgr.matchFamilyStyle(fontMgr.getFamilyName(0), {
        weight: 400,
      });
    }
    const axisFont = Skia.Font(typeface, 8);
    const labelFont = Skia.Font(typeface, 9);

    const ink = Skia.Paint();
    ink.setColor(Skia.Color("#333333"));
    const axis = Skia.Paint();
    axis.setColor(Skia.Color("#333333"));
    axis.setStyle(1 as PaintStyle); // PaintStyle.Stroke
    axis.setStrokeWidth(1);
    const grid = Skia.Paint();
    grid.setColor(Skia.Color("#CCCCCC"));
    grid.setStyle(1 as PaintStyle); // PaintStyle.Stroke
    grid.setStrokeWidth(0.5);
    const seriesA = Skia.Paint();
    seriesA.setColor(Skia.Color("#1E66D0"));
    // Semi-transparent overlay series, reused on the line and bar pages.
    const seriesB = Skia.Paint();
    seriesB.setColor(Skia.Color("#D07A1E"));
    seriesB.setAlphaf(0.55);

    const para = (text: string, size: number, color: string, width: number) => {
      const builder = Skia.ParagraphBuilder.Make({});
      builder.pushStyle({
        fontSize: size,
        fontFamilies: ["sans-serif"],
        color: Skia.Color(color),
      });
      builder.addText(text);
      const p = builder.build();
      p.layout(width);
      return p;
    };

    // The header component repeated on every page.
    const header = (canvas: SkCanvas, page: number, subtitle: string) => {
      para("Quarterly Metrics Report", 16, "#111111", 420).paint(
        canvas,
        54,
        32
      );
      para(subtitle, 10, "#555555", 420).paint(canvas, 54, 58);
      canvas.drawText("Page " + page + " of 4", 498, 44, ink, labelFont);
      canvas.drawLine(54, 84, 558, 84, axis);
    };

    // Chart frame: axes, horizontal grid lines, axis labels via drawText.
    const frame = (canvas: SkCanvas, yLabels: string[], xLabels: string[]) => {
      const left = 90;
      const top = 130;
      const right = 540;
      const bottom = 430;
      canvas.drawLine(left, top, left, bottom, axis);
      canvas.drawLine(left, bottom, right, bottom, axis);
      yLabels.forEach((label, i) => {
        const y = bottom - (i * (bottom - top)) / (yLabels.length - 1);
        if (i > 0) {
          canvas.drawLine(left, y, right, y, grid);
        }
        canvas.drawText(label, left - 28, y + 3, ink, axisFont);
      });
      xLabels.forEach((label, i) => {
        const x = left + (i * (right - left)) / (xLabels.length - 1);
        canvas.drawText(label, x - 8, bottom + 14, ink, axisFont);
      });
    };

    // --- Page 1: line chart, 50-point path + semi-transparent area overlay ---
    let canvas = doc.beginPage(W, H);
    header(canvas, 1, "Weekly revenue, trailing 50 weeks");
    frame(
      canvas,
      ["0", "25", "50", "75", "100"],
      ["W1", "W13", "W25", "W37", "W49"]
    );
    const value = (i: number, phase: number) =>
      50 + 32 * Math.sin(i / 5 + phase) + 10 * Math.sin(i / 2.1 + phase * 2);
    const px = (i: number) => 90 + (i * 450) / 49;
    const py = (v: number) => 430 - (v * 300) / 100;
    const areaB = Skia.Path.Make();
    areaB.moveTo(px(0), 430);
    for (let i = 0; i < 50; i++) {
      areaB.lineTo(px(i), py(value(i, 1.7)));
    }
    areaB.lineTo(px(49), 430);
    areaB.close();
    canvas.drawPath(areaB, seriesB);
    const lineA = Skia.Path.Make();
    for (let i = 0; i < 50; i++) {
      if (i === 0) {
        lineA.moveTo(px(i), py(value(i, 0)));
      } else {
        lineA.lineTo(px(i), py(value(i, 0)));
      }
    }
    const strokeA = Skia.Paint();
    strokeA.setColor(Skia.Color("#1E66D0"));
    strokeA.setStyle(1 as PaintStyle); // PaintStyle.Stroke
    strokeA.setStrokeWidth(2);
    canvas.drawPath(lineA, strokeA);
    para(
      "Revenue holds a 50-week upward drift; the shaded overlay is the forecast band.",
      9,
      "#555555",
      470
    ).paint(canvas, 54, 460);
    doc.endPage();

    // --- Page 2: bar chart, 30 rects (15 x 2 overlapping series) ---
    canvas = doc.beginPage(W, H);
    header(canvas, 2, "Monthly revenue by region");
    frame(
      canvas,
      ["0", "20", "40", "60", "80"],
      ["Jan", "Mar", "May", "Jul", "Sep", "Nov"]
    );
    const barY = (v: number) => 430 - (v * 300) / 80;
    for (let i = 0; i < 15; i++) {
      const a = 25 + ((i * 13) % 45);
      const b = 18 + ((i * 29) % 52);
      const x = 98 + i * 29;
      canvas.drawRect(Skia.XYWHRect(x, barY(a), 12, 430 - barY(a)), seriesA);
      canvas.drawRect(
        Skia.XYWHRect(x + 7, barY(b), 12, 430 - barY(b)),
        seriesB
      );
    }
    para(
      "North (solid) and South (translucent overlay) regions, Jan-Dec plus a partial preview month.",
      9,
      "#555555",
      470
    ).paint(canvas, 54, 460);
    doc.endPage();

    // --- Page 3: pie chart drawn with arcs + legend ---
    canvas = doc.beginPage(W, H);
    header(canvas, 3, "Traffic share by channel");
    const oval = Skia.XYWHRect(140, 150, 250, 250);
    const shares = [34, 22, 18, 12, 9, 5];
    const channels = [
      "Organic",
      "Paid",
      "Social",
      "Email",
      "Referral",
      "Other",
    ];
    const colors = [
      "#1E66D0",
      "#D07A1E",
      "#2E9E4F",
      "#B03A8C",
      "#6C6F7F",
      "#E0C341",
    ];
    let startAngle = -90;
    shares.forEach((share, i) => {
      const sweep = (share * 360) / 100;
      const slice = Skia.Paint();
      slice.setColor(Skia.Color(colors[i]));
      canvas.drawArc(oval, startAngle, sweep, true, slice);
      canvas.drawRect(Skia.XYWHRect(440, 160 + i * 24, 10, 10), slice);
      canvas.drawText(
        channels[i] + " " + share + "%",
        456,
        169 + i * 24,
        ink,
        axisFont
      );
      startAngle += sweep;
    });
    doc.endPage();

    // --- Page 4: scatter plot, 200 circles in two translucent series ---
    canvas = doc.beginPage(W, H);
    header(canvas, 4, "Latency vs throughput samples");
    frame(
      canvas,
      ["0", "50", "100", "150", "200"],
      ["0", "2k", "4k", "6k", "8k"]
    );
    const scatterA = Skia.Paint();
    scatterA.setColor(Skia.Color("#1E66D0"));
    scatterA.setAlphaf(0.6);
    const scatterB = Skia.Paint();
    scatterB.setColor(Skia.Color("#D07A1E"));
    scatterB.setAlphaf(0.6);
    let seed = 1234;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 200; i++) {
      canvas.drawCircle(
        92 + rand() * 444,
        132 + rand() * 294,
        2.5,
        i % 2 === 0 ? scatterA : scatterB
      );
    }
    doc.endPage();

    doc.close();
    return {
      b64: doc.getBase64(),
      genMs: Date.now() - t0,
      meta: { pages: 4, state: doc.state },
    };
  },
};

export const corpus: readonly CorpusDoc[] = [
  invoiceDoc,
  posterDoc,
  chartReportDoc,
];

// -----------------------------------------------------------------------------
// Compatibility report accumulator (host-side).
//
// Each spec creates a SuiteReporter, pushes one ReportRow per observation, and
// flushes it from an afterAll. Jest isolates the module registry per test
// file, so an in-memory array cannot be shared between PDFCorpus.spec.tsx and
// PDFEdgeCases.spec.tsx — instead each flush persists its suite's rows as a
// JSON section file inside __pdf_reports__/ and then regenerates
// compatibility-report.md from every section present on disk. This makes the
// report order-independent (whichever suite flushes last merges everything)
// and degrades gracefully: suites that were skipped record no rows, their
// stale section is removed, and only what actually ran is reported.
//
// __pdf_reports__/ holds generated artifacts only and is
// gitignored-by-convention (package-level config is owned elsewhere — do not
// commit its contents).
// -----------------------------------------------------------------------------

export interface ReportRow {
  feature: string;
  expected: string;
  observed: string;
  evidence: string;
  /** Whether the observation matched the expectation. */
  ok: boolean;
}

interface SuiteSection {
  suite: string;
  title: string;
  generatedAt: string;
  rows: ReportRow[];
}

export interface SuiteReporter {
  record: (row: ReportRow) => void;
  flush: () => void;
}

export const REPORTS_DIR = path.resolve(__dirname, "..", "__pdf_reports__");
const REPORT_PATH = path.join(REPORTS_DIR, "compatibility-report.md");
const sectionPath = (suite: string) =>
  path.join(REPORTS_DIR, `rows-${suite}.json`);

const escapeCell = (value: string) =>
  value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");

const renderSection = (section: SuiteSection): string[] => {
  const lines: string[] = [];
  lines.push(`## ${section.title}`);
  lines.push("");
  lines.push(`Generated: ${section.generatedAt}`);
  lines.push("");
  lines.push("| Feature | Expected | Observed | Evidence |");
  lines.push("| --- | --- | --- | --- |");
  section.rows.forEach((row) => {
    const observed = row.ok ? row.observed : `${row.observed} ⚠️ MISMATCH`;
    lines.push(
      `| ${escapeCell(row.feature)} | ${escapeCell(
        row.expected
      )} | ${escapeCell(observed)} | ${escapeCell(row.evidence)} |`
    );
  });
  lines.push("");
  return lines;
};

const regenerateReport = () => {
  if (!fs.existsSync(REPORTS_DIR)) {
    return;
  }
  const sections: SuiteSection[] = [];
  fs.readdirSync(REPORTS_DIR)
    .filter((file) => /^rows-[\w-]+\.json$/.test(file))
    .sort()
    .forEach((file) => {
      try {
        const parsed = JSON.parse(
          fs.readFileSync(path.join(REPORTS_DIR, file), "utf8")
        ) as SuiteSection;
        if (parsed && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
          sections.push(parsed);
        }
      } catch {
        // A malformed section (e.g. from an interrupted run) is skipped
        // rather than failing the suite teardown.
      }
    });
  if (sections.length === 0) {
    // Nothing ran (e.g. non-E2E mode where every test is skipped): leave no
    // misleading report behind.
    if (fs.existsSync(REPORT_PATH)) {
      fs.rmSync(REPORT_PATH);
    }
    return;
  }
  const total = sections.reduce((acc, s) => acc + s.rows.length, 0);
  const failed = sections.reduce(
    (acc, s) => acc + s.rows.filter((r) => !r.ok).length,
    0
  );
  const lines: string[] = [];
  lines.push("# Skia PDF backend — compatibility report");
  lines.push("");
  lines.push(
    "Generated by PDFCorpus.spec.tsx / PDFEdgeCases.spec.tsx (E2E). " +
      "Do not edit by hand; this directory is gitignored-by-convention."
  );
  lines.push("");
  lines.push(
    `Checks: ${total} — passed: ${total - failed}, mismatched: ${failed}. ` +
      "Only suites that actually ran are included."
  );
  lines.push("");
  sections.forEach((section) => {
    lines.push(...renderSection(section));
  });
  fs.writeFileSync(REPORT_PATH, lines.join("\n"));
};

export const createSuiteReporter = (
  suite: string,
  title: string
): SuiteReporter => {
  const rows: ReportRow[] = [];
  return {
    record: (row: ReportRow) => {
      rows.push(row);
    },
    flush: () => {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
      const file = sectionPath(suite);
      if (rows.length === 0) {
        // Suite was skipped (or recorded nothing): drop any stale section so
        // the report only reflects what ran.
        if (fs.existsSync(file)) {
          fs.rmSync(file);
        }
      } else {
        const section: SuiteSection = {
          suite,
          title,
          generatedAt: new Date().toISOString(),
          rows,
        };
        fs.writeFileSync(file, JSON.stringify(section, null, 2));
      }
      regenerateReport();
    },
  };
};
