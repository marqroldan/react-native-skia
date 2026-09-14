#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
  stagePdfCanvasKitLoaders,
} = require("./stage-canvaskit-web-pdf-loader");

const packageRoot = path.resolve(__dirname, "..");
const skiaRoot = path.resolve(packageRoot, "../../externals/skia");
const patchFile = path.join(__dirname, "canvaskit-web-pdf.patch");
const buildDir = path.resolve(
  process.env.BUILD_DIR ||
    path.resolve(packageRoot, "../../build/canvaskit-web-pdf")
);
const artifactDir = path.join(packageRoot, "dist/canvaskit-web-pdf");
const expectedSkiaCommit = "9f330f1704305686dafa9eeef11de77caa5314b1";

function fail(message) {
  console.error(`\nCanvasKit Web PDF build failed: ${message}`);
  process.exit(1);
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function checkPatch(args) {
  return spawnSync("git", args, { stdio: "ignore" }).status === 0;
}

function ensureSkiaPatch() {
  if (git(["-C", skiaRoot, "rev-parse", "HEAD"]) !== expectedSkiaCommit) {
    fail(
      `externals/skia must be pinned to ${expectedSkiaCommit}; update the submodule before building.`
    );
  }

  const applyArgs = ["-C", skiaRoot, "apply", "--check", patchFile];
  if (checkPatch(applyArgs)) {
    execFileSync("git", ["-C", skiaRoot, "apply", patchFile], {
      stdio: "inherit",
    });
    return "applied";
  }

  if (
    checkPatch(["-C", skiaRoot, "apply", "--reverse", "--check", patchFile])
  ) {
    return "already applied";
  }

  fail(
    "the tracked CanvasKit PDF patch does not apply cleanly. Inspect the Skia submodule changes before continuing."
  );
}

function resolveToolchain() {
  const toolCache = path.resolve(packageRoot, "../../toolcache");
  const emsdk =
    process.env.EMSDK || path.join(skiaRoot, "third_party/externals/emsdk");
  const emConfig = process.env.EM_CONFIG || path.join(emsdk, ".emscripten");
  const emCache =
    process.env.EM_CACHE || path.join(toolCache, "emscripten-cache");

  if (!fs.existsSync(path.join(emsdk, "upstream/emscripten/emcc"))) {
    fail(`EMSDK does not contain emcc: ${emsdk}`);
  }
  if (!fs.existsSync(emConfig)) {
    fail(`EM_CONFIG does not exist: ${emConfig}`);
  }
  if (!fs.existsSync(emCache)) {
    fs.mkdirSync(emCache, { recursive: true });
  }

  const pathEntries = [
    emsdk,
    path.join(emsdk, "upstream/emscripten"),
    path.join(emsdk, "upstream/bin"),
    path.join(skiaRoot, "bin"),
    path.join(skiaRoot, "third_party/ninja"),
    process.env.PATH,
  ].filter(Boolean);

  return {
    EMSDK: emsdk,
    EM_CONFIG: emConfig,
    EM_CACHE: emCache,
    PATH: pathEntries.join(path.delimiter),
  };
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function copyArtifact(name) {
  const source = path.join(buildDir, name);
  if (!fs.existsSync(source)) {
    fail(`CanvasKit did not produce ${source}`);
  }
  const destination = path.join(artifactDir, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

function main() {
  if (!fs.existsSync(patchFile)) {
    fail(`tracked patch is missing: ${patchFile}`);
  }

  const patchState = ensureSkiaPatch();
  const toolchain = resolveToolchain();
  const result = spawnSync(
    "bash",
    [path.join(skiaRoot, "modules/canvaskit/compile.sh"), "pdf", "cpu"],
    {
      cwd: skiaRoot,
      env: {
        ...process.env,
        ...toolchain,
        BUILD_DIR: buildDir,
      },
      stdio: "inherit",
    }
  );
  if (result.status !== 0) {
    fail(`compile.sh exited with status ${result.status}`);
  }

  const canvasKitJs = copyArtifact("canvaskit.js");
  const canvasKitWasm = copyArtifact("canvaskit.wasm");
  stagePdfCanvasKitLoaders(canvasKitJs);

  const manifest = {
    skiaCommit: expectedSkiaCommit,
    buildArgs: ["pdf", "cpu"],
    patch: "scripts/canvaskit-web-pdf.patch",
    files: {
      "canvaskit.js": sha256(canvasKitJs),
      "canvaskit.wasm": sha256(canvasKitWasm),
    },
  };
  fs.writeFileSync(
    path.join(artifactDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  console.log(
    `CanvasKit Web PDF build ${patchState}; artifacts written to ${artifactDir}`
  );
  console.log(JSON.stringify(manifest, null, 2));
}

main();
