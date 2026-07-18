import { itRunsE2eOnly } from "../../../__tests__/setup";
import { surface } from "../setup";

import { parsePdf } from "./setup/pdf-utils";

const LETTER = { width: 612, height: 792 };
const A5 = { width: 420, height: 595 };
const PANGRAM = "The quick brown fox jumps over the lazy dog";

describe("PDF", () => {
  itRunsE2eOnly("is available on the device", async () => {
    const available = await surface.eval((Skia) => Skia.PDF.isAvailable());
    expect(available).toBe(true);
  });

  itRunsE2eOnly("creates a valid single-page document", async () => {
    const base64 = await surface.eval((Skia, ctx) => {
      const doc = Skia.PDF.MakeDocument();
      const canvas = doc.beginPage(ctx.width, ctx.height);
      const paint = Skia.Paint();
      paint.setColor(Skia.Color("cyan"));
      canvas.drawRect(Skia.XYWHRect(72, 72, 200, 100), paint);
      doc.endPage();
      doc.close();
      return doc.getBase64();
    }, LETTER);
    const pdf = await parsePdf(base64);
    expect(pdf.header.startsWith("%PDF-1.")).toBe(true);
    expect(pdf.numPages).toBe(1);
    expect(pdf.pages[0].width).toBe(LETTER.width);
    expect(pdf.pages[0].height).toBe(LETTER.height);
  });

  itRunsE2eOnly("round-trips the document metadata", async () => {
    const metadata = {
      title: "E2E Test Document",
      author: "React Native Skia",
      creator: "PDF.spec.tsx",
    };
    const base64 = await surface.eval((Skia, ctx) => {
      const doc = Skia.PDF.MakeDocument({
        title: ctx.title,
        author: ctx.author,
        creator: ctx.creator,
      });
      doc.beginPage(200, 200);
      doc.endPage();
      doc.close();
      return doc.getBase64();
    }, metadata);
    const pdf = await parsePdf(base64);
    expect(pdf.metadata.title).toBe(metadata.title);
    expect(pdf.metadata.author).toBe(metadata.author);
    expect(pdf.metadata.creator).toBe(metadata.creator);
  });

  itRunsE2eOnly("creates a document with multiple pages", async () => {
    const base64 = await surface.eval(
      (Skia, ctx) => {
        const doc = Skia.PDF.MakeDocument();
        const paint = Skia.Paint();
        paint.setColor(Skia.Color("magenta"));
        const first = doc.beginPage(ctx.first.width, ctx.first.height);
        first.drawRect(Skia.XYWHRect(10, 10, 100, 80), paint);
        doc.endPage();
        const second = doc.beginPage(ctx.second.width, ctx.second.height);
        second.drawCircle(150, 150, 50, paint);
        doc.endPage();
        doc.close();
        return doc.getBase64();
      },
      { first: LETTER, second: A5 }
    );
    const pdf = await parsePdf(base64);
    expect(pdf.numPages).toBe(2);
    expect(pdf.pages[0].width).toBe(LETTER.width);
    expect(pdf.pages[0].height).toBe(LETTER.height);
    expect(pdf.pages[1].width).toBe(A5.width);
    expect(pdf.pages[1].height).toBe(A5.height);
  });

  itRunsE2eOnly("enforces the document lifecycle", async () => {
    const results = await surface.eval((Skia) => {
      const capture = (fn: () => void) => {
        try {
          fn();
          return "no error thrown";
        } catch (e) {
          return (e as Error).message;
        }
      };
      return {
        doubleBegin: capture(() => {
          const doc = Skia.PDF.MakeDocument();
          doc.beginPage(100, 100);
          doc.beginPage(100, 100);
        }),
        closeWithPage: capture(() => {
          const doc = Skia.PDF.MakeDocument();
          doc.beginPage(100, 100);
          doc.close();
        }),
        endPageNoPage: capture(() => {
          const doc = Skia.PDF.MakeDocument();
          doc.endPage();
        }),
        negativeDims: capture(() => {
          const doc = Skia.PDF.MakeDocument();
          doc.beginPage(-100, 100);
        }),
        useAfterAbort: capture(() => {
          const doc = Skia.PDF.MakeDocument();
          doc.abort();
          doc.beginPage(100, 100);
        }),
        abortAfterClose: capture(() => {
          const doc = Skia.PDF.MakeDocument();
          doc.close();
          doc.abort();
        }),
        staleCanvas: capture(() => {
          const doc = Skia.PDF.MakeDocument();
          const canvas = doc.beginPage(100, 100);
          doc.endPage();
          canvas.drawColor(Skia.Color("red"));
        }),
        idempotentClose: (() => {
          const doc = Skia.PDF.MakeDocument();
          doc.beginPage(100, 100);
          doc.endPage();
          const first = doc.close();
          const second = doc.close();
          return first.length > 0 && first.length === second.length;
        })(),
        abortIdempotent: (() => {
          const doc = Skia.PDF.MakeDocument();
          doc.abort();
          doc.abort();
          return doc.state;
        })(),
      };
    });
    expect(results.doubleBegin).toContain(
      "beginPage() failed: a page is already open. " +
        "Call endPage() before starting a new page."
    );
    expect(results.closeWithPage).toContain(
      "close() failed: a page is still open. " +
        "Call endPage() before closing the document."
    );
    expect(results.endPageNoPage).toContain(
      "endPage() failed: no page is open. Call beginPage() first."
    );
    expect(results.negativeDims).toContain(
      "beginPage() failed: width and height must be > 0."
    );
    expect(results.useAfterAbort).toContain(
      "This PDF document was aborted and can no longer be used."
    );
    expect(results.abortAfterClose).toContain(
      "abort() failed: the document is already closed."
    );
    expect(results.staleCanvas).toContain(
      "This canvas belonged to a PDF page that has ended. " +
        "Draw between beginPage() and endPage()."
    );
    expect(results.idempotentClose).toBe(true);
    expect(results.abortIdempotent).toBe("aborted");
  });

  itRunsE2eOnly("embeds subsetted fonts with extractable text", async () => {
    const base64 = await surface.eval(
      (Skia, ctx) => {
        const doc = Skia.PDF.MakeDocument();
        const canvas = doc.beginPage(ctx.width, ctx.height);
        const builder = Skia.ParagraphBuilder.Make({});
        builder.pushStyle({
          fontSize: 20,
          fontFamilies: ["sans-serif"],
          color: Skia.Color("black"),
        });
        builder.addText(ctx.text);
        const paragraph = builder.build();
        paragraph.layout(ctx.width - 144);
        paragraph.paint(canvas, 72, 72);
        doc.endPage();
        doc.close();
        return doc.getBase64();
      },
      { ...LETTER, text: PANGRAM }
    );
    const pdf = await parsePdf(base64);
    expect(pdf.numPages).toBe(1);
    const [page] = pdf.pages;
    expect(page.text).toContain("quick brown fox");
    expect(page.fonts.length).toBeGreaterThanOrEqual(1);
    // SkPDF subsets embedded fonts: "ABCDEF+PostScriptName".
    expect(page.fonts.some((font) => /^[A-Z]{6}\+/.test(font.name ?? ""))).toBe(
      true
    );
    page.fonts.forEach((font) => {
      expect(font.embedded).toBe(true);
    });
  });
});
