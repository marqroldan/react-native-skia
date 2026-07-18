import type { SkPDFDocument } from "./PDFDocument";

export interface PDFMetadata {
  /**
   * The document's title.
   */
  title?: string;
  /**
   * The name of the person who created the document.
   */
  author?: string;
  /**
   * The subject of the document.
   */
  subject?: string;
  /**
   * Keywords associated with the document.
   */
  keywords?: string;
  /**
   * The name of the application that created the original content.
   */
  creator?: string;
  /**
   * The name of the application that produced the PDF.
   */
  producer?: string;
  /**
   * The natural language of the document (e.g. "en-US").
   */
  lang?: string;
  /**
   * The date and time the document was created.
   */
  creationDate?: Date;
  /**
   * The date and time the document was most recently modified.
   */
  modifiedDate?: Date;
  /**
   * DPI used for features PDF can't express natively (blurs, image filters,
   * runtime shaders, perspective) — they are silently rasterized at this DPI.
   * Defaults to 300 (print-first; Skia's own default is 72).
   */
  rasterDPI?: number;
  /**
   * Encoding quality for opaque images. Defaults to 101 = lossless;
   * values <= 100 encode as JPEG at that quality.
   */
  encodingQuality?: number;
}

export interface PDFFactory {
  /**
   * Returns whether PDF document creation is available on this platform.
   * Returns false on React Native Web and on native builds compiled
   * without SkPDF.
   */
  isAvailable(): boolean;
  /**
   * Creates a new PDF document.
   * @param metadata Optional document metadata and rasterization settings.
   */
  MakeDocument(metadata?: PDFMetadata): SkPDFDocument;
}
