import React, { useMemo } from "react";
import type { ViewComponent, ViewProps } from "react-native";

import type { DataModule } from "../skia/types";
import { isRNModule, unwrapModule } from "../skia/types";

import type { IPlatform } from "./IPlatform";
import { getViewStyles } from "./Platform.styles";

// Layout is observed by the views themselves (see SkiaView.web.tsx):
// this shim only reproduces react-native-web's default View styling.
const View = (({ children, style: rawStyle }: ViewProps) => {
  const cssStyles = useMemo(() => getViewStyles(rawStyle), [rawStyle]);

  return <div style={cssStyles}>{children}</div>;
}) as unknown as typeof ViewComponent;

interface AssetRegistry {
  getAssetByID(id: number): {
    httpServerLocation: string;
    name: string;
    type: string;
  };
}

// React Native 0.87 replaced Libraries/Image/AssetRegistry with the
// react-native/asset-registry export. Each require must stay directly inside
// its own try block so that bundlers treat it as an optional dependency.
const requireAssetRegistry = (): AssetRegistry | null => {
  try {
    return require("react-native/asset-registry");
  } catch {}
  try {
    return require("react-native/Libraries/Image/AssetRegistry");
  } catch {}
  return null;
};

export const Platform: IPlatform = {
  OS: "web",
  PixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1, // window is not defined on node
  resolveAsset: (source: DataModule) => {
    const asset = unwrapModule(source);
    if (typeof asset === "string") {
      return asset;
    }
    if (isRNModule(asset)) {
      const registry =
        typeof require === "function" ? requireAssetRegistry() : null;
      if (registry) {
        const { httpServerLocation, name, type } = registry.getAssetByID(asset);
        const uri = `${httpServerLocation}/${name}.${type}`;
        return uri;
      }
      throw new Error(
        "Asset source is a number - this is not supported on the web"
      );
    }
    return asset.uri;
  },
  View,
};
