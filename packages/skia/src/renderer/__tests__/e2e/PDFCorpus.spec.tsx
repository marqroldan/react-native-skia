import { itRunsE2eOnly } from "../../../__tests__/setup";
import { surface } from "../setup";

import { corpus, createSuiteReporter } from "./setup/pdf-corpus";
import { parsePdf } from "./setup/pdf-utils";

/**
 * Realistic-document corpus for the Skia PDF backend.
 *
 * Each corpus entry (see setup/pdf-corpus.ts) is generated ON-DEVICE via
 * surface.eval and validated HOST-SIDE with pdfjs (parsePdf): page counts,
 * extractable text, font embedding/subsetting, image-XObject counts and
 * byte-size budgets. On-device generation time is measured and logged.
 *
 * Every observation is also pushed into a module-level results array (the
 * suite reporter); the afterAll below persists it and regenerates
 * __pdf_reports__/compatibility-report.md, merging in the edge-case suite's
 * rows when that suite has run too. The __pdf_reports__ directory contains
 * generated artifacts only and is gitignored-by-convention (package-level
 * config such as .gitignore is owned elsewhere).
 */

const reporter = createSuiteReporter(
  "corpus",
  "Realistic document corpus (PDFCorpus.spec.tsx)"
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

const preview = (text: string, max = 96) =>
  text.length > max ? `${text.slice(0, max)}...` : text;

describe("PDF corpus", () => {
  afterAll(() => {
    // Writes __pdf_reports__/compatibility-report.md from everything recorded
    // in this run (corpus + edge-case rows when both suites ran). Degrades
    // gracefully: skipped suites record nothing and are simply absent.
    reporter.flush();
  });

  corpus.forEach((doc) => {
    itRunsE2eOnly(`builds the ${doc.key} document`, async () => {
      const result = await surface.eval(doc.build);
      const bytes = Buffer.from(result.b64, "base64").byteLength;
      // Generation time is informational: logged and recorded in the report,
      // but not asserted (device speed varies too much for a hard budget —
      // the 30s eval timeout is the implicit ceiling).
      console.log(
        `[pdf-corpus] ${doc.key}: ${bytes} bytes, generated on-device in ${result.genMs}ms`
      );
      record(
        `${doc.key}: on-device generation time`,
        "measured (informational)",
        `${result.genMs} ms for ${bytes} bytes`,
        "Date.now() around the build on-device",
        true
      );

      const pdf = await parsePdf(result.b64);

      const headerOk = pdf.header.startsWith("%PDF-1.");
      record(
        `${doc.key}: file header`,
        "%PDF-1.x",
        pdf.header,
        "first 8 bytes of the output",
        headerOk
      );
      expect(headerOk).toBe(true);

      record(
        `${doc.key}: page count`,
        String(doc.pages),
        String(pdf.numPages),
        "pdfjs numPages",
        pdf.numPages === doc.pages
      );
      expect(pdf.numPages).toBe(doc.pages);

      // Text extraction: the expected snippets must be recoverable from the
      // page they were drawn on (drawText and Paragraph both go through
      // SkPDF's ToUnicode mapping).
      doc.expectedText.forEach(({ page, snippet }) => {
        const { text } = pdf.pages[page - 1];
        const found = text.includes(snippet);
        record(
          `${doc.key}: text "${snippet}" on page ${page}`,
          "extractable",
          found ? "found" : `missing - page text: "${preview(text)}"`,
          "pdfjs getTextContent()",
          found
        );
        expect(text).toContain(snippet);
      });

      // Every page that carries text must reference at least one font, and
      // every font in the document must be embedded and subset-prefixed
      // ("ABCDEF+PostScriptName") — the repo builds SkPDF with harfbuzz
      // subsetting enabled, so a non-subset font is a regression.
      const textPages = Array.from(
        new Set(doc.expectedText.map((entry) => entry.page))
      ).sort((a, b) => a - b);
      textPages.forEach((page) => {
        expect(pdf.pages[page - 1].fonts.length).toBeGreaterThanOrEqual(1);
      });
      const fonts = pdf.pages.flatMap((page) => page.fonts);
      const fontNames = Array.from(
        new Set(fonts.map((font) => font.name ?? "<unnamed>"))
      );
      const allEmbedded = fonts.every((font) => font.embedded);
      record(
        `${doc.key}: fonts embedded`,
        "every referenced font embedded",
        `${fontNames.join(", ")} - embedded: ${allEmbedded}`,
        "pdfjs font objects (missingFile)",
        allEmbedded
      );
      const allSubset = fonts.every((font) => font.subsetPrefix !== null);
      record(
        `${doc.key}: fonts subsetted`,
        "every font name carries an ABCDEF+ subset prefix",
        `${fontNames.join(", ")} - subsetted: ${allSubset}`,
        "PostScript name prefix",
        allSubset
      );
      fonts.forEach((font) => {
        expect(font.embedded).toBe(true);
        expect(font.subsetPrefix).not.toBeNull();
      });

      // Image XObjects: the invoice must contain exactly its logo (page 1),
      // the poster exactly its clipped hero, and the charts none at all —
      // gradients and translucent overlays must stay vector.
      const observedImages = pdf.pages.map((page) => page.imageCount);
      const imagesOk =
        JSON.stringify(observedImages) ===
        JSON.stringify(doc.expectedImagesPerPage);
      record(
        `${doc.key}: images per page`,
        JSON.stringify(doc.expectedImagesPerPage),
        JSON.stringify(observedImages),
        "pdfjs operator list (paintImageXObject)",
        imagesOk
      );
      expect(observedImages).toEqual(doc.expectedImagesPerPage);

      // Size budget — a loose regression tripwire, not a hard truth; the
      // rationale for each number lives next to the corpus entry.
      record(
        `${doc.key}: size budget`,
        `< ${doc.maxBytes} bytes`,
        `${bytes} bytes`,
        "byte length of the decoded base64 output",
        bytes < doc.maxBytes
      );
      expect(bytes).toBeLessThan(doc.maxBytes);
    });
  });
});
