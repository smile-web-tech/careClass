import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * Decorative background pieces shared by the dark headers (sign-in, home hero
 * card, group detail). Kept in one place so the geometry stays consistent.
 */

/**
 * CSS gradients are specified by angle; expo-linear-gradient wants start/end
 * points. This converts, using the CSS convention where 0deg points up and
 * angles run clockwise.
 */
export function angleToPoints(deg: number) {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.sin(rad) / 2;
  const dy = -Math.cos(rad) / 2;
  return {
    start: { x: 0.5 - dx, y: 0.5 - dy },
    end: { x: 0.5 + dx, y: 0.5 + dy },
  };
}

export function AngledGradient({
  colors,
  angle,
  locations,
  style,
}: {
  colors: readonly [string, string, ...string[]];
  angle: number;
  locations?: readonly [number, number, ...number[]];
  style?: ViewStyle;
}) {
  const { start, end } = angleToPoints(angle);
  return (
    <LinearGradient
      colors={colors}
      locations={locations}
      start={start}
      end={end}
      style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }, style]}
    />
  );
}

/**
 * Soft radial bloom — `radial-gradient(circle, <tint>, transparent <fade>%)`.
 * RN has no radial gradient, so this is an SVG rect filled with one.
 */
export function Glow({
  size,
  tint,
  opacity = 0.55,
  fade = 0.68,
  style,
}: {
  size: number;
  tint: string;
  opacity?: number;
  fade?: number;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        { position: 'absolute', width: size, height: size, pointerEvents: 'none' },
        style,
      ]}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={tint} stopOpacity={opacity} />
            <Stop offset={String(fade)} stopColor={tint} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={size} height={size} fill="url(#glow)" />
      </Svg>
    </View>
  );
}

/** Thin outlined circle used to break up the dark headers. */
export function Ring({
  size,
  width = 1,
  tint,
  style,
}: {
  size: number;
  width?: number;
  tint: string;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: width,
          borderColor: tint,
          pointerEvents: 'none',
        },
        style,
      ]}
    />
  );
}
