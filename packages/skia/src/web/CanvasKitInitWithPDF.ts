// Source fallback for development builds. The package build replaces the
// generated loader with the PDF-enabled CanvasKit artifact from dist/.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import CanvasKitInit from "canvaskit-wasm/bin/full/canvaskit";

// The generated package loader must retain the CanvasKit initializer's default
// export shape because Bob emits both ESM and CommonJS consumers.
// eslint-disable-next-line import/no-default-export
export default CanvasKitInit;
