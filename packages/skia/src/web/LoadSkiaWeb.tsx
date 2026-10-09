import type {
  CanvasKit as CanvasKitType,
  CanvasKitInitOptions,
} from "canvaskit-wasm";

import CanvasKitInitWithPDF from "./CanvasKitInitWithPDF";

declare global {
  var CanvasKit: CanvasKitType;
}

let ckSharedPromise: Promise<CanvasKitType> | undefined;

export type CanvasKitInitFunction = (
  opts?: CanvasKitInitOptions
) => Promise<CanvasKitType>;

export interface LoadSkiaWebOptions extends CanvasKitInitOptions {
  /** Overrides the PDF-enabled initializer, for example with a CDN build. */
  CanvasKitInit?: CanvasKitInitFunction;
}

export const LoadSkiaWeb = async (opts?: LoadSkiaWebOptions) => {
  if (global.CanvasKit !== undefined) {
    return;
  }
  const { CanvasKitInit = CanvasKitInitWithPDF, ...canvasKitOpts } = opts ?? {};
  if (ckSharedPromise === undefined) {
    // Share in-flight initialization, but allow retry after a failed asset load.
    ckSharedPromise = CanvasKitInit(canvasKitOpts).catch((error: unknown) => {
      ckSharedPromise = undefined;
      throw error;
    });
  }
  const CanvasKit = await ckSharedPromise;
  // The CanvasKit API is stored on the global object and used
  // to create the JsiSKApi in the Skia.web.ts file.
  global.CanvasKit = CanvasKit;
};

// We keep this function for backward compatibility
export const LoadSkia = LoadSkiaWeb;
