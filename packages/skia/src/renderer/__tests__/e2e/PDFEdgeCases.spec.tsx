import { itRunsE2eOnly } from "../../../__tests__/setup";
import { surface } from "../setup";

import { createSuiteReporter } from "./setup/pdf-corpus";
import { parsePdf } from "./setup/pdf-utils";

/**
 * Edge-case suite for the Skia PDF backend: degenerate documents (zero pages,
 * empty page), stress shapes (200 pages, a 10000x10000pt page), repeated and
 * interleaved generation, and unicode metadata.
 *
 * Every eval callback below is serialized with fn.toString() and evaluated on
 * the device, so it may close over nothing but its (Skia, ctx) parameters and
 * must return JSON-serializable data. Non-BMP/CJK characters are produced via
 * String.fromCodePoint so the serialized source stays ASCII-clean.
 *
 * Observations are recorded into a module-level results array and flushed in
 * afterAll into __pdf_reports__ (gitignored-by-convention), where they are
 * merged with the corpus suite's rows into compatibility-report.md.
 */

const reporter = createSuiteReporter(
  "edge-cases",
  "Edge cases (PDFEdgeCases.spec.tsx)"
);

const record = (
  feature: string,
  expected: string,
  observed: string,
  evidence: string,
  ok: boolean
) => {
  reporter.record({ feature, expected, observed, evidence, ok });
};

