import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "white",
  },
  stage: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  stripes: {
    ...StyleSheet.absoluteFill,
  },
  stripe: {
    flex: 1,
  },
  stripeAlternate: {
    backgroundColor: "#ddd",
  },
  stripeDefault: {
    backgroundColor: "#bbb",
  },
  frame: {
    width: 260,
    height: 200,
  },
  clip: {
    width: 260,
    height: 200,
    borderRadius: 32,
    overflow: "hidden",
    transform: [{ rotate: "-6deg" }],
  },
  canvas: {
    width: 260,
    height: 200,
  },
  otherSurface: {
    position: "absolute",
    right: -40,
    bottom: -30,
    width: 180,
    height: 90,
  },
  overlay: {
    position: "absolute",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "rgba(255, 59, 48, 0.85)",
  },
  overlayText: {
    color: "white",
    fontWeight: "bold",
  },
  controls: {
    padding: 16,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  label: {
    fontWeight: "bold",
  },
  chip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#999",
    alignItems: "center",
  },
  chipActive: {
    backgroundColor: "#007aff",
    borderColor: "#007aff",
  },
  chipText: {
    color: "#333",
  },
  chipTextActive: {
    color: "white",
  },
  hint: {
    color: "#666",
  },
});
