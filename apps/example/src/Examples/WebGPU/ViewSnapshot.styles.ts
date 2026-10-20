import type { ViewStyle } from "react-native";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  outer: {
    flex: 1,
  },
  view: {
    flex: 1,
    backgroundColor: "yellow",
  },
  scrollview: {
    padding: 14,
  },
  canvas: {
    flex: 1,
  },
  error: {
    color: "red",
    paddingHorizontal: 16,
  },
  component: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 200,
    height: 200,
  },
  transformedBox: {
    position: "absolute",
    transform: [{ translateX: 20 }, { translateY: 100 }],
    top: 0,
    left: 0,
    width: 80,
    height: 80,
    backgroundColor: "red",
  },
  blueBox: {
    position: "absolute",
    top: 100,
    left: 100,
    width: 80,
    height: 80,
    backgroundColor: "blue",
  },
  row: {
    flexDirection: "row",
  },
  clippedRedBox: {
    width: 40,
    height: 40,
    backgroundColor: "red",
    opacity: 0.5,
    overflow: "hidden",
  },
  cyanBar: {
    width: 150,
    height: 10,
    backgroundColor: "cyan",
  },
  redSquare: {
    width: 20,
    height: 20,
    backgroundColor: "red",
  },
  smallCanvas: {
    width: 100,
    height: 100,
  },
  pinkContainer: {
    backgroundColor: "#00ff6922",
    position: "absolute",
    alignSelf: "center",
    left: 50,
    top: 50,
    right: 50,
    bottom: 50,
  },
  integratingContainer: {
    position: "absolute",
    left: "25%",
    top: 0,
    bottom: 0,
    transform: [{ scale: 0.5 }],
  },
  salmonContainer: {
    backgroundColor: "#ff8c6922",
    position: "absolute",
    alignSelf: "center",
    padding: 20,
    // margin-exception: preserve the absolute-centered overlay offset.
    marginTop: 80,
  },
  black: {
    color: "black",
    textAlign: "center",
  },
  innerContainer: {
    backgroundColor: "#ff8c0044",
    transform: [{ translateX: 50 }, { rotate: "45deg" }],
  },
});

export const canvasSizeStyle = (width: number, height: number): ViewStyle => ({
  width,
  height,
});
