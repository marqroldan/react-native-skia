#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const packageRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const localDevSsdRoot = "/Volumes/DevSSD";
let cachedReleaseRoot;
const sourcePackageName = "@shopify/react-native-skia";
const publishPackageName = "react-native-skia-pdf";
const forkRepository = "https://github.com/marqroldan/react-native-skia.git";
const forkRepositoryBaseUrl = forkRepository.replace(/\.git$/, "");
const expectedSkiaCommit = "9f330f1704305686dafa9eeef11de77caa5314b1";
const expectedPdfDependencies = {
  "react-native-skia-android-pdf": "150.0.0-pdf.1",
  "react-native-skia-apple-ios-pdf": "150.0.0-pdf.1",
  "react-native-skia-apple-macos-pdf": "150.0.0-pdf.1",
  "react-native-skia-apple-tvos-pdf": "150.0.0-pdf.1",
};

function fail(message) {
  throw new Error(`PDF package preparation failed: ${message}`);
}

function optionValue(name) {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`${name}=`),
  );
  if (inline) return inline.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function lstatOrMissing(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail(`could not inspect ${filePath}: ${error.message}`);
  }
}

function getReleaseRoot() {
  if (cachedReleaseRoot) return cachedReleaseRoot;

  if (process.env.GITHUB_ACTIONS !== "true") {
    cachedReleaseRoot = localDevSsdRoot;
    return cachedReleaseRoot;
  }

  const workspace = process.env.GITHUB_WORKSPACE;
  if (!workspace || !path.isAbsolute(workspace)) {
    fail("GitHub Actions workspace must be an absolute path");
  }

  const resolvedWorkspace = path.resolve(workspace);
  if (resolvedWorkspace === path.parse(resolvedWorkspace).root) {
    fail("GitHub Actions workspace must not be the filesystem root");
  }

  const workspaceStat = lstatOrMissing(resolvedWorkspace);
  if (!workspaceStat || !workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
    fail(`GitHub Actions workspace must be an existing real directory: ${resolvedWorkspace}`);
  }

  const realWorkspace = fs.realpathSync(resolvedWorkspace);
  if (realWorkspace !== resolvedWorkspace) {
    fail(`GitHub Actions workspace must not resolve through a symlink: ${realWorkspace}`);
  }

  const expectedPackagePath = path.join("packages", "skia");
  if (path.relative(resolvedWorkspace, packageRoot) !== expectedPackagePath) {
    fail(
      `GitHub Actions workspace must contain the package at ${expectedPackagePath}`,
    );
  }

  const gitRoot = git(["rev-parse", "--show-toplevel"]);
  if (!gitRoot || path.resolve(gitRoot) !== resolvedWorkspace) {
    fail("GitHub Actions workspace must be the checked-out repository root");
  }

  cachedReleaseRoot = resolvedWorkspace;
  return cachedReleaseRoot;
}

function verifyDevSsdRoot() {
  const releaseRoot = getReleaseRoot();
  const rootStat = lstatOrMissing(releaseRoot);
  if (!rootStat || !rootStat.isDirectory()) {
    fail(`verified release root is unavailable: ${releaseRoot}`);
  }
  if (rootStat.isSymbolicLink()) {
    fail(`release root must not be a symlink: ${releaseRoot}`);
  }

  const realRoot = fs.realpathSync(releaseRoot);
  if (realRoot !== releaseRoot) {
    fail(`release root resolves outside its verified path: ${realRoot}`);
  }
}

function resolveDevSsdPath(value, fallback, label = "release path") {
  const candidate = value || fallback;
  if (!candidate) fail(`${label} is required`);

  const releaseRoot = getReleaseRoot();
  verifyDevSsdRoot();
  const resolved = path.resolve(candidate);
  if (!isWithin(releaseRoot, resolved)) {
    fail(`${label} escapes ${releaseRoot}: ${resolved}`);
  }

  let cursor = resolved;
  while (true) {
    const stat = lstatOrMissing(cursor);
    if (stat) {
      if (stat.isSymbolicLink()) {
        fail(`${label} has a symlink ancestor: ${cursor}`);
      }
      const realPath = fs.realpathSync(cursor);
      if (!isWithin(releaseRoot, realPath)) {
        fail(`${label} real path escapes ${releaseRoot}: ${realPath}`);
      }
    }
    if (cursor === releaseRoot) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) fail(`${label} has no verified release-root ancestor`);
    cursor = parent;
  }

  return resolved;
}

