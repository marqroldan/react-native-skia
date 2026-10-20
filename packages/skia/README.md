# React Native Skia

High-performance 2d Graphics for React Native using Skia

[![CI](https://github.com/wcandillon/react-native-skia/actions/workflows/ci.yml/badge.svg)](https://github.com/wcandillon/react-native-skia/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/react-native-skia.svg?style=flat)](https://www.npmjs.com/package/react-native-skia)
[![issues](https://img.shields.io/github/issues/wcandillon/react-native-skia.svg?style=flat)](https://github.com/wcandillon/react-native-skia/issues)

<img width="400" alt="skia" src="https://user-images.githubusercontent.com/306134/146549218-b7959ad9-0107-4c1c-b439-b96c780f5230.png">

Checkout the full documentation [here](https://wcandillon.github.io/react-native-skia).

React Native Skia brings the Skia Graphics Library to React Native. Skia serves as the graphics engine for Google Chrome and Chrome OS, Android, Flutter, Mozilla Firefox and Firefox OS, and many other products.

## Getting Started

```sh
yarn add react-native-skia
```

[Installation instructions](https://wcandillon.github.io/react-native-skia/docs/getting-started/installation/)

## v3 and v2

React Native Skia v3 renders with [Graphite](https://skia.org/docs/user/graphite/), Skia's new GPU backend. It runs on Metal on Apple platforms and on Vulkan on Android.

| | v3 | v2 |
|:--|:--|:--|
| npm | `react-native-skia` | `react-native-skia@2` |
| Skia backend | Graphite (Vulkan/Metal) | Ganesh (OpenGL/Metal) |
| Architecture | multi-threaded | single-threaded |
| Platforms | iOS, Android, macOS, Mac Catalyst, tvOS, Web | iOS, Android, macOS, Mac Catalyst, tvOS, Android TV, Web |
| Branch | [`main`](https://github.com/wcandillon/react-native-skia/tree/main) | [`2.x`](https://github.com/wcandillon/react-native-skia/tree/2.x) |
| Documentation | [wcandillon.github.io/react-native-skia](https://wcandillon.github.io/react-native-skia/) | [wcandillon.github.io/react-native-skia/v2](https://wcandillon.github.io/react-native-skia/v2/) |

v2 is still maintained. To upgrade from v2 or from `@shopify/react-native-skia`, follow the [migration guide](https://wcandillon.github.io/react-native-skia/docs/getting-started/migration).

## WebGPU

Graphite runs on Dawn, Google's WebGPU implementation.
With [React Native WebGPU](https://github.com/wcandillon/react-native-webgpu) installed alongside it, Skia and WebGPU share the same GPU device and can exchange textures without any copy. This also works with three.js.
See the [WebGPU documentation](https://wcandillon.github.io/react-native-skia/docs/webgpu).

## Contributing

For detailed information on library development, building, testing, and contributing guidelines, please see [CONTRIBUTING.md](https://github.com/wcandillon/react-native-skia/blob/main/packages/skia/CONTRIBUTING.md).

## PDF fork (3.7.1 / Skia m157)

This fork adds `Skia.PDF` and `renderAsPDF` to upstream React Native Skia 3.7.1.
Install it under the canonical dependency name so calendar, charts, and printing
share one runtime:

```sh
npm install react-native-skia@npm:react-native-skia-pdf@3.7.1
```

Import from `react-native-skia`. Remove the old scoped Skia dependency and migrate
mutable path construction to `Skia.PathBuilder` before upgrading shared consumers.
`builder.build()` creates an immutable path while preserving the builder;
`builder.detach()` creates a path and resets it.

PDF pages use points (72 points per inch). Call `beginPage`, draw with its canvas,
then call `endPage`; after all pages call `close()` for a `Uint8Array`. A page canvas
must not be used after its page ends. `abort()` discards an unfinished document.
`renderAsPDF([{width, height, element}], metadata)` renders Skia React elements;
resolve asynchronous images and fonts before invoking it.

For web, use the shipped PDF-enabled CanvasKit initializer and its matching WASM:

```sh
npx setup-skia-web public
```

```ts
import { LoadSkiaWeb } from "react-native-skia/lib/module/web";
await LoadSkiaWeb({ locateFile: () => "/canvaskit.wasm" });
```

The setup command copies this fork's WASM. A stock CanvasKit WASM or stock CDN
initializer does not provide the PDF backend. Explicit `CanvasKitInit` overrides
remain available, but PDF availability depends on the supplied build.

Native PDF binary packages and headers must come from the same pinned m157 source.
The current iOS artifact contains arm64 device and arm64 simulator slices; macOS
contains arm64 and x64. Android contains armeabi-v7a, arm64-v8a, x86, and x86_64.
tvOS contains arm64 device and arm64 simulator slices. Intel iOS/tvOS simulator
and Catalyst slices have not been built.
