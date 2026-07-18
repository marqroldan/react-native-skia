import type { PDFMetadata, PDFPage } from "../skia/types";
import { Skia } from "../skia";

import { drawAsPicture } from "./Offscreen";

/**
 * Renders the given pages into a PDF document and returns its bytes.
 *
 * Each page element is rendered once, at call time — async assets
 * (e.g. useImage/useFont) must be resolved BEFORE calling this function,
 * otherwise their content is silently blank.
 *
 * @param pages The pages to render, each with its dimensions in PDF points.
 * @param metadata Optional document metadata and rasterization settings.
 */
export const renderAsPDF = async (
  pages: PDFPage[],
  metadata?: PDFMetadata
): Promise<Uint8Array> => {
  const doc = Skia.PDF.MakeDocument(metadata);
  try {
    for (const { width, height, element } of pages) {
      const picture = await drawAsPicture(
        element,
        Skia.XYWHRect(0, 0, width, height)
      );
      const canvas = doc.beginPage(width, height);
      canvas.drawPicture(picture);
      doc.endPage();
      picture.dispose();
    }
    return doc.close();
  } catch (e) {
    doc.abort();
    throw e;
  }
};