function ensureDirectory(directory, label) {
  const resolved = resolveDevSsdPath(directory, undefined, label);
  const stat = lstatOrMissing(resolved);
  if (!stat) {
    const parent = path.dirname(resolved);
    const parentStat = lstatOrMissing(parent);
    if (!parentStat || !parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      fail(`${label} parent must be an existing real directory: ${parent}`);
    }
    try {
      fs.mkdirSync(resolved, {mode: 0o700});
    } catch (error) {
      fail(`could not create ${label} exclusively at ${resolved}: ${error.message}`);
    }
  } else if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(`${label} must be a real directory: ${resolved}`);
  }

  const verified = resolveDevSsdPath(resolved, undefined, label);
  const verifiedStat = lstatOrMissing(verified);
  if (!verifiedStat || !verifiedStat.isDirectory() || verifiedStat.isSymbolicLink()) {
    fail(`${label} was not created as a real directory: ${verified}`);
  }
  return verified;
}

function createExclusiveStagingDirectory(parentDirectory, version) {
  const parent = ensureDirectory(parentDirectory, "staging parent");
  const suffix = crypto.randomBytes(8).toString("hex");
  const directoryName = `react-native-skia-pdf-${version}-${Date.now()}-${process.pid}-${suffix}`;
  const stagingRoot = resolveDevSsdPath(
    path.join(parent, directoryName),
    undefined,
    "staging directory",
  );
  if (lstatOrMissing(stagingRoot)) {
    fail(`staging directory collision; refusing to reuse ${stagingRoot}`);
  }
  try {
    fs.mkdirSync(stagingRoot, {mode: 0o700});
  } catch (error) {
    fail(`could not create exclusive staging directory ${stagingRoot}: ${error.message}`);
  }
  const verified = resolveDevSsdPath(stagingRoot, undefined, "staging directory");
  const verifiedStat = lstatOrMissing(verified);
  if (!verifiedStat || !verifiedStat.isDirectory() || verifiedStat.isSymbolicLink()) {
    fail(`staging directory was not created as a real directory: ${verified}`);
  }
  return verified;
}

function assertFreshPath(filePath, label) {
  const resolved = resolveDevSsdPath(filePath, undefined, label);
  if (lstatOrMissing(resolved)) {
    fail(`${label} already exists; refusing to overwrite ${resolved}`);
  }
  return resolved;
}

