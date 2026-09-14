import type {
  CanvasKit as CanvasKitType,
  CanvasKitInitOptions,
} from "canvaskit-wasm";

import CanvasKitInitWithPDF from "./CanvasKitInitWithPDF";

declare global {
  var CanvasKit: CanvasKitType;
}

let ckSharedPromise: Promise<CanvasKitType>;

export type CanvasKitInitFunction = (
  opts?: CanvasKitInitOptions
) => Promise<CanvasKitType>;

export interface LoadSkiaWebOptions extends CanvasKitInitOptions {
  /**
   * Overrides the package's PDF-enabled CanvasKit initializer. This is useful
   * when intentionally loading a stock CanvasKit build from a CDN.
   */
  CanvasKitInit?: CanvasKitInitFunction;
}

export const LoadSkiaWeb = async (opts?: LoadSkiaWebOptions) => {
  if (global.CanvasKit !== undefined) {
    return;
  }
  const { CanvasKitInit = CanvasKitInitWithPDF, ...canvasKitOpts } = opts ?? {};
  ckSharedPromise = ckSharedPromise ?? CanvasKitInit(canvasKitOpts);
  const CanvasKit = await ckSharedPromise;
  // The CanvasKit API is stored on the global object and used
  // to create the JsiSKApi in the Skia.web.ts file.
  global.CanvasKit = CanvasKit;
};

// We keep this function for backward compatibility
export const LoadSkia = LoadSkiaWeb;
