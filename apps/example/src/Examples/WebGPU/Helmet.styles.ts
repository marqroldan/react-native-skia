import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
  },
  loading: {
    color: "#fff",
  },
  absoluteFill: {
    ...StyleSheet.absoluteFill,
  },
});