describe("PDF edge cases", () => {
  afterAll(() => {
    // Persist this suite's rows and regenerate the merged compatibility
    // report (see setup/pdf-corpus.ts). Order-independent with the corpus
    // suite: whichever flushes last merges all sections present on disk.
    reporter.flush();
  });

  itRunsE2eOnly("closing a document with zero pages", async () => {
    const outcome = await surface.eval((Skia) => {
      const doc = Skia.PDF.MakeDocument();
      try {
        const bytes = doc.close();
        return {
          threw: null as string | null,
          byteLength: bytes.length,
          b64: doc.getBase64(),
          state: doc.state,
        };
      } catch (e) {
        return {
          threw: (e as Error).message,
          byteLength: -1,
          b64: "",
          state: doc.state,
        };
      }
    });
    // DOCUMENTED BEHAVIOR: a zero-page close() succeeds but produces ZERO
    // bytes — i.e. NOT a valid "%PDF-" file. SkPDF only serializes the file
    // header when the first page begins (SkPDFDocument::onBeginPage in
    // externals/skia/src/pdf/SkPDFDocument.cpp) and onClose() early-returns
    // when fPages is empty, so the in-memory stream is never written to.
    // Callers that want a valid PDF must add at least one page.
    record(
      "empty document: close() with zero pages",
      "close() succeeds (no throw), state becomes 'closed'",
      outcome.threw === null
        ? `no throw, state '${outcome.state}'`
        : `threw: ${outcome.threw}`,
      "device eval of close() on a fresh document",
      outcome.threw === null && outcome.state === "closed"
    );
    record(
      "empty document: output bytes",
      "0 bytes — empty output, NOT a valid %PDF file (documented)",
      `${outcome.byteLength} bytes, base64 '${outcome.b64}'`,
      "SkPDFDocument.cpp: header is serialized on first beginPage(); onClose() early-returns when fPages is empty",
      outcome.byteLength === 0 && outcome.b64 === ""
    );
    expect(outcome.threw).toBeNull();
    expect(outcome.state).toBe("closed");
    expect(outcome.byteLength).toBe(0);
    expect(outcome.b64).toBe("");
  });

  itRunsE2eOnly("a document with one empty page is valid", async () => {
    const b64 = await surface.eval((Skia) => {
      const doc = Skia.PDF.MakeDocument();
      doc.beginPage(612, 792);
      doc.endPage();
      doc.close();
      return doc.getBase64();
    });
    const pdf = await parsePdf(b64);
    const ok =
      pdf.header.startsWith("%PDF-1.") &&
      pdf.numPages === 1 &&
      pdf.pages[0].width === 612 &&
      pdf.pages[0].height === 792 &&
      pdf.pages[0].text === "" &&
      pdf.pages[0].imageCount === 0;
    record(
      "empty page: begin/end with no drawing",
      "valid 1-page 612x792 PDF, no text, no images, no fonts",
      `header ${pdf.header}, ${pdf.numPages} page(s), ${pdf.pages[0].width}x${pdf.pages[0].height}, text '${pdf.pages[0].text}', ${pdf.pages[0].imageCount} image(s)`,
      "pdfjs page parse",
      ok
    );
    expect(pdf.header.startsWith("%PDF-1.")).toBe(true);
    expect(pdf.numPages).toBe(1);
    expect(pdf.pages[0].width).toBe(612);
    expect(pdf.pages[0].height).toBe(792);
    expect(pdf.pages[0].text).toBe("");
    expect(pdf.pages[0].fonts).toEqual([]);
    expect(pdf.pages[0].imageCount).toBe(0);
  });

  itRunsE2eOnly("a 200-page document scales linearly", async () => {
    const result = await surface.eval((Skia) => {
      const build = (pages: number) => {
        const t0 = Date.now();
        const doc = Skia.PDF.MakeDocument();
        const paint = Skia.Paint();
        paint.setColor(Skia.Color("#3355AA"));
        for (let i = 0; i < pages; i++) {
          const canvas = doc.beginPage(612, 792);
          canvas.drawRect(Skia.XYWHRect(72, 72 + (i % 10) * 4, 120, 40), paint);
          doc.endPage();
        }
        const bytes = doc.close();
        return { size: bytes.length, ms: Date.now() - t0, doc };
      };
      const d50 = build(50);
      const d200 = build(200);
      return {
        size50: d50.size,
        size200: d200.size,
        ms200: d200.ms,
        b64: d200.doc.getBase64(),
      };
    });
    console.log(
      `[pdf-edge-cases] 200-page doc: ${result.size200} bytes in ${result.ms200}ms (50-page baseline: ${result.size50} bytes)`
    );
    const pdf = await parsePdf(result.b64);
    record(
      "volume: 200-page document",
      "parses, numPages = 200",
      `numPages = ${pdf.numPages}, ${result.size200} bytes, generated in ${result.ms200} ms`,
      "pdfjs parse of the on-device output",
      pdf.numPages === 200
    );
    expect(pdf.numPages).toBe(200);
    expect(pdf.pages[0].width).toBe(612);
    expect(pdf.pages[199].height).toBe(792);

    // Linear-ish growth: pages carry near-identical content, so 4x the pages
    // should cost roughly 4x the bytes. The wide [2.5, 5.5] band tolerates
    // fixed overhead (header/xref/trailer) and shared-object amortization
    // while still catching super-linear blowups (e.g. per-page duplication of
    // what should be shared resources).
    const ratio = result.size200 / result.size50;
    record(
      "volume: size growth 50 -> 200 pages",
      "~4x bytes (linear-ish, band 2.5x-5.5x)",
      `${result.size50} -> ${result.size200} bytes (${ratio.toFixed(2)}x)`,
      "byte sizes of two documents with identical per-page content",
      ratio > 2.5 && ratio < 5.5
    );
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(5.5);
  });

  itRunsE2eOnly("a huge 10000x10000 page round-trips", async () => {
    // 10000pt is within the classic PDF implementation ceiling of 14400pt
    // (200in) per side, so a conforming reader must accept it.
    const b64 = await surface.eval((Skia) => {
      const doc = Skia.PDF.MakeDocument();
      const canvas = doc.beginPage(10000, 10000);
      const fill = Skia.Paint();
      fill.setColor(Skia.Color("#EEF2F8"));
      canvas.drawRect(Skia.XYWHRect(0, 0, 10000, 10000), fill);
      const marker = Skia.Paint();
      marker.setColor(Skia.Color("#AA3355"));
      canvas.drawCircle(50, 50, 40, marker);
      canvas.drawCircle(9950, 9950, 40, marker);
      doc.endPage();
      doc.close();
      return doc.getBase64();
    });
    const pdf = await parsePdf(b64);
    record(
      "huge page: 10000x10000 pt",
      "valid single page with 10000x10000 MediaBox",
      `${pdf.numPages} page(s), ${pdf.pages[0].width}x${pdf.pages[0].height}`,
      "pdfjs viewport at scale 1",
      pdf.numPages === 1 &&
        pdf.pages[0].width === 10000 &&
        pdf.pages[0].height === 10000
    );
    expect(pdf.numPages).toBe(1);
    expect(pdf.pages[0].width).toBe(10000);
    expect(pdf.pages[0].height).toBe(10000);
  });

  itRunsE2eOnly("30 repeated generations are stable", async () => {
    const result = await surface.eval((Skia) => {
      const sizes: number[] = [];
      let firstB64 = "";
      for (let i = 0; i < 30; i++) {
        const doc = Skia.PDF.MakeDocument();
        const canvas = doc.beginPage(300, 300);
        const paint = Skia.Paint();
        paint.setColor(Skia.Color("teal"));
        canvas.drawCircle(150, 150, 100, paint);
        doc.endPage();
        const bytes = doc.close();
        sizes.push(bytes.length);
        if (i === 0) {
          firstB64 = doc.getBase64();
        }
      }
      return { sizes, firstB64 };
    });
    // Vector-only content and no caller-provided dates: SkPDF output for the
    // same input must be byte-stable, so every generation has the same size
    // (and the device survived 30 full create/close cycles in one eval).
    const allEqual = result.sizes.every((size) => size === result.sizes[0]);
    record(
      "stability: 30 repeated generations",
      "30 documents, all byte-identical in size, no crash",
      `sizes: [${result.sizes[0]} x ${result.sizes.length}] all equal: ${allEqual}`,
      "byte sizes returned from a single on-device eval loop",
      result.sizes.length === 30 && allEqual
    );
    expect(result.sizes).toHaveLength(30);
    expect(allEqual).toBe(true);
    const pdf = await parsePdf(result.firstB64);
    expect(pdf.numPages).toBe(1);
    expect(pdf.header.startsWith("%PDF-1.")).toBe(true);
  });

  itRunsE2eOnly("unicode metadata round-trips", async () => {
    // "Hello world" in CJK + a katakana author, both built through
    // String.fromCodePoint so the serialized eval source stays ASCII.
    const expectedTitle = String.fromCodePoint(0x4f60, 0x597d, 0x4e16, 0x754c);
    const expectedAuthor = String.fromCodePoint(0x30c6, 0x30b9, 0x30c8);
    const b64 = await surface.eval((Skia) => {
      const title = String.fromCodePoint(0x4f60, 0x597d, 0x4e16, 0x754c);
      const author = String.fromCodePoint(0x30c6, 0x30b9, 0x30c8);
      const doc = Skia.PDF.MakeDocument({
        title,
        author,
        creator: "PDFEdgeCases.spec.tsx",
      });
      doc.beginPage(200, 200);
      doc.endPage();
      doc.close();
      return doc.getBase64();
    });
    const pdf = await parsePdf(b64);
    const ok =
      pdf.metadata.title === expectedTitle &&
      pdf.metadata.author === expectedAuthor;
    record(
      "metadata: CJK title/author round-trip",
      `title '${expectedTitle}', author '${expectedAuthor}'`,
      `title '${pdf.metadata.title}', author '${pdf.metadata.author}'`,
      "pdfjs getMetadata() (SkPDF stores non-ASCII strings as UTF-16BE)",
      ok
    );
    expect(pdf.metadata.title).toBe(expectedTitle);
    expect(pdf.metadata.author).toBe(expectedAuthor);
    expect(pdf.metadata.creator).toBe("PDFEdgeCases.spec.tsx");
  });

  itRunsE2eOnly("two interleaved documents stay isolated", async () => {
    const result = await surface.eval((Skia) => {
      const para = (text: string, color: string) => {
        const builder = Skia.ParagraphBuilder.Make({});
        builder.pushStyle({
          fontSize: 18,
          fontFamilies: ["sans-serif"],
          color: Skia.Color(color),
        });
        builder.addText(text);
        const p = builder.build();
        p.layout(360);
        return p;
      };
      const docA = Skia.PDF.MakeDocument({ title: "Doc A" });
      const docB = Skia.PDF.MakeDocument({ title: "Doc B" });
      // Interleave: open both pages, alternate drawing between the two open
      // canvases, end/close in mixed order.
      const pageA = docA.beginPage(612, 792);
      const pageB = docB.beginPage(420, 595);
      const paintA = Skia.Paint();
      paintA.setColor(Skia.Color("#005500"));
      const paintB = Skia.Paint();
      paintB.setColor(Skia.Color("#550000"));
      pageA.drawRect(Skia.XYWHRect(10, 10, 100, 100), paintA);
      pageB.drawCircle(100, 100, 50, paintB);
      para("ALPHA", "#005500").paint(pageA, 40, 200);
      para("BRAVO", "#550000").paint(pageB, 40, 200);
      pageA.drawCircle(300, 300, 40, paintA);
      docB.endPage();
      // B's page has ended; A's page must still be drawable.
      pageA.drawRect(Skia.XYWHRect(200, 400, 50, 50), paintA);
      docA.endPage();
      // A gets a second page; B is closed first.
      const pageA2 = docA.beginPage(612, 792);
      pageA2.drawCircle(50, 50, 20, paintA);
      docA.endPage();
      docB.close();
      docA.close();
      return {
        a: docA.getBase64(),
        b: docB.getBase64(),
        aState: docA.state,
        bState: docB.state,
      };
    });
    expect(result.aState).toBe("closed");
    expect(result.bState).toBe("closed");
    const pdfA = await parsePdf(result.a);
    const pdfB = await parsePdf(result.b);
    const isolated =
      pdfA.numPages === 2 &&
      pdfB.numPages === 1 &&
      pdfA.pages[0].text.includes("ALPHA") &&
      !pdfA.pages[0].text.includes("BRAVO") &&
      pdfB.pages[0].text.includes("BRAVO") &&
      !pdfB.pages[0].text.includes("ALPHA");
    record(
      "concurrency: two interleaved documents",
      "A: 2 pages 612x792 containing only ALPHA; B: 1 page 420x595 containing only BRAVO",
      `A: ${pdfA.numPages} page(s) ${pdfA.pages[0].width}x${pdfA.pages[0].height}, text '${pdfA.pages[0].text}'; B: ${pdfB.numPages} page(s) ${pdfB.pages[0].width}x${pdfB.pages[0].height}, text '${pdfB.pages[0].text}'`,
      "pdfjs parse of both documents built in one interleaved eval",
      isolated
    );
    expect(pdfA.numPages).toBe(2);
    expect(pdfA.pages[0].width).toBe(612);
    expect(pdfA.pages[0].height).toBe(792);
    expect(pdfA.metadata.title).toBe("Doc A");
    expect(pdfA.pages[0].text).toContain("ALPHA");
    expect(pdfA.pages[0].text).not.toContain("BRAVO");
    expect(pdfB.numPages).toBe(1);
    expect(pdfB.pages[0].width).toBe(420);
    expect(pdfB.pages[0].height).toBe(595);
    expect(pdfB.metadata.title).toBe("Doc B");
    expect(pdfB.pages[0].text).toContain("BRAVO");
    expect(pdfB.pages[0].text).not.toContain("ALPHA");
  });
});
