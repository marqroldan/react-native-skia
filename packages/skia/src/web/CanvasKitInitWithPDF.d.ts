import type { CanvasKit, CanvasKitInitOptions } from "canvaskit-wasm";

/** The generated PDF-enabled CanvasKit initializer staged during package build. */
declare const CanvasKitInitWithPDF: (
  options?: CanvasKitInitOptions
) => Promise<CanvasKit>;

export default CanvasKitInitWithPDF;
