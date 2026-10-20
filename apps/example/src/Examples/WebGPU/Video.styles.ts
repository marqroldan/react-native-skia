import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
  },
  absoluteFill: {
    ...StyleSheet.absoluteFill,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
  },
  label: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexGrow: 0,
  },
  barContent: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
  chipSelected: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  chipLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  chipLabelSelected: {
    color: "#000",
  },
});
