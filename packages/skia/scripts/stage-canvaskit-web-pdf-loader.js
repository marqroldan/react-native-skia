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
  if (!source.includes("PDFDocument")) {
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
    if (!fs.existsSync(loaderPath)) {
      fail(
        `run the package build before staging the generated loader: ${loaderPath}`
      );
    }
    fs.writeFileSync(loaderPath, source);
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
