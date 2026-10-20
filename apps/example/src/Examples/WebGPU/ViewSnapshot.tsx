import React, { useCallback, useRef, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  View,
  Button,
  Text,
  PixelRatio,
  useWindowDimensions,
  ScrollView,
} from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
import type { SkImage } from "react-native-skia";
import {
  Canvas,
  Fill,
  Skia,
  RoundedRect,
  mix,
  Shader,
  ImageShader,
  useImage,
  Image,
} from "react-native-skia";
import { Switch } from "react-native-gesture-handler";
import { useDerivedValue, useSharedValue } from "react-native-reanimated";
import { importDevice } from "react-native-webgpu";

import { useLoop } from "../../components/Animations";

import { canvasSizeStyle, styles } from "./ViewSnapshot.styles";

const source = Skia.RuntimeEffect.Make(`
uniform shader image;
uniform float r;

half4 main(float2 xy) {
  xy.x += sin(xy.y / r) * 4;
  return image.eval(xy).rgba;
}`)!;

// A snapshot of a native view is taken by React Native WebGPU, which draws
// the view into a texture of the shared device; Skia wraps that texture into
// an image without copying it.
const snapshotView = async (
  view: React.RefObject<View | null>,
  width: number,
  height: number
) => {
  const device = importDevice(Skia.getNativeDevice());
  const scale = PixelRatio.get();
  const texture = device.createTexture({
    size: [Math.round(width * scale), Math.round(height * scale)],
    format: "rgba8unorm",
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT |
      GPUTextureUsage.TEXTURE_BINDING,
  });
  // Skia images are premultiplied
  await device.queue.drawElementImageToTexture(
    { source: view },
    { texture, premultipliedAlpha: true }
  );
  return { texture, image: Skia.Image.MakeImageFromGPUTexture(texture) };
};

export const ViewSnapshot = () => {
  const { width } = useWindowDimensions();
  const viewRef = useRef<View>(null);
  const layout = useRef({ width: 0, height: 0 });
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    layout.current = event.nativeEvent.layout;
  }, []);

  const progress = useLoop({ duration: 1500 });
  const uniforms = useDerivedValue(
    () => ({ r: mix(progress.value, 1, 100) }),
    [progress]
  );

  const image = useSharedValue<SkImage | null>(null);
  const texture = useRef<GPUTexture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const takeSnapshot = useCallback(async () => {
    const { width: w, height: h } = layout.current;
    if (viewRef.current === null || w === 0 || h === 0) {
      return;
    }
    try {
      const snapshot = await snapshotView(viewRef, w, h);
      // Drop the previous image before the texture it samples
      const previous = image.value;
      image.value = snapshot.image;
      previous?.dispose();
      texture.current?.destroy();
      texture.current = snapshot.texture;
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [image]);

  return (
    <View style={styles.outer}>
      <View
        ref={viewRef}
        style={styles.view}
        collapsable={false}
        onLayout={onLayout}
      >
        <Component />
      </View>
      <Button title="Take snapshot" onPress={takeSnapshot} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Canvas style={styles.canvas}>
        <Fill color="white" />
        <Fill>
          <Shader source={source} uniforms={uniforms}>
            <ImageShader
              image={image}
              fit="contain"
              x={0}
              y={0}
              width={width}
              height={width}
            />
          </Shader>
        </Fill>
      </Canvas>
    </View>
  );
};

const Component = () => {
  const [counter, setCounter] = useState(0);
  return (
    <ScrollView style={styles.scrollview}>
      <View style={styles.component}>
        <View style={styles.transformedBox} />
        <View style={styles.blueBox} />
      </View>
      <Text>Hello World!</Text>
      <View style={styles.row}>
        <Svg width={80} height={80} viewBox="0 0 80 80">
          <Rect x={0} y={0} width={80} height={80} fill="blue" opacity={0.5} />
          <Circle cx={40} cy={40} r={25} fill="green" opacity={0.7} />
          <Rect x={30} y={30} width={20} height={20} fill="red" opacity={0.5} />
        </Svg>
        <View style={styles.clippedRedBox}>
          <View style={styles.cyanBar}>
            <View style={styles.redSquare} />
          </View>
        </View>
      </View>
      <Button
        title={"Press me to increment (" + counter + ")"}
        onPress={() => setCounter((i) => i + 1)}
      />
      <Switch value={true} />
      <Canvas style={styles.smallCanvas}>
        <RoundedRect x={0} y={20} width={80} height={80} r={10} color="blue" />
      </Canvas>
      <Text>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;👆 This is a Skia Canvas!</Text>
      <Interleaving />
    </ScrollView>
  );
};

const PUPPY_TO_MAKE_YOUR_DAY_BETTER =
  "https://images.squarespace-cdn.com/content/v1/54e7a1a6e4b08db9da801ded/7f2dae36-5650-4b84-b184-684f46fe68aa/98.jpg";

const Interleaving = () => {
  const { height, width } = useWindowDimensions();
  const image = useImage(PUPPY_TO_MAKE_YOUR_DAY_BETTER);

  return (
    <View style={styles.integratingContainer}>
      <View style={styles.pinkContainer} />
      <Canvas style={canvasSizeStyle(width, height)}>
        <Image
          image={image}
          height={height}
          width={width}
          fit={"cover"}
          opacity={0.5}
        />
      </Canvas>
      <View style={styles.salmonContainer}>
        <Text style={styles.black}>Let me be a part of your snapshot!</Text>
        <View style={styles.innerContainer}>
          <Text style={styles.black}>I'm inside the red thingie!</Text>
        </View>
      </View>
    </View>
  );
};