function writeExclusiveJson(filePath, value) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
  } catch (error) {
    fail(`could not write new manifest exclusively at ${filePath}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`could not read JSON ${filePath}: ${error.message}`);
  }
}

function sha256(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function validateSourcePackage(sourcePackage) {
  if (sourcePackage.name !== sourcePackageName) {
    fail(
      `source package name must remain ${sourcePackageName}; got ${sourcePackage.name}`,
    );
  }

  if (
    sourcePackage.repository?.url !== `git+${forkRepository}` ||
    sourcePackage.repository?.baseUrl !== forkRepositoryBaseUrl ||
    sourcePackage.repository?.directory !== "packages/skia"
  ) {
    fail(
      `source package repository must point to ${forkRepository} at packages/skia`,
    );
  }

  for (const [name, version] of Object.entries(expectedPdfDependencies)) {
    if (sourcePackage.dependencies?.[name] !== version) {
      fail(`expected pinned dependency ${name}@${version}`);
    }
  }

  const webPdfDirectory = path.join(
    packageRoot,
    "dist/canvaskit-web-pdf",
  );
  const webPdfManifestPath = path.join(webPdfDirectory, "manifest.json");
  const webPdfManifest = readJson(webPdfManifestPath);
  if (webPdfManifest.skiaCommit !== expectedSkiaCommit) {
    fail(
      `Web PDF artifact is for ${webPdfManifest.skiaCommit}; expected pinned Skia ${expectedSkiaCommit}`,
    );
  }

  for (const fileName of ["canvaskit.js", "canvaskit.wasm"]) {
    const filePath = path.join(webPdfDirectory, fileName);
    if (!fs.existsSync(filePath)) {
      fail(`verified Web PDF artifact is missing ${filePath}`);
    }
    if (webPdfManifest.files?.[fileName] !== sha256(filePath)) {
      fail(`Web PDF manifest hash does not match ${fileName}`);
    }
  }

  for (const loaderPath of [
    path.join(packageRoot, "lib/module/web/CanvasKitInitWithPDF.js"),
    path.join(packageRoot, "lib/commonjs/web/CanvasKitInitWithPDF.js"),
  ]) {
    if (
      !fs.existsSync(loaderPath) ||
      !fs.readFileSync(loaderPath, "utf8").includes("PDFDocument")
    ) {
      fail(`generated PDF CanvasKit loader is missing or unverified: ${loaderPath}`);
    }
  }

  const podspec = fs.readFileSync(
    path.join(packageRoot, "react-native-skia.podspec"),
    "utf8",
  );
  if (!podspec.includes(forkRepository)) {
    fail(`podspec source must point to ${forkRepository}`);
  }
  if (!podspec.includes('s.name         = "react-native-skia"')) {
    fail("podspec must retain the react-native-skia CocoaPods name");
  }

  return {
    webPdfManifest,
    webPdfDirectory,
  };
}

function getSourcePackFiles() {
  let output;
  try {
    output = execFileSync(
      "npm",
      ["pack", "--dry-run", "--ignore-scripts", "--json"],
      {cwd: packageRoot, encoding: "utf8"},
    );
  } catch (error) {
    fail(`npm could not enumerate source package files: ${error.message}`);
  }

  try {
    const result = JSON.parse(output);
    if (!Array.isArray(result) || !result[0]?.files) {
      fail("npm returned no source package file list");
    }
    return result[0].files;
  } catch (error) {
    fail(`npm returned invalid pack metadata: ${error.message}`);
  }
}

function copyPackFiles(files, stagedPackageRoot) {
  for (const entry of files) {
    const relativePath = entry.path.replace(/\\/g, "/");
    if (
      relativePath.endsWith(".tgz") ||
      relativePath.endsWith(".manifest.json")
    ) {
      continue;
    }

    const sourcePath = path.resolve(packageRoot, relativePath);
    const destinationPath = path.resolve(stagedPackageRoot, relativePath);
    const relativeDestination = path.relative(
      stagedPackageRoot,
      destinationPath,
    );
    if (
      relativePath.startsWith("../") ||
      path.isAbsolute(relativePath) ||
      relativeDestination === ".." ||
      relativeDestination.startsWith(`..${path.sep}`)
    ) {
      fail(`npm returned an unsafe package path: ${relativePath}`);
    }

    let sourceStat;
    try {
      sourceStat = fs.lstatSync(sourcePath);
    } catch {
      fail(`npm listed a missing package file: ${sourcePath}`);
    }

    validatePackFileStat(sourceStat, sourcePath);
    ensureStagedDirectory(path.dirname(destinationPath), stagedPackageRoot);
    resolveDevSsdPath(destinationPath, undefined, "staged package path");
    if (lstatOrMissing(destinationPath)) {
      fail(`staged package path collision; refusing to overwrite ${destinationPath}`);
    }
    fs.copyFileSync(sourcePath, destinationPath);
    fs.chmodSync(destinationPath, sourceStat.mode & 0o777);
  }

  const stagedPackageJsonPath = path.join(stagedPackageRoot, "package.json");
  if (!fs.existsSync(stagedPackageJsonPath)) {
    fail("staged package is missing package.json");
  }
}

function validatePackFileStat(sourceStat, sourcePath) {
  if (sourceStat.isSymbolicLink()) {
    fail(`npm listed a symlinked package path; refusing unsafe staging: ${sourcePath}`);
  }
  if (!sourceStat.isFile()) {
    fail(`npm listed a non-file package path: ${sourcePath}`);
  }
}

function ensureStagedDirectory(directory, stagedPackageRoot) {
  const resolvedDirectory = resolveDevSsdPath(
    directory,
    undefined,
    "staged package directory",
  );
  if (!isWithin(stagedPackageRoot, resolvedDirectory)) {
    fail(`staged package directory escapes its staging root: ${resolvedDirectory}`);
  }

  const relativeDirectory = path.relative(stagedPackageRoot, resolvedDirectory);
  let currentDirectory = stagedPackageRoot;
  for (const component of relativeDirectory.split(path.sep).filter(Boolean)) {
    currentDirectory = path.join(currentDirectory, component);
    const stat = lstatOrMissing(currentDirectory);
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        fail(`staged package ancestor is not a real directory: ${currentDirectory}`);
      }
    } else {
      try {
        fs.mkdirSync(currentDirectory, {mode: 0o700});
      } catch (error) {
        fail(`could not create staged package directory exclusively at ${currentDirectory}: ${error.message}`);
      }
    }

    const verifiedDirectory = resolveDevSsdPath(
      currentDirectory,
      undefined,
      "staged package directory",
    );
    const verifiedStat = lstatOrMissing(verifiedDirectory);
    if (
      !verifiedStat ||
      !verifiedStat.isDirectory() ||
      verifiedStat.isSymbolicLink()
    ) {
      fail(`staged package directory is not a real directory: ${verifiedDirectory}`);
    }
  }
}

function packStagedPackage(stagedPackageRoot, outputDirectory) {
  let output;
  try {
    output = execFileSync(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        outputDirectory,
      ],
      {cwd: stagedPackageRoot, encoding: "utf8"},
    );
  } catch (error) {
    fail(`npm could not pack the transformed package: ${error.message}`);
  }

  try {
    const result = JSON.parse(output);
    if (!Array.isArray(result) || !result[0]?.filename) {
      fail("npm returned no transformed package filename");
    }
    return result[0];
  } catch (error) {
    fail(`npm returned invalid transformed pack metadata: ${error.message}`);
  }
}

function main() {
  const sourcePackage = readJson(packageJsonPath);
  const artifact = validateSourcePackage(sourcePackage);
  const version =
    optionValue("--version") ||
    process.env.SKIA_PDF_VERSION ||
    "2.10.1";
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`invalid release version: ${version}`);
  }

  const defaultStagingParent = path.resolve(packageRoot, "../../release-staging");
  const stagingParent = resolveDevSsdPath(
    optionValue("--staging-parent") ||
      optionValue("--staging") ||
      process.env.SKIA_PDF_RELEASE_STAGING,
    defaultStagingParent,
    "staging parent",
  );
  ensureDirectory(stagingParent, "staging parent");
  const stagingRoot = createExclusiveStagingDirectory(stagingParent, version);
  const requestedOutput = optionValue("--output") || process.env.SKIA_PDF_OUTPUT;
  const outputDirectory = requestedOutput
    ? ensureDirectory(
        resolveDevSsdPath(requestedOutput, undefined, "output directory"),
        "output directory",
      )
    : stagingRoot;
  const stagedPackageRoot = path.join(stagingRoot, "package");

  fs.mkdirSync(stagedPackageRoot, {mode: 0o700});
  resolveDevSsdPath(stagedPackageRoot, undefined, "staged package directory");

  const sourcePackFiles = getSourcePackFiles();
  copyPackFiles(sourcePackFiles, stagedPackageRoot);

  const stagedPackageJsonPath = path.join(stagedPackageRoot, "package.json");
  const stagedPackage = readJson(stagedPackageJsonPath);
  stagedPackage.name = publishPackageName;
  stagedPackage.version = version;
  fs.writeFileSync(
    stagedPackageJsonPath,
    `${JSON.stringify(stagedPackage, null, 2)}\n`,
  );

  const expectedFilename = `${publishPackageName}-${version}.tgz`;
  const expectedTarballPath = assertFreshPath(
    path.join(outputDirectory, expectedFilename),
    "package tarball",
  );
  const expectedManifestPath = assertFreshPath(
    `${expectedTarballPath}.manifest.json`,
    "package manifest",
  );

  const packed = packStagedPackage(stagedPackageRoot, outputDirectory);
  if (packed.filename !== expectedFilename) {
    fail(`npm produced ${packed.filename}; expected ${expectedFilename}`);
  }

  const tarballPath = path.join(outputDirectory, packed.filename);
  if (tarballPath !== expectedTarballPath) {
    fail(`npm produced an unexpected output path: ${tarballPath}`);
  }
  if (!fs.existsSync(tarballPath)) {
    fail(`npm did not write ${tarballPath}`);
  }

  const sourceStatus = git(["status", "--porcelain", "--untracked-files=all"]);
  const manifest = {
    schemaVersion: 1,
    package: {
      name: publishPackageName,
      version,
      sourceName: sourcePackageName,
      filename: packed.filename,
      sha256: sha256(tarballPath),
      bytes: fs.statSync(tarballPath).size,
      npm: {
        shasum: packed.shasum,
        integrity: packed.integrity,
        unpackedSize: packed.unpackedSize,
        fileCount: packed.files.length,
      },
    },
    source: {
      repository: forkRepository,
      worktree: packageRoot,
      branch: git(["branch", "--show-current"]) || null,
      head: git(["rev-parse", "HEAD"]) || null,
      worktreeDirty: sourceStatus.length > 0,
      releaseRef: null,
      releaseTag: null,
      sourceNamePreserved: sourcePackage.name === sourcePackageName,
    },
    webPdf: {
      skiaCommit: artifact.webPdfManifest.skiaCommit,
      buildArgs: artifact.webPdfManifest.buildArgs,
      patch: artifact.webPdfManifest.patch,
      files: {
        "canvaskit.js": {
          path: "dist/canvaskit-web-pdf/canvaskit.js",
          sha256: sha256(path.join(artifact.webPdfDirectory, "canvaskit.js")),
        },
        "canvaskit.wasm": {
          path: "dist/canvaskit-web-pdf/canvaskit.wasm",
          sha256: sha256(path.join(artifact.webPdfDirectory, "canvaskit.wasm")),
        },
      },
      loader: "lib/module/web/CanvasKitInitWithPDF.js",
    },
    nativePdfDependencies: {
      versions: expectedPdfDependencies,
      exactSourceCommit: "unknown",
      note:
        "These are existing pinned prebuilt native packages; this local preparation does not rebuild them or establish their exact source commit.",
    },
    packaging: {
      transform: ["package.json:name", "package.json:version"],
      scriptsIgnoredForLocalPack: true,
      stagingParent,
      stagingRoot,
      outputDirectory,
      stagedPackageRoot,
    },
  };
  writeExclusiveJson(expectedManifestPath, manifest);

  if (process.argv.includes("--publish")) {
    const tag = optionValue("--tag") || process.env.SKIA_PDF_DIST_TAG || "latest";
    execFileSync(
      "npm",
      ["publish", tarballPath, "--provenance", "--access", "public", "--tag", tag],
      {cwd: outputDirectory, stdio: "inherit"},
    );
  }

  console.log(JSON.stringify(manifest, null, 2));
}

function expectFailure(label, operation) {
  try {
    operation();
  } catch {
    return;
  }
  fail(`${label} safety check unexpectedly passed`);
}

function verifySafety() {
  verifyDevSsdRoot();
  resolveDevSsdPath(packageRoot, undefined, "package root");
  resolveDevSsdPath(
    path.resolve(packageRoot, "../../release-staging"),
    undefined,
    "default staging parent",
  );
  const releaseRoot = getReleaseRoot();
  expectFailure("lexical path escape", () =>
    resolveDevSsdPath(path.join(releaseRoot, "..", "outside-release-root"), undefined, "test path"),
  );
  expectFailure("existing path collision", () =>
    assertFreshPath(path.join(packageRoot, "package.json"), "test output"),
  );
  expectFailure("source symlink entry", () =>
    validatePackFileStat(
      {isFile: () => true, isSymbolicLink: () => true},
      "test-symlink",
    ),
  );

  console.log(
    JSON.stringify(
      {
        safetyCheck: "pass",
        devSsdRoot: fs.realpathSync(releaseRoot),
        releaseRoot: fs.realpathSync(releaseRoot),
        executionEnvironment:
          process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
        lexicalPathEscapeRejected: true,
        existingPathCollisionRejected: true,
        sourceSymlinkEntryRejected: true,
        deletionPerformed: false,
      },
      null,
      2,
    ),
  );
}

try {
  if (process.argv.includes("--verify-safety")) verifySafety();
  else main();
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
}
