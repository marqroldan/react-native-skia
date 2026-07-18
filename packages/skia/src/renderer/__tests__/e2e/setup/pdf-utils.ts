import type * as Pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

// pdfjs-dist v6 ships ESM-only builds that use import.meta, which Jest's
// sandboxed CommonJS runtime cannot parse (and Jest also wraps createRequire,
// so requiring through "module" hits the same sandbox). Node >= 22.12 can
// require() synchronous ESM graphs natively, so we grab the genuine
// node:module via process.getBuiltinModule — the one escape hatch Jest cannot
// intercept — and load pdfjs with Node's own require.
const nativeRequire = process
  .getBuiltinModule("module")
  .createRequire(__filename);
const { getDocument, OPS } = nativeRequire(
  "pdfjs-dist/legacy/build/pdf.mjs"
) as typeof Pdfjs;

export interface ParsedPdfFont {
  /** Full PostScript name as embedded, e.g. "ABCDEF+Roboto-Regular". */
  name: string | null;
  /** "ABCDEF+" when the font is subsetted, null otherwise. */
  subsetPrefix: string | null;
  /** True when the font program is embedded in the document. */
  embedded: boolean;
  isType3Font: boolean;
}

export interface ParsedPdfPage {
  width: number;
  height: number;
  text: string;
  fonts: ParsedPdfFont[];
  imageCount: number;
}

export interface ParsedPdfMetadata {
  title: string | null;
  author: string | null;
  creator: string | null;
  producer: string | null;
  pdfVersion: string | null;
}

export interface ParsedPdf {
  header: string;
  numPages: number;
  pages: ParsedPdfPage[];
  metadata: ParsedPdfMetadata;
}

/** The subset of pdfjs font properties the report relies on. */
interface PdfjsFontLike {
  loadedName?: string;
  name?: string;
  missingFile?: boolean;
  isType3Font?: boolean;
}

const asString = (value: unknown) => (typeof value === "string" ? value : null);

const splitSubsetPrefix = (name: string | null) => {
  const match = /^([A-Z]{6})\+/.exec(name ?? "");
  return match ? `${match[1]}+` : null;
};

/**
 * Parses a base64 encoded PDF with pdfjs-dist (legacy Node build) and returns
 * a JSON-friendly report of its structure: header, page geometry, extracted
 * text, referenced fonts (with embedding/subsetting info) and image ops.
 *
 * Runs host-side (Node) — used to validate documents produced on the device
 * by Skia.PDF.
 */
export const parsePdf = async (base64: string): Promise<ParsedPdf> => {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  // Read the header before handing the buffer to pdfjs.
  const header = Buffer.from(bytes.slice(0, 8)).toString("latin1");
  const loadingTask = getDocument({
    data: bytes,
    // Node: no worker; keep it self-contained and quiet.
    useSystemFonts: true,
    verbosity: 0,
  });
  try {
    const doc = await loadingTask.promise;

    const { info } = await doc.getMetadata();
    const dict = info as Record<string, unknown>;
    const metadata: ParsedPdfMetadata = {
      title: asString(dict.Title),
      author: asString(dict.Author),
      creator: asString(dict.Creator),
      producer: asString(dict.Producer),
      pdfVersion: asString(dict.PDFFormatVersion),
    };

    const pages: ParsedPdfPage[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });

      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join("")
        .trim();

      // The operator list yields the image ops and — as a side effect —
      // forces every font referenced by the page into page.commonObjs.
      const opList = await page.getOperatorList();
      let imageCount = 0;
      const loadedNames = new Set<string>();
      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        if (
          fn === OPS.paintImageXObject ||
          fn === OPS.paintInlineImageXObject
        ) {
          imageCount++;
        } else if (fn === OPS.setFont) {
          // args: [loadedName, size]
          const name: unknown = opList.argsArray[i]?.[0];
          if (typeof name === "string" && name.startsWith("g_")) {
            loadedNames.add(name);
          }
        } else if (fn === OPS.dependency) {
          for (const dep of opList.argsArray[i] ?? []) {
            if (
              typeof dep === "string" &&
              dep.startsWith("g_") &&
              dep.includes("_f")
            ) {
              loadedNames.add(dep);
            }
          }
        }
      }

      // PDFObjects has no public key iterator in this pdfjs version, so the
      // loadedNames collected from the operator list are resolved one by one.
      const fonts: ParsedPdfFont[] = [];
      for (const loadedName of loadedNames) {
        if (!page.commonObjs.has(loadedName)) {
          continue;
        }
        const font = page.commonObjs.get(loadedName) as PdfjsFontLike | null;
        if (!font || typeof font !== "object" || !("loadedName" in font)) {
          continue;
        }
        const name = font.name ?? null;
        fonts.push({
          name,
          subsetPrefix: splitSubsetPrefix(name),
          // pdfjs sets missingFile when there is no embedded font program.
          embedded: !font.missingFile,
          isType3Font: !!font.isType3Font,
        });
      }
      fonts.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

      pages.push({
        width: viewport.width,
        height: viewport.height,
        text,
        fonts,
        imageCount,
      });
    }

    return { header, numPages: doc.numPages, pages, metadata };
  } finally {
    // destroy() lives on the loading task (PDFDocumentProxy has none).
    await loadingTask.destroy();
  }
};
