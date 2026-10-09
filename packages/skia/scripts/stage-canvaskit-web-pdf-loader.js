#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const packageRoot = path.resolve(__dirname, "..");
const defaultCanvasKitJs = path.join(
  packageRoot,
  "dist/canvaskit-web-pdf/canvaskit.js"
);
const loaderPaths = [
  path.join(packageRoot, "src/web/CanvasKitInitWithPDF.js"),
  path.join(packageRoot, "lib/module/web/CanvasKitInitWithPDF.js"),
  path.join(packageRoot, "lib/commonjs/web/CanvasKitInitWithPDF.js"),
];

function fail(message) {
  throw new Error(`PDF CanvasKit loader staging failed: ${message}`);
}

function stagePdfCanvasKitLoaders(canvasKitJs = defaultCanvasKitJs) {
  if (!fs.existsSync(canvasKitJs)) {
    fail(`tracked PDF CanvasKit artifact is missing: ${canvasKitJs}`);
  }

  const source = fs.readFileSync(canvasKitJs, "utf8");
  const canvasKitWasm = path.join(path.dirname(canvasKitJs), "canvaskit.wasm");
  if (!fs.existsSync(canvasKitWasm)) {
    fail(`PDF CanvasKit WASM artifact is missing: ${canvasKitWasm}`);
  }
  if (
    !source.includes("PDFDocument") ||
    !source.includes("_MakePDFDocument")
  ) {
    fail(`PDF CanvasKit artifact is not PDF-enabled: ${canvasKitJs}`);
  }
  if (
    !source.includes("module.exports = CanvasKitInit") ||
    !source.includes("module.exports.default = CanvasKitInit")
  ) {
    fail(
      `PDF CanvasKit artifact does not retain the CommonJS default export: ${canvasKitJs}`
    );
  }

  for (const loaderPath of loaderPaths) {
    if (!fs.existsSync(path.dirname(loaderPath))) {
      fail(
        `run the package build before staging the generated loader: ${path.dirname(loaderPath)}`
      );
    }
    fs.writeFileSync(loaderPath, source);
    fs.copyFileSync(
      canvasKitWasm,
      path.join(path.dirname(loaderPath), "canvaskit.wasm")
    );
    if (fs.readFileSync(loaderPath, "utf8") !== source) {
      fail(`staged loader does not match the verified artifact: ${loaderPath}`);
    }
  }
}

if (require.main === module) {
  stagePdfCanvasKitLoaders();
  console.log("PDF CanvasKit loaders staged in lib/module and lib/commonjs");
}

module.exports = { stagePdfCanvasKitLoaders };
