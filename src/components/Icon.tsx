import { memo } from 'react';
import Svg, { Circle, Path, Rect, type SvgProps } from 'react-native-svg';

/**
 * The ClassCare icon set.
 *
 * Every glyph is the exact path data from the Claude Design source, so the
 * silhouettes match the mockups rather than approximating them with a generic
 * icon library. Each entry declares its own viewBox and default stroke width;
 * `<Icon>` scales it to whatever `size` the caller asks for.
 */

type Glyph = {
  /** Square viewBox edge from the source SVG. */
  box: number;
  /** Default stroke width, in viewBox units. */
  sw?: number;
  /** Paths (`d` strings) drawn with the current stroke. */
  d?: string[];
  /** Circles drawn with the current stroke, as `[cx, cy, r]`. */
  circles?: [number, number, number][];
  /** Rects drawn with the current stroke, as `[x, y, w, h, rx]`. */
  rects?: [number, number, number, number, number][];
  /** Filled rather than stroked (Apple mark, solid glyphs). */
  filled?: boolean;
};

const GLYPHS = {
  chevronLeft: { box: 18, sw: 1.9, d: ['M11 3.5 5.5 9l5.5 5.5'] },
  chevronRight: { box: 18, sw: 1.9, d: ['m7 3.5 5.5 5.5L7 14.5'] },
  /** Small trailing chevron used inside list rows. */
  disclosure: { box: 16, sw: 1.9, d: ['m6 3 5 5-5 5'] },
  close: { box: 18, sw: 2, d: ['M4 4l10 10M14 4 4 14'] },
  plus: { box: 16, sw: 1.9, d: ['M8 3v10M3 8h10'] },
  plusLarge: { box: 22, sw: 2.1, d: ['M11 5v12M5 11h12'] },
  check: { box: 16, sw: 2, d: ['M2.5 8.4 6 11.9l7.5-8'] },
  search: { box: 20, sw: 1.8, circles: [[9, 9, 6]], d: ['m13.5 13.5 3.5 3.5'] },
  phone: {
    box: 18,
    sw: 1.7,
    d: [
      'M6.2 3.2 7.6 6 6.1 7.6a9.5 9.5 0 0 0 4.3 4.3L12 10.4l2.8 1.4v2.6c0 .6-.5 1-1.1 1C8 15 3 10 2.6 4.3c0-.6.4-1.1 1-1.1z',
    ],
  },
  chat: { box: 18, sw: 1.7, d: ['M2.5 4.5h13v9h-8l-3.2 2.6V13.5H2.5z'] },
  pencil: {
    box: 18,
    sw: 1.7,
    d: ['M12.2 2.9 15.1 5.8 6.4 14.5l-3.6.7.7-3.6z'],
  },
  more: { box: 18, sw: 2.2, d: ['M9 4.5h.01M9 9h.01M9 13.5h.01'] },
  mail: {
    box: 18,
    sw: 1.7,
    rects: [[2.5, 4, 13, 10, 2]],
    d: ['m3 5.5 6 4.2 6-4.2'],
  },
  /** Flat envelope used on the channel picker. */
  envelope: {
    box: 18,
    sw: 1.6,
    d: ['M2.5 4h13v10h-13z', 'M3 4.6l6 4.4 6-4.4'],
  },
  bell: {
    box: 18,
    sw: 1.6,
    d: [
      'M9 2.5a4.5 4.5 0 0 1 4.5 4.5v3l1.5 2.5H3l1.5-2.5V7A4.5 4.5 0 0 1 9 2.5z',
      'M7.2 15a1.8 1.8 0 0 0 3.6 0',
    ],
  },
  person: {
    box: 18,
    sw: 1.7,
    circles: [[9, 6.5, 3]],
    d: ['M3.5 15c.9-3 3-4.5 5.5-4.5s4.6 1.5 5.5 4.5'],
  },
  info: {
    box: 18,
    sw: 1.7,
    circles: [[9, 9, 6.5]],
    d: ['M9 5.6v3.9M9 12.2h.01'],
  },
  /** Appearance picker: light. Disc plus eight rays. */
  sun: {
    box: 18,
    sw: 1.7,
    circles: [[9, 9, 3.4]],
    d: [
      'M9 1.6v1.8M9 14.6v1.8M1.6 9h1.8M14.6 9h1.8M3.8 3.8l1.3 1.3M12.9 12.9l1.3 1.3M14.2 3.8l-1.3 1.3M5.1 12.9l-1.3 1.3',
    ],
  },
  /** Appearance picker: dark. Crescent, drawn as one closed path. */
  moon: {
    box: 18,
    sw: 1.7,
    d: ['M14.8 10.6A6.2 6.2 0 0 1 7.4 3.2a6.4 6.4 0 1 0 7.4 7.4z'],
  },
  send: {
    box: 18,
    sw: 1.8,
    d: ['M15.5 2.5 8 10M15.5 2.5l-5 13-2.5-5.5L2.5 7.5z'],
  },
  contacts: {
    box: 20,
    sw: 1.7,
    rects: [[3, 2.5, 14, 15, 3]],
    circles: [[10, 8, 2.4]],
    d: ['M6 15c.8-2 2.3-3 4-3s3.2 1 4 3'],
  },
  megaphone: {
    box: 16,
    sw: 1.8,
    d: ['M2.5 6.5h3l5-3v9l-5-3h-3z', 'M12.5 5.5a3.5 3.5 0 0 1 0 5'],
  },
  warning: {
    box: 16,
    sw: 1.9,
    circles: [[8, 8, 5.8]],
    d: ['M8 5v3.2M8 11h.01'],
  },

  // Tab bar
  tabGroups: {
    box: 22,
    sw: 1.9,
    rects: [
      [3, 4, 7, 7, 2],
      [12, 4, 7, 7, 2],
      [3, 13, 7, 5, 2],
      [12, 13, 7, 5, 2],
    ],
  },
  tabCalendar: {
    box: 22,
    sw: 1.9,
    rects: [[3, 4.5, 16, 14, 3]],
    d: ['M3 9h16M7.5 2.5v4M14.5 2.5v4'],
  },
  tabMessages: { box: 22, sw: 1.9, d: ['M3 5.5h16v11H9.5L5 20v-3.5H3z'] },
  tabStudents: {
    box: 22,
    sw: 1.9,
    circles: [[11, 7.5, 3.5]],
    d: ['M4.5 18.5c1-3.4 3.6-5 6.5-5s5.5 1.6 6.5 5'],
  },

  apple: {
    box: 18,
    filled: true,
    d: [
      'M12.6 9.5c0-1.7 1.4-2.5 1.45-2.55-.8-1.15-2.03-1.3-2.47-1.32-1.05-.1-2.05.62-2.58.62-.53 0-1.35-.6-2.22-.59-1.14.02-2.19.66-2.78 1.68-1.18 2.05-.3 5.08.85 6.74.56.81 1.24 1.72 2.11 1.69.85-.04 1.17-.55 2.2-.55s1.31.55 2.21.53c.91-.02 1.49-.83 2.05-1.65.64-.94.9-1.86.92-1.9-.02-.01-1.76-.68-1.78-2.7zM11.03 4.5c.47-.57.79-1.36.7-2.15-.68.03-1.5.45-1.98 1.02-.43.5-.81 1.31-.71 2.08.76.06 1.53-.39 1.99-.95z',
    ],
  },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;

export type IconProps = {
  name: IconName;
  /** Rendered edge length in points. Defaults to the source viewBox size. */
  size?: number;
  color?: string;
  /** Override the glyph's default stroke width (viewBox units). */
  strokeWidth?: number;
} & Omit<SvgProps, 'color'>;

export const Icon = memo(function Icon({
  name,
  size,
  color = 'currentColor',
  strokeWidth,
  ...rest
}: IconProps) {
  const g = GLYPHS[name] as Glyph;
  const edge = size ?? g.box;
  const stroke = g.filled ? undefined : color;
  const sw = strokeWidth ?? g.sw ?? 1.7;

  return (
    <Svg width={edge} height={edge} viewBox={`0 0 ${g.box} ${g.box}`} fill="none" {...rest}>
      {g.rects?.map(([x, y, w, h, rx], i) => (
        <Rect
          key={`r${i}`}
          x={x}
          y={y}
          width={w}
          height={h}
          rx={rx}
          stroke={stroke}
          strokeWidth={sw}
        />
      ))}
      {g.circles?.map(([cx, cy, r], i) => (
        <Circle key={`c${i}`} cx={cx} cy={cy} r={r} stroke={stroke} strokeWidth={sw} />
      ))}
      {g.d?.map((d, i) => (
        <Path
          key={`p${i}`}
          d={d}
          fill={g.filled ? color : 'none'}
          stroke={stroke}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
});

/** Google's four-colour "G" — filled, so it lives outside the stroke registry. */
export function GoogleMark({ size = 19 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M19.6 10.23c0-.68-.06-1.36-.19-2.03H10v3.85h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.33 2.98-7.34z"
        fill="#4285F4"
      />
      <Path
        d="M10 20c2.7 0 4.96-.89 6.62-2.43l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.75-5.6-4.11H1.07v2.58A10 10 0 0 0 10 20z"
        fill="#34A853"
      />
      <Path d="M4.4 11.92a6 6 0 0 1 0-3.83V5.5H1.07a10 10 0 0 0 0 9l3.33-2.58z" fill="#FBBC05" />
      <Path
        d="M10 3.98c1.47 0 2.79.51 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 10 0 10 10 0 0 0 1.07 5.5L4.4 8.08c.8-2.36 3-4.1 5.6-4.1z"
        fill="#EA4335"
      />
    </Svg>
  );
}
