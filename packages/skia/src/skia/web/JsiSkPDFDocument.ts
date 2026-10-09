import type { Canvas, CanvasKit, Rect } from "canvaskit-wasm";

import type {
  PDFDocumentState,
  PDFMetadata,
  SkCanvas,
  SkData,
  SkPDFDocument,
  SkRect,
} from "../types";

import { JsiSkCanvas } from "./JsiSkCanvas";
import { JsiSkData } from "./JsiSkData";
import { BaseHostObject } from "./Host";
import { JsiSkRect } from "./JsiSkRect";

type CanvasKitPDFDocument = {
  state: PDFDocumentState;
  _beginPage(width: number, height: number, contentRect?: Rect): Canvas | null;
  _endPage(): boolean;
  _close(): Uint8Array;
  _makeData(): Uint8Array;
  _getBase64(): string;
  _abort(): boolean;
  delete(): void;
  isDeleted?: () => boolean;
};

export type CanvasKitWithPDF = CanvasKit & {
  PDF?: {
    isAvailable(): boolean;
    MakeDocument(metadata?: PDFMetadata): CanvasKitPDFDocument | null;
  };
};

const PAGE_ALREADY_OPEN =
  "beginPage() failed: a page is already open. Call endPage() before starting a new page.";
const NO_PAGE_OPEN =
  "endPage() failed: no page is open. Call beginPage() first.";
const INVALID_PAGE_SIZE = "beginPage() failed: width and height must be > 0.";
const CLOSED_DOCUMENT =
  "This PDF document is closed. No further pages can be added.";
const ABORTED_DOCUMENT =
  "This PDF document was aborted and can no longer be used.";
const CLOSE_WITH_OPEN_PAGE =
  "close() failed: a page is still open. Call endPage() before closing the document.";
const NOT_FINISHED =
  "The PDF document is not finished. Call close() before reading the output.";
const CLOSED_ABORT = "abort() failed: the document is already closed.";
const INVALID_PAGE_CANVAS =
  "This PDF page canvas is no longer valid because its page has ended.";

const invalidPageCanvas = (): Canvas =>
  new Proxy({} as Canvas, {
    get() {
      throw new Error(INVALID_PAGE_CANVAS);
    },
  });

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

class JsiSkPDFPageCanvas extends JsiSkCanvas {
  private owner: JsiSkPDFDocument | null;
  private invalidated = false;

  constructor(CanvasKit: CanvasKit, ref: Canvas, owner: JsiSkPDFDocument) {
    super(CanvasKit, ref);
    this.owner = owner;
  }

  invalidate() {
    if (this.invalidated) {
      return;
    }
    this.ref = invalidPageCanvas();
    if (this.owner !== null) {
      this.owner = null;
    }
    this.invalidated = true;
  }

  // The page canvas is owned by SkDocument, not by this JS wrapper. Detach it
  // instead of calling Embind's delete() on a document-owned raw pointer.
  [Symbol.dispose](): void {
    this.invalidate();
  }
}

export class JsiSkPDFDocument
  extends BaseHostObject<CanvasKitPDFDocument, "PDFDocument">
  implements SkPDFDocument
{
  private pageCanvas: JsiSkPDFPageCanvas | null = null;

  constructor(CanvasKit: CanvasKit, ref: CanvasKitPDFDocument) {
    super(CanvasKit, ref, "PDFDocument");
  }

  beginPage(width: number, height: number, contentRect?: SkRect): SkCanvas {
    switch (this.ref.state) {
      case "page-open":
        throw new Error(PAGE_ALREADY_OPEN);
      case "closed":
        throw new Error(CLOSED_DOCUMENT);
      case "aborted":
        throw new Error(ABORTED_DOCUMENT);
      case "open":
        break;
    }

    if (!(width > 0 && height > 0)) {
      throw new Error(INVALID_PAGE_SIZE);
    }

    const rect = contentRect
      ? JsiSkRect.fromValue(this.CanvasKit, contentRect)
      : undefined;
    const page = this.ref._beginPage(width, height, rect);
    if (page === null) {
      throw new Error(
        "beginPage() failed: Skia could not create the page canvas."
      );
    }

    const pageCanvas = new JsiSkPDFPageCanvas(this.CanvasKit, page, this);
    this.pageCanvas = pageCanvas;
    return pageCanvas;
  }

  endPage(): void {
    switch (this.ref.state) {
      case "open":
        throw new Error(NO_PAGE_OPEN);
      case "closed":
        throw new Error(CLOSED_DOCUMENT);
      case "aborted":
        throw new Error(ABORTED_DOCUMENT);
      case "page-open":
        break;
    }

    this.invalidatePageCanvas();
    this.ref._endPage();
  }

  close(): Uint8Array {
    switch (this.ref.state) {
      case "page-open":
        throw new Error(CLOSE_WITH_OPEN_PAGE);
      case "aborted":
        throw new Error(ABORTED_DOCUMENT);
      case "closed":
      case "open":
        break;
    }

    this.invalidatePageCanvas();
    return this.ref._close();
  }

  makeData(): SkData {
    if (this.ref.state !== "closed") {
      throw new Error(NOT_FINISHED);
    }
    return new JsiSkData(this.CanvasKit, toArrayBuffer(this.ref._makeData()));
  }

  getBase64(): string {
    if (this.ref.state !== "closed") {
      throw new Error(NOT_FINISHED);
    }
    return this.ref._getBase64();
  }

  abort(): void {
    switch (this.ref.state) {
      case "closed":
        throw new Error(CLOSED_ABORT);
      case "aborted":
        return;
      case "open":
      case "page-open":
        break;
    }

    this.invalidatePageCanvas();
    this.ref._abort();
  }

  get state(): PDFDocumentState {
    return this.ref.state;
  }

  [Symbol.dispose](): void {
    this.invalidatePageCanvas();
    super[Symbol.dispose]();
  }

  private invalidatePageCanvas() {
    this.pageCanvas?.invalidate();
    this.pageCanvas = null;
  }
}
