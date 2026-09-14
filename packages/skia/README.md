# React Native Skia

High-performance 2d Graphics for React Native using Skia

<img width="400" alt="skia" src="https://user-images.githubusercontent.com/306134/146549218-b7959ad9-0107-4c1c-b439-b96c780f5230.png">

Checkout the full documentation [here](https://shopify.github.io/react-native-skia).

Documentation on the library development is available [here](https://github.com/marqroldan/react-native-skia#library-development).

## Web PDF build

This maintained fork ships a PDF-enabled CanvasKit build for Web. A package
build must generate the matching JavaScript/WASM pair before it is packed:

```bash
EMSDK=/path/to/emsdk \
EM_CONFIG=/path/to/emscripten.config \
EM_CACHE=/path/to/emscripten-cache \
yarn workspace @shopify/react-native-skia build
yarn workspace @shopify/react-native-skia build-canvaskit-web-pdf
```

The `prepack` hook runs the same build and writes the artifact to
`dist/canvaskit-web-pdf/`. Run `npx setup-skia-web` in a consumer application
to copy that exact WASM file to its public folder. `LoadSkiaWeb()` uses the
matching PDF-enabled loader in the packed package; `Skia.PDF.isAvailable()` is
false only for source/development builds that have not generated the artifact.

## PDF package release identity

The source workspace intentionally remains named `@shopify/react-native-skia`
so existing workspace imports keep resolving. `yarn pack-pdf --version 2.10.1`
creates a DevSSD-staged tarball named `react-native-skia-pdf-2.10.1.tgz` by
transforming only the packed `package.json` name and version. The release
configuration publishes that transformed tarball and uploads it as the GitHub
release asset; it does not publish the source workspace name.

Every pack run creates a new exclusive staging directory under DevSSD and
refuses to reuse an existing staging directory, tarball, or manifest. Local
packing ignores lifecycle scripts, so it consumes the reviewed Web PDF
artifact without rebuilding native or WASM binaries.

The source workspace currently reports version `0.0.0`; do not tag this
unversioned source snapshot as `2.10.1`. Before publication, complete the
release-versioning step so the reviewed source commit reports `2.10.1`, commit
the source and generated Web PDF artifact in this fork, and then create and
push the exact `2.10.1` tag at that commit:

```text
https://github.com/marqroldan/react-native-skia.git @ 2.10.1
```

After a direct install, consumers can import `react-native-skia-pdf`. To keep
existing `@shopify/react-native-skia` imports unchanged, install the published
package through an npm alias:

```bash
npm install @shopify/react-native-skia@npm:react-native-skia-pdf@2.10.1
```

The podspec keeps the `react-native-skia` CocoaPods name but points its source
at that fork and tag. The pinned `react-native-skia-*-pdf@150.0.0-pdf.1`
packages are existing prebuilt native dependencies; their exact source commit
is not established by this release preparation and must not be inferred from
the Web Skia pin.
