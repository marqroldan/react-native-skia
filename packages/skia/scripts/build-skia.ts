import { execSync } from "child_process";
import { exit } from "process";
import fs from "fs";
import path from "path";

import type {
  ApplePlatformName,
  Platform,
  PlatformName,
} from "./skia-configuration";
import {
  commonArgs,
  configurations,
  copyHeaders,
  isApplePlatform,
  OutFolder,
  PackageRoot,
  ProjectRoot,
  SkiaSrc,
} from "./skia-configuration";
import { applyDawnPatches } from "./dawn-configuration";
import { $, mapKeys, runAsync } from "./utils";

const getOutDir = (platform: PlatformName, targetName: string) => {
  return `${OutFolder}/${platform}/${targetName}`;
};

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

const mirrorGnBinary = (source: string) => {
  const destination = path.join(SkiaSrc, "bin", "gn");
  const temporaryDirectory = fs.mkdtempSync(
    path.join(path.dirname(destination), ".gn-override-")
  );
  const temporaryBinary = path.join(temporaryDirectory, "gn");
  try {
    fs.copyFileSync(source, temporaryBinary);
    fs.chmodSync(temporaryBinary, fs.statSync(source).mode & 0o777);
    // Replace the executable by renaming a fresh inode. Overwriting the
    // existing Mach-O in place can leave macOS code-signature validation
    // attached to the old inode.
    fs.renameSync(temporaryBinary, destination);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return destination;
};

const getGnCommand = () => {
  const configuredGn = process.env.GN_BINARY;
  if (!configuredGn) {
    return "PATH=../depot_tools/:$PATH gn";
  }
  if (!path.isAbsolute(configuredGn)) {
    throw new Error("GN_BINARY must be an absolute path to a GN executable");
  }
  try {
    fs.accessSync(configuredGn, fs.constants.X_OK);
  } catch {
    throw new Error(`GN_BINARY is not executable: ${configuredGn}`);
  }
  return shellQuote(mirrorGnBinary(configuredGn));
};

const configurePlatform = async (
  platformName: PlatformName,
  configuration: Platform,
  targetName: string
) => {
  process.chdir(SkiaSrc);
  console.log(
    `Configuring platform "${platformName}" for target "${targetName}"`
  );
  console.log("Current directory", process.cwd());

  if (configuration) {
    const target = configuration.targets[targetName];
    if (!target) {
      console.log(
        `Target ${targetName} not found for platform ${platformName}`
      );
      exit(1);
    }

    const commandline = `${getGnCommand()} gen ${getOutDir(
      platformName,
      targetName
    )}`;

    const args = configuration.args.reduce(
      (a, cur) => (a += `${cur[0]}=${cur[1]} \n`),
      ""
    );

    const common = commonArgs.reduce(
      (a, cur) => (a += `${cur[0]}=${cur[1]} \n`),
      ""
    );

    const targetArgs =
      target.args?.reduce((a, cur) => (a += `${cur[0]}=${cur[1]} \n`), "") ||
      "";

    const options =
      configuration.options?.reduce(
        (a, cur) => (a += `--${cur[0]}=${cur[1]} `),
        ""
      ) || "";

    const targetOptions =
      target.options?.reduce((a, cur) => (a += `--${cur[0]}=${cur[1]} `), "") ||
      "";

    const command = `${commandline} ${options} ${targetOptions} --script-executable=python3 --args='target_os="${target.platform}" target_cpu="${target.cpu}" ${common}${args}${targetArgs}'`;
    await runAsync(command, "⚙️");
    return true;
  } else {
    console.log(
      `Could not find platform "${platformName}" for target "${targetName}" `
    );
    return false;
  }
};

export const buildPlatform = async (
  platform: PlatformName,
  targetName: string
) => {
  process.chdir(SkiaSrc);
  const outputTargets = configurations[platform].outputNames;
  if (outputTargets.length === 0) {
    throw new Error(`No output targets configured for ${platform}`);
  }
  console.log(
    `Building platform "${platform}" for target "${targetName}" (${outputTargets.join(
      ", "
    )})`
  );
  // We need to include the path to our custom python2 -> python3 mapping script
  // to make sure we can run all scripts that uses #!/usr/bin/env python as shebang
  // https://groups.google.com/g/skia-discuss/c/BYyB-TwA8ow
  const pythonShimDirectory = path.resolve(SkiaSrc, "../bin");
  const command = `PATH=${shellQuote(
    pythonShimDirectory
  )}:$PATH ninja -C ${shellQuote(
    getOutDir(platform, targetName)
  )} ${outputTargets.map(shellQuote).join(" ")}`;
  await runAsync(
    command,
    `${platform === "android" ? "🤖" : "🍏"} ${targetName}`
  );
};

// A Skia archive that defines a typeinfo of the C++ runtime makes librnskia.so
// export that copy and bind its catch clauses to it instead of libc++_shared's.
const assertNoRuntimeTypeinfo = (libPath: string) => {
  const copies = execSync(
    `$ANDROID_NDK/toolchains/llvm/prebuilt/*/bin/llvm-nm --defined-only --just-symbol-name ${libPath}`,
    { maxBuffer: Infinity }
  )
    .toString()
    .split("\n")
    .filter((symbol) => /^_ZT[IS]St/.test(symbol));
  if (copies.length > 0) {
    throw new Error(
      `${libPath} defines typeinfo the C++ runtime owns: ${copies.join(", ")}`
    );
  }
};

export const copyLib = (
  os: PlatformName,
  cpu: string,
  platform: string,
  outputNames: string[]
) => {
  const dstPath = `${PackageRoot}/libs/${os}/${platform}/`;
  $(`mkdir -p ${dstPath}`);

  outputNames
    .map((name) => `${OutFolder}/${os}/${cpu}/${name}`)
    .forEach((lib) => {
      const libPath = lib;
      console.log(`Copying ${libPath} to ${dstPath}`);
      console.log(`cp ${libPath} ${dstPath}`);
      $(`cp ${libPath} ${dstPath}`);
      if (os === "android") {
        // The archives ship as they are: drop the debug info, which is most
        // of their size.
        $(
          `$ANDROID_NDK/toolchains/llvm/prebuilt/*/bin/llvm-strip --strip-debug ${dstPath}/${path.basename(
            libPath
          )}`
        );
      }
    });
};

/**
 * Builds an XCFramework from the Apple slices selected for this invocation.
 * When both architectures for a simulator, Catalyst, or macOS platform are
 * selected, they are combined with lipo before the XCFramework is assembled.
 */
const buildXCFramework = (
  platformName: ApplePlatformName,
  selectedTargets: string[]
) => {
  const config = configurations[platformName];
  const { outputNames } = config;

  process.chdir(SkiaSrc);
  const prefix = `${OutFolder}/${platformName}`;

  // Get the short platform name (ios, macos)
  const shortPlatform = platformName.replace("apple-", "");

  // Create output directory
  const outputDir = `${PackageRoot}/libs/${shortPlatform}`;
  $(`mkdir -p ${outputDir}`);

  const selected = new Set(selectedTargets);
  const libraryFor = (target: string, name: string) => {
    const library = path.join(prefix, target, name);
    if (!selected.has(target)) {
      return undefined;
    }
    if (!fs.existsSync(library)) {
      throw new Error(`Missing built Apple slice: ${library}`);
    }
    return library;
  };
  const combineSelectedSlices = (
    targets: string[],
    name: string,
    outputPath: string
  ) => {
    const libraries = targets
      .map((target) => libraryFor(target, name))
      .filter((library): library is string => library !== undefined);
    if (libraries.length === 0) {
      return undefined;
    }
    if (libraries.length === 1) {
      return libraries[0];
    }
    $(`mkdir -p ${path.dirname(outputPath)}`);
    $(`rm -f ${outputPath}`);
    $(`lipo -create ${libraries.join(" ")} -output ${outputPath}`);
    return outputPath;
  };

  outputNames.forEach((name) => {
    console.log(`🍏 Building XCFramework for ${name} (${platformName})`);

    let xcframeworkCmd = "xcodebuild -create-xcframework ";
    const libraries: string[] = [];

    if (shortPlatform === "ios") {
      const device = libraryFor("arm64-iphoneos", name);
      if (device) {
        libraries.push(device);
      }
      const simulator = combineSelectedSlices(
        ["arm64-iphonesimulator", "x64-iphonesimulator"],
        name,
        path.join(prefix, "iphonesimulator", name)
      );
      if (simulator) {
        libraries.push(simulator);
      }
      const catalyst = combineSelectedSlices(
        ["arm64-maccatalyst", "x64-maccatalyst"],
        name,
        path.join(prefix, "maccatalyst", name)
      );
      if (catalyst) {
        libraries.push(catalyst);
      }
    } else if (shortPlatform === "macos") {
      const macos = combineSelectedSlices(
        ["arm64-macosx", "x64-macosx"],
        name,
        path.join(prefix, "macosx", name)
      );
      if (macos) {
        libraries.push(macos);
      }
    }

    if (libraries.length === 0) {
      throw new Error(
        `No built slices selected for ${platformName} ${name}: ${selectedTargets.join(
          ", "
        )}`
      );
    }
    for (const library of libraries) {
      xcframeworkCmd += `-library ${library} `;
    }

    const [lib] = name.split(".");
    const dstPath = `${outputDir}/${lib}.xcframework`;
    xcframeworkCmd += `-output ${dstPath}`;

    $(xcframeworkCmd);
  });

  console.log(`✅ XCFramework built for ${platformName}`);
};

(async () => {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const defaultTargets = Object.keys(configurations);
  const targetSpecs = args.length > 0 ? args : defaultTargets;

  // Parse target specifications (platform or platform-target format). Platform
  // and target names may both contain hyphens, so match the platform prefix
  // and keep the complete target suffix.
  const buildTargets: { platform: PlatformName; targets?: string[] }[] = [];
  const validPlatforms = Object.keys(configurations);

  for (const spec of targetSpecs) {
    // First check if the entire spec is a valid platform name (e.g., "android", "apple-ios")
    if (validPlatforms.includes(spec)) {
      buildTargets.push({ platform: spec as PlatformName });
    } else {
      const platform = validPlatforms.find((name) =>
        spec.startsWith(`${name}-`)
      );
      if (!platform) {
        console.error(`❌ Invalid platform or target: ${spec}`);
        console.error(`Valid platforms are: ${validPlatforms.join(", ")}`);
        exit(1);
      }

      // Handle platform-target format (e.g., android-arm, android-arm64)
      const target = spec.slice(platform.length + 1);

      const platformConfig = configurations[platform as PlatformName];
      if (!(target in platformConfig.targets)) {
        console.error(
          `❌ Invalid target '${target}' for platform '${platform}'`
        );
        console.error(
          `Valid targets for ${platform}: ${Object.keys(
            platformConfig.targets
          ).join(", ")}`
        );
        exit(1);
      }

      // Find existing platform entry or create new one
      let existingPlatform = buildTargets.find(
        (bt) => bt.platform === platform
      );
      if (!existingPlatform) {
        existingPlatform = { platform: platform as PlatformName, targets: [] };
        buildTargets.push(existingPlatform);
      }
      if (!existingPlatform.targets) {
        existingPlatform.targets = [];
      }
      existingPlatform.targets.push(target);
    }
  }

  console.log(`🎯 Building targets: ${targetSpecs.join(", ")}`);
  console.log("🪨 Skia Graphite");

  // Check Android environment variables if android is in target platforms
  const hasAndroid = buildTargets.some((bt) => bt.platform === "android");
  if (hasAndroid) {
    ["ANDROID_NDK", "ANDROID_HOME"].forEach((name) => {
      // Test for existence of Android SDK
      if (!process.env[name]) {
        console.log(`${name} not set.`);
        exit(1);
      } else {
        console.log(`✅ ${name}`);
      }
    });
  }

  // Run glient sync
  console.log("Running gclient sync...");
  // Start by running sync
  process.chdir(SkiaSrc);
  $("PATH=../depot_tools/:$PATH python3 tools/git-sync-deps");
  console.log("gclient sync done");
  {
    console.log("Applying Graphite patches...");
    $(`git reset --hard HEAD`);

    // PartitionAlloc is a Chromium dependency Dawn's GN rules can pull in;
    // the Skia tree does not have it and skia_use_partition_alloc is off.
    {
      const filePath = `${SkiaSrc}/build_overrides/dawn.gni`;
      const marker = "# PartitionAlloc is an optional dependency:";
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        const index = content.indexOf(marker);
        if (index !== -1) {
          fs.writeFileSync(filePath, content.slice(0, index));
        }
      }
    }

    // Remove arm64e arch flags (not available on simulator)
    {
      const filePath = `${SkiaSrc}/gn/skia/BUILD.gn`;
      const search = [
        `        "-arch",`,
        `        "arm64e",`,
        `      ]`,
        `    } else if (current_cpu == "x86") {`,
      ].join("\n");
      const replace = [
        `      ]`,
        `    } else if (current_cpu == "x86") {`,
      ].join("\n");
      const content = fs.readFileSync(filePath, "utf-8");
      if (!content.includes(search)) {
        throw new Error(`Patch target not found in ${filePath}`);
      }
      fs.writeFileSync(filePath, content.replace(search, replace));
    }
    // C++20 is required for Dawn (uses concepts/requires)
    {
      const filePath = `${SkiaSrc}/gn/skia/BUILD.gn`;
      const content = fs.readFileSync(filePath, "utf-8");
      fs.writeFileSync(
        filePath,
        content.replace(
          `cflags_cc += [ "-std=c++17" ]`,
          `cflags_cc += [ "-std=c++20" ]`
        )
      );
    }
    // Fix Dawn ShaderModuleMTL.mm uint32 typo (should be uint32_t)
    {
      const filePath = `${SkiaSrc}/third_party/externals/dawn/src/dawn/native/metal/ShaderModuleMTL.mm`;
      const content = fs.readFileSync(filePath, "utf-8");
      fs.writeFileSync(
        filePath,
        content.replace(
          /uint32\(bindingInfo\.binding\)/g,
          "uint32_t(bindingInfo.binding)"
        )
      );
    }
    // Add iOS support to Dawn cmake_utils.py
    {
      const filePath = `${SkiaSrc}/third_party/dawn/cmake_utils.py`;
      let content = fs.readFileSync(filePath, "utf-8");
      // Add --ios_use_simulator argument
      content = content.replace(
        `parser.add_argument(
      "--enable_rtti", action=argparse.BooleanOptionalAction, help="Enable RTTI.")`,
        `parser.add_argument(
      "--enable_rtti", action=argparse.BooleanOptionalAction, help="Enable RTTI.")
  parser.add_argument(
      "--ios_use_simulator", action=argparse.BooleanOptionalAction, help="Build for iOS simulator.")`
      );
      // Add iOS OS/CPU mapping
      content = content.replace(
        `if os == "mac":
    target_cpu_map = {
      "arm64": "arm64",
      "x64": "x86_64",
    }
    return "Darwin", target_cpu_map[cpu]

  if os == "win":`,
        `if os == "mac":
    target_cpu_map = {
      "arm64": "arm64",
      "x64": "x86_64",
    }
    return "Darwin", target_cpu_map[cpu]

  if os == "ios":
    target_cpu_map = {
      "arm64": "arm64",
      "x64": "x86_64",
    }
    return "iOS", target_cpu_map[cpu]

  if os == "win":`
      );
      fs.writeFileSync(filePath, content);
    }
    // Add iOS support to Dawn build_dawn.py
    {
      const filePath = `${SkiaSrc}/third_party/dawn/build_dawn.py`;
      let content = fs.readFileSync(filePath, "utf-8");
      content = content.replace(
        `if target_os == "Darwin" or target_os == "iOS":
    configure_cmd.append(f"-DCMAKE_OSX_ARCHITECTURES={target_cpu}")

  env = os.environ.copy()`,
        `if target_os == "Darwin" or target_os == "iOS":
    configure_cmd.append(f"-DCMAKE_OSX_ARCHITECTURES={target_cpu}")

  if target_os == "iOS":
    configure_cmd.append("-DTINT_BUILD_CMD_TOOLS=OFF")
    if args.ios_use_simulator:
      configure_cmd.append("-DCMAKE_OSX_SYSROOT=iphonesimulator")

  env = os.environ.copy()`
      );
      fs.writeFileSync(filePath, content);
    }
    // Fix Dawn BUILD.gn for iOS (Cocoa.framework is macOS only)
    {
      const filePath = `${SkiaSrc}/third_party/dawn/BUILD.gn`;
      let content = fs.readFileSync(filePath, "utf-8");
      content = content.replace(
        `"Metal.framework",
      "QuartzCore.framework",
      "Cocoa.framework",
    ]
  }
}`,
        `"Metal.framework",
      "QuartzCore.framework",
    ]
    if (is_mac && !is_catalyst) {
      frameworks += [ "Cocoa.framework" ]
    }
  }
}`
      );
      // Add ios_use_simulator argument passing
      content = content.replace(
        `if (is_android) {
    args += [
      "--android_ndk_path=" + ndk,
      "--android_platform=android-" + ndk_api,
    ]
  }

  if (dawn_enable_d3d11) {`,
        `if (is_android) {
    args += [
      "--android_ndk_path=" + ndk,
      "--android_platform=android-" + ndk_api,
    ]
  }
  if (is_ios && ios_use_simulator) {
    args += [ "--ios_use_simulator" ]
  }

  if (dawn_enable_d3d11) {`
      );
      fs.writeFileSync(filePath, content);
    }
    // Catalyst uses the macOS SDK with an iOS ABI and deployment target.
    const catalystPatch = path.join(__dirname, "skia-catalyst.patch");
    $(`git apply ${catalystPatch}`);
    // The GN build compiles the same Dawn checkout as build-dawn.ts.
    // Without this, Mac Catalyst compilation will be failed.
    applyDawnPatches();
    console.log("Patches applied successfully");
  }
  // Keep the separately built Dawn library and headers in libs/dawn.
  for (const { platform } of buildTargets) {
    $(`rm -rf ${PackageRoot}/${configurations[platform].outputRoot}`);
  }

  // Build specified platforms and targets
  for (const buildTarget of buildTargets) {
    const { platform, targets } = buildTarget;
    const configuration = configurations[platform];
    console.log(`\n🔨 Building platform: ${platform}`);

    const targetsToProcess =
      targets || (mapKeys(configuration.targets) as string[]);

    for (const target of targetsToProcess) {
      await configurePlatform(platform, configuration, target);
      await buildPlatform(platform, target);
      process.chdir(ProjectRoot);
      if (platform === "android") {
        configuration.outputNames.forEach((name) =>
          assertNoRuntimeTypeinfo(`${getOutDir(platform, target)}/${name}`)
        );
        copyLib(
          platform,
          target,
          configurations.android.targets[target].output,
          configuration.outputNames
        );
      }
    }
  }

  // Build XCFrameworks for each Apple platform that was built
  const applePlatforms = buildTargets
    .filter((bt) => isApplePlatform(bt.platform))
    .map((bt) => bt.platform as ApplePlatformName);

  for (const applePlatform of applePlatforms) {
    const selectedTargets = buildTargets.find(
      (buildTarget) => buildTarget.platform === applePlatform
    )?.targets;
    buildXCFramework(
      applePlatform,
      selectedTargets || mapKeys(configurations[applePlatform].targets)
    );
  }

  copyHeaders();
})();
