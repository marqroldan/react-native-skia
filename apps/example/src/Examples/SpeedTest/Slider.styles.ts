import type { ViewStyle } from "react-native";
import { StyleSheet } from "react-native";

interface SliderStyleOptions {
  pickerR: number;
  progressBarHeight: number;
  size: number;
  sliderWidth: number;
}

export const createStyles = ({
  pickerR,
  progressBarHeight,
  size,
  sliderWidth,
}: SliderStyleOptions) =>
  StyleSheet.create({
    picker: {
      position: "absolute",
      width: size,
      height: size,
      borderRadius: pickerR,
      backgroundColor: "white",
    },
    progressBar: {
      height: progressBarHeight,
      backgroundColor: "rgba(255,255,255,0.5)",
      width: sliderWidth,
    },
  });

export const pickerTransformStyle = (
  translateX: number,
  scale: number,
  pickerR: number,
  progressBarHeight: number
): ViewStyle => {
  "worklet";
  return {
    transform: [
      { translateX },
      { translateY: -pickerR + progressBarHeight },
      { scale },
    ],
  };
};
