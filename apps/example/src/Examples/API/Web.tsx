import * as React from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { Routes } from "./Routes";
import { styles } from "./Web.styles";

const examples = [
  {
    screen: "WebLayout",
    title: "🕸️ Web Layout",
  },
  {
    screen: "WebGLContexts",
    title: "🔥 WebGL Contexts",
  },
  {
    screen: "WebGLLifecycle",
    title: "♻️ WebGL Lifecycle",
  },
  {
    screen: "WebMemory",
    title: "💧 WASM Memory",
  },
  {
    screen: "WebOffscreen",
    title: "🧱 Offscreen Surfaces",
  },
] as const;

export const Web = () => {
  const navigation = useNavigation<NativeStackNavigationProp<Routes, "Web">>();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {examples.map((thumbnail) => (
        <Pressable
          key={thumbnail.screen}
          onPress={() => navigation.navigate(thumbnail.screen)}
          testID={thumbnail.screen}
        >
          <View style={styles.thumbnail}>
            <Text style={styles.title}>{thumbnail.title}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
};
