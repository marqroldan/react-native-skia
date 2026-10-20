import * as React from "react";
import { ScrollView, Text, View, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { Routes } from "./Routes";
import { styles } from "./List.styles";

export const examples = [
  {
    screen: "LiquidShape",
    title: "🔘 Liquid Shape",
  },
  {
    screen: "DisplacementMap1",
    title: "🗺️  Displacement Map  1",
  },
  {
    screen: "DisplacementMap2",
    title: "🗺️  Displacement Map  2",
  },
  {
    screen: "Shader1",
    title: "🎨 Shader 1",
  },
  {
    screen: "Shader2",
    title: "🎨 Shader 2",
  },
] as const;

export const List = () => {
  const navigation = useNavigation<NativeStackNavigationProp<Routes, "List">>();
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {examples.map((thumbnail) => (
        <Pressable
          key={thumbnail.screen}
          onPress={() => {
            navigation.navigate(thumbnail.screen);
          }}
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
