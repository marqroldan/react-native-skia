import { Platform, StyleSheet } from "react-native";

export const createStyles = (size: number) =>
  StyleSheet.create({
    container: {
      padding: 16,
      gap: 12,
    },
    header: {
      fontSize: 18,
      fontWeight: "bold",
    },
    description: {
      fontSize: 13,
      color: "#666",
    },
    status: {
      fontSize: 13,
      fontFamily: Platform.select({ web: "monospace", default: undefined }),
    },
    row: {
      flexDirection: "row",
      gap: 12,
    },
    actions: {
      gap: 8,
      alignItems: "flex-start",
    },
    canvas: {
      width: size,
      height: size,
    },
  });
