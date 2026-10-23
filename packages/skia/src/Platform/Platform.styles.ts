import type { CSSProperties } from "react";
import type { ViewProps } from "react-native";
import { StyleSheet } from "react-native";

const viewReset: CSSProperties = {
  alignItems: "stretch",
  backgroundColor: "transparent",
  border: "0 solid black",
  boxSizing: "border-box",
  display: "flex",
  flexBasis: "auto",
  flexDirection: "column",
  flexShrink: 0,
  listStyle: "none",
  // Browser View reset, not spacing between mobile siblings.
  margin: 0,
  minHeight: 0,
  minWidth: 0,
  padding: 0,
  position: "relative",
  textDecoration: "none",
  zIndex: 0,
};

export const getViewStyles = (style: ViewProps["style"]): CSSProperties => ({
  ...viewReset,
  ...(StyleSheet.flatten(style) as CSSProperties | undefined),
});
