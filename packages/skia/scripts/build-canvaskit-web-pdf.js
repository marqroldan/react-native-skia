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
const expectedSkiaCommit = "b94213a11b3a2edadfae89f0c57a7f4ab72772c9";
const expectedCanvasKitVersion = "0.41.1";
// PDF is additive: retain CanvasKit's default WebGL backend.
const buildArgs = ["pdf"];

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

function verifyCanvasKitVersion() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
  );
  const declaredVersion = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]
    .map((section) => packageJson[section]?.["canvaskit-wasm"])
    .find(Boolean);
  if (declaredVersion !== expectedCanvasKitVersion) {
    fail(
      `packages/skia must resolve canvaskit-wasm ${expectedCanvasKitVersion}; found ${
        declaredVersion ?? "no declaration"
      }`
    );
  }
  return declaredVersion;
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

async function main() {
  if (!fs.existsSync(patchFile)) {
    fail(`tracked patch is missing: ${patchFile}`);
  }
  const canvasKitVersion = verifyCanvasKitVersion();

  const patchState = ensureSkiaPatch();
  const toolchain = resolveToolchain();
  const result = spawnSync(
    "bash",
    [path.join(skiaRoot, "modules/canvaskit/compile.sh"), ...buildArgs],
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

  // Refuse to package a PDF-only/CPU artifact as the combined browser build.
  const initialize = require(path.join(buildDir, "canvaskit.js"));
  const canvasKit = await initialize({
    wasmBinary: fs.readFileSync(path.join(buildDir, "canvaskit.wasm")),
  });
  const requiredApis = [
    "GetWebGLContext",
    "MakeWebGLContext",
    "MakeOnScreenGLSurface",
    "MakeRenderTarget",
    "deleteContext",
    "MakeSWCanvasSurface",
  ];
  const missing = requiredApis.filter(
    (name) => typeof canvasKit[name] !== "function"
  );
  if (canvasKit.PDF?.isAvailable() !== true || missing.length > 0) {
    fail(`combined PDF/WebGL APIs missing: ${missing.join(", ") || "PDF"}`);
  }

  const canvasKitJs = copyArtifact("canvaskit.js");
  const canvasKitWasm = copyArtifact("canvaskit.wasm");
  stagePdfCanvasKitLoaders(canvasKitJs);

  const manifest = {
    artifactName: `canvaskit-web-pdf-${canvasKitVersion}-m157-${expectedSkiaCommit.slice(
      0,
      7
    )}`,
    canvasKitVersion,
    skiaCommit: expectedSkiaCommit,
    buildArgs,
    capabilities: { pdf: true, webgl: true, software: true },
    patch: {
      file: "scripts/canvaskit-web-pdf.patch",
      sha256: sha256(patchFile),
    },
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

main().catch((error) => fail(error.message));
