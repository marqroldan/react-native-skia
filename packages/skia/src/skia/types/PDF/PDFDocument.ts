import type { ReactElement } from "react";

import type { SkCanvas } from "../Canvas";
import type { SkData } from "../Data";
import type { SkJSIInstance } from "../JsiInstance";
import type { SkRect } from "../Rect";

/**
 * Lifecycle state of a PDF document:
 * - "open": document created, no page currently being recorded.
 * - "page-open": a page has been started with beginPage() and not yet ended.
 * - "closed": close() has been called and the document bytes are finalized.
 * - "aborted": abort() has been called and the document is discarded.
 */
export type PDFDocumentState = "open" | "page-open" | "closed" | "aborted";

export interface SkPDFDocument extends SkJSIInstance<"PDFDocument"> {
  /**
   * Starts a new page and returns the canvas to draw its content on.
   * Dimensions are in PDF points (1 point = 1/72 inch).
   *
   * The returned canvas is only valid until endPage(), close(), or abort()
   * is called — using it afterwards throws.
   *
   * @param width Page width in PDF points.
   * @param height Page height in PDF points.
   * @param contentRect Optional rect (in PDF points) to clip the drawable
   *                    content area to.
   */
  beginPage(width: number, height: number, contentRect?: SkRect): SkCanvas;

  /**
   * Ends the page started by beginPage() and invalidates the canvas that
   * was returned by it.
   */
  endPage(): void;

  /**
   * Finalizes the document on the first call and returns the PDF bytes.
   * Idempotent — repeated calls return the cached result.
   * Throws if a page is still open or the document was aborted.
   */
  close(): Uint8Array;

  /**
   * Returns the finalized document as a zero-copy SkData, suitable for
   * passing to other Skia APIs. Only valid after close().
   */
  makeData(): SkData;

  /**
   * Returns the finalized document as a base64 encoded string — a
   * convenience for building Share data-URLs. Only valid after close().
   */
  getBase64(): string;

  /**
   * Discards the document. Safe to call from the "open" and "page-open"
   * states; a no-op when already aborted. Throws when the document has
   * been closed.
   */
  abort(): void;

  /**
   * The current lifecycle state of the document.
   */
  readonly state: PDFDocumentState;
}

/**
 * Describes a single page to be rendered by renderAsPDF().
 */
export interface PDFPage {
  /**
   * Page width in PDF points (1 point = 1/72 inch).
   */
  width: number;
  /**
   * Page height in PDF points (1 point = 1/72 inch).
   */
  height: number;
  /**
   * The Skia element to draw as the page content.
   */
  element: ReactElement;
}
