/**
 * ClassCare design tokens, light and dark.
 *
 * Every value is lifted verbatim from the Claude Design source — light from
 * `ClassCare N *.dc.html`, dark from `ClassCare N * Dark.dc.html`. Screens must
 * reference these through `useTheme()`, never raw hex, or they will not respond
 * to the theme switch.
 *
 * The two palettes are deliberately the same shape: anything added to one must
 * be added to the other, and `Palette` makes that a compile error rather than a
 * runtime `undefined` that renders as a black box.
 */

/* ------------------------------------------------------------------ *
 * Scale — identical in both themes.
 * ------------------------------------------------------------------ */

export const radius = {
  xs: 5,
  sm: 7,
  md: 9,
  lg: 11,
  control: 12,
  field: 13,
  button: 14,
  tile: 15,
  card: 16,
  fab: 18,
  hero: 20,
  sheet: 26,
} as const;

export const space = {
  /** Standard horizontal page gutter. */
  gutter: 20,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
} as const;

/** Opacity applied to a pressable while the finger is down. */
export const PRESS_OPACITY = 0.72;

/* ------------------------------------------------------------------ *
 * Colour.
 * ------------------------------------------------------------------ */

const light = {
  // Brand
  primary: '#2457E8',
  primaryPressed: '#1B44BC',
  primaryInk: '#1B44BC',
  primaryTint: '#EAF0FE',
  primaryTintDeep: '#DDE6FC',
  primaryTintPressed: '#D8E4FD',

  // Surfaces
  bg: '#F4F7FB',
  surface: '#FFFFFF',
  surfacePressed: '#F8FAFD',
  canvas: '#E7ECF4',
  fill: '#F4F7FB',
  fillPressed: '#E1E7F0',
  navy: '#0C1729',
  navyRaised: '#16233C',
  navyGradientTop: '#12305F',
  /** Bottom sheet on the sign-in screen. */
  sheet: '#F4F7FB',
  /** "Up next" hero card gradient on Home. */
  heroFrom: '#2457E8',
  heroTo: '#123AAE',
  /** The light button sitting inside that hero. */
  heroActionBg: '#FFFFFF',
  heroActionInk: '#1B44BC',
  /** Translucent tab-bar / action-bar backing. */
  barTint: 'rgba(255,255,255,0.95)',
  /** Dim behind a modal sheet. */
  scrim: 'rgba(12,23,41,0.35)',

  // Lines
  border: '#E1E7F0',
  borderStrong: '#B9C6DC',
  borderCool: '#DDE4EF',
  divider: '#EDF1F7',
  dashed: '#C5CFDF',
  rule: '#D2DAE6',

  // Text
  ink: '#0C1729',
  inkSoft: '#47566E',
  muted: '#6B7A94',
  mutedLight: '#8494AC',
  faint: '#A4B1C6',
  chevron: '#C5CFDF',
  onDark: '#EAF0FB',
  /** Ink used on top of a saturated status dot. */
  onStatus: '#FFFFFF',

  // Semantic
  success: '#0E9F6E',
  successDeep: '#0B7C55',
  warning: '#E09A19',
  warningDeep: '#A8730B',
  danger: '#E5484D',
  dangerDeep: '#C13136',
  mint: '#7DF2C3',

  // Sign-in provider buttons
  googleBg: '#FFFFFF',
  googleBorder: '#DDE4EF',
  appleBg: '#0C1729',
  appleInk: '#F4F7FB',
} as const;

/** Shape every palette must satisfy. */
export type Palette = { readonly [K in keyof typeof light]: string };

const dark: Palette = {
  // Brand — lifted on dark so it clears the surface without glowing.
  primary: '#2F63F0',
  primaryPressed: '#4B78F3',
  primaryInk: '#7FA2FF',
  primaryTint: '#1B2742',
  primaryTintDeep: '#1E2B47',
  primaryTintPressed: '#1E2B47',

  // Surfaces
  bg: '#0F1520',
  surface: '#1A2230',
  surfacePressed: '#1E2736',
  canvas: '#04070C',
  fill: '#232D3C',
  fillPressed: '#2A3442',
  navy: '#080C15',
  navyRaised: '#151D2A',
  navyGradientTop: '#17376B',
  sheet: '#151D2A',
  heroFrom: '#2A56D8',
  heroTo: '#122A72',
  heroActionBg: '#F2F6FF',
  heroActionInk: '#123AAE',
  barTint: 'rgba(15,21,32,0.9)',
  // Navy-on-navy reads as nothing; dark needs true black to separate.
  scrim: 'rgba(0,0,0,0.62)',

  // Lines
  border: '#2A3442',
  borderStrong: '#4A586C',
  borderCool: '#313C4C',
  divider: '#232D3C',
  dashed: '#3C4858',
  rule: '#2A3442',

  // Text
  ink: '#E9EFF8',
  inkSoft: '#B4C2D5',
  muted: '#93A2B8',
  mutedLight: '#7A899F',
  faint: '#5C6B80',
  chevron: '#3C4858',
  onDark: '#E9EFF8',
  // On dark the status dots are bright, so their glyph must be dark to read.
  onStatus: '#0B1220',

  // Semantic
  success: '#3FD292',
  successDeep: '#38C98A',
  warning: '#E9AC3D',
  warningDeep: '#E5AB3F',
  danger: '#DE5257',
  dangerDeep: '#F1666B',
  mint: '#7DF2C3',

  googleBg: '#1A2230',
  googleBorder: '#313C4C',
  // Inverted against light: a white Apple button on a dark sheet.
  appleBg: '#E9EFF8',
  appleInk: '#0B111C',
};

/* ------------------------------------------------------------------ *
 * Group accents — four colourways, cycled per group.
 * ------------------------------------------------------------------ */

type Accent = {
  dot: string;
  tint: string;
  ink: string;
  inkDeep: string;
  sub: string;
  dotDark: string;
  inkDark: string;
  headerFrom: string;
  headerTo: string;
};
type AccentSet = Record<
  | 'blue'
  | 'teal'
  | 'violet'
  | 'amber'
  | 'rose'
  | 'emerald'
  | 'indigo'
  | 'orange'
  | 'cyan'
  | 'pink'
  | 'lime'
  | 'slate',
  Accent
>;

/**
 * Twelve colourways, cycled per group. The first four are the design source's
 * originals; the rest follow the same construction so a teacher with a dozen
 * groups still gets one glance-distinguishable colour each.
 *
 * Per entry: `dot` is the saturated mark, `tint` its wash, `ink` text on that
 * wash, `sub` the secondary label, and `headerFrom`/`headerTo` the group-detail
 * header gradient.
 */
const lightAccents: AccentSet = {
  blue: {
    dot: '#2457E8',
    tint: '#EAF0FE',
    ink: '#2457E8',
    inkDeep: '#1B44BC',
    sub: '#7C93C4',
    dotDark: '#4E85FF',
    inkDark: '#9CBBFF',
    headerFrom: '#1B44BC',
    headerTo: '#0C1729',
  },
  teal: {
    dot: '#0E8C8C',
    tint: '#E3F4F4',
    ink: '#0E8C8C',
    inkDeep: '#0B6E6E',
    sub: '#6BA5A5',
    dotDark: '#3FC9C9',
    inkDark: '#8FE0E0',
    headerFrom: '#0A6B6B',
    headerTo: '#0C1729',
  },
  violet: {
    dot: '#5B45C9',
    tint: '#EDEAFB',
    ink: '#5B45C9',
    inkDeep: '#4A37A6',
    sub: '#8E7FD6',
    dotDark: '#8B78F0',
    inkDark: '#BFB4F7',
    headerFrom: '#3F2E93',
    headerTo: '#0C1729',
  },
  amber: {
    dot: '#C39B4E',
    tint: '#FBEFDC',
    ink: '#A8730B',
    inkDeep: '#7A4E10',
    sub: '#C39B4E',
    dotDark: '#F0B454',
    inkDark: '#F5D49A',
    headerFrom: '#7A5410',
    headerTo: '#0C1729',
  },
  rose: {
    dot: '#E5484D',
    tint: '#FDEBEC',
    ink: '#C13136',
    inkDeep: '#9B2429',
    sub: '#D28A8D',
    dotDark: '#FF7A7F',
    inkDark: '#FFB3B6',
    headerFrom: '#93242A',
    headerTo: '#0C1729',
  },
  emerald: {
    dot: '#0E9F6E',
    tint: '#E6F6EF',
    ink: '#0B7C55',
    inkDeep: '#085F42',
    sub: '#6FAE93',
    dotDark: '#3FD292',
    inkDark: '#8FE8C4',
    headerFrom: '#0A6444',
    headerTo: '#0C1729',
  },
  indigo: {
    dot: '#4634C4',
    tint: '#EAE8FA',
    ink: '#3B2BA6',
    inkDeep: '#2C1F7D',
    sub: '#8579D2',
    dotDark: '#8C7BFF',
    inkDark: '#BDB4FF',
    headerFrom: '#2E2183',
    headerTo: '#0C1729',
  },
  orange: {
    dot: '#E2662A',
    tint: '#FDEEE4',
    ink: '#C1541F',
    inkDeep: '#94400F',
    sub: '#D2967A',
    dotDark: '#FF9152',
    inkDark: '#FFC4A0',
    headerFrom: '#97430F',
    headerTo: '#0C1729',
  },
  cyan: {
    dot: '#0891B2',
    tint: '#E2F4F9',
    ink: '#0E7490',
    inkDeep: '#0A5A70',
    sub: '#6BAAC0',
    dotDark: '#38C7E8',
    inkDark: '#94E0F3',
    headerFrom: '#0A5A70',
    headerTo: '#0C1729',
  },
  pink: {
    dot: '#D63384',
    tint: '#FCE9F2',
    ink: '#B02A6C',
    inkDeep: '#8A2054',
    sub: '#D08AAF',
    dotDark: '#F472B6',
    inkDark: '#FAB4D8',
    headerFrom: '#8A2054',
    headerTo: '#0C1729',
  },
  lime: {
    dot: '#6A9E1F',
    tint: '#F0F7E2',
    ink: '#55801A',
    inkDeep: '#3F6112',
    sub: '#A0BC79',
    dotDark: '#A3D34A',
    inkDark: '#CDE894',
    headerFrom: '#41630F',
    headerTo: '#0C1729',
  },
  slate: {
    dot: '#5A6B85',
    tint: '#EDF1F7',
    ink: '#47566E',
    inkDeep: '#333F54',
    sub: '#93A2B8',
    dotDark: '#8FA0B8',
    inkDark: '#BECBDC',
    headerFrom: '#37445C',
    headerTo: '#0C1729',
  },
};

const darkAccents: AccentSet = {
  blue: {
    dot: '#2F63F0',
    tint: '#1B2742',
    ink: '#7FA2FF',
    inkDeep: '#7FA2FF',
    sub: '#8FA9DE',
    dotDark: '#6E9BFF',
    inkDark: '#A9C4FF',
    headerFrom: '#224CC9',
    headerTo: '#0B1220',
  },
  teal: {
    dot: '#4CD0D0',
    tint: '#0F2C2E',
    ink: '#4CD0D0',
    inkDeep: '#4CD0D0',
    sub: '#63B4B4',
    dotDark: '#5FD9D9',
    inkDark: '#8FE0E0',
    headerFrom: '#0E6E70',
    headerTo: '#0B1220',
  },
  violet: {
    dot: '#A493FF',
    tint: '#221E3A',
    ink: '#A493FF',
    inkDeep: '#A493FF',
    sub: '#9F91EB',
    dotDark: '#B4A6FF',
    inkDark: '#C9BEFF',
    headerFrom: '#4633A8',
    headerTo: '#0B1220',
  },
  amber: {
    dot: '#E5AB3F',
    tint: '#2C2415',
    ink: '#E5AB3F',
    inkDeep: '#E8963A',
    sub: '#C9A462',
    dotDark: '#F0B454',
    inkDark: '#F5D49A',
    headerFrom: '#8A6114',
    headerTo: '#0B1220',
  },
  rose: {
    dot: '#FF7A7F',
    tint: '#2C1A1C',
    ink: '#F1666B',
    inkDeep: '#F1666B',
    sub: '#C08F94',
    dotDark: '#FF9296',
    inkDark: '#FFB3B6',
    headerFrom: '#8E2F33',
    headerTo: '#0B1220',
  },
  emerald: {
    dot: '#3FD292',
    tint: '#12291F',
    ink: '#38C98A',
    inkDeep: '#38C98A',
    sub: '#6FAB94',
    dotDark: '#5CDDA5',
    inkDark: '#8FE8C4',
    headerFrom: '#12634A',
    headerTo: '#0B1220',
  },
  indigo: {
    dot: '#8C7BFF',
    tint: '#1E1B38',
    ink: '#A79AFF',
    inkDeep: '#A79AFF',
    sub: '#9186D6',
    dotDark: '#A294FF',
    inkDark: '#BDB4FF',
    headerFrom: '#362A8E',
    headerTo: '#0B1220',
  },
  orange: {
    dot: '#FF9152',
    tint: '#2E1E12',
    ink: '#FFA470',
    inkDeep: '#FFA470',
    sub: '#C4906B',
    dotDark: '#FFA470',
    inkDark: '#FFC4A0',
    headerFrom: '#8A4415',
    headerTo: '#0B1220',
  },
  cyan: {
    dot: '#38C7E8',
    tint: '#0D2830',
    ink: '#4FD3F0',
    inkDeep: '#4FD3F0',
    sub: '#6FA9BA',
    dotDark: '#63D8F2',
    inkDark: '#94E0F3',
    headerFrom: '#0E5C74',
    headerTo: '#0B1220',
  },
  pink: {
    dot: '#F472B6',
    tint: '#2E1626',
    ink: '#F58BC4',
    inkDeep: '#F58BC4',
    sub: '#C289A8',
    dotDark: '#F78FC6',
    inkDark: '#FAB4D8',
    headerFrom: '#8C2A61',
    headerTo: '#0B1220',
  },
  lime: {
    dot: '#A3D34A',
    tint: '#1F2913',
    ink: '#B0DC5F',
    inkDeep: '#B0DC5F',
    sub: '#96AC72',
    dotDark: '#B8E070',
    inkDark: '#CDE894',
    headerFrom: '#4E6E18',
    headerTo: '#0B1220',
  },
  slate: {
    dot: '#8FA0B8',
    tint: '#212934',
    ink: '#A9B8CC',
    inkDeep: '#A9B8CC',
    sub: '#7A899F',
    dotDark: '#A2B1C6',
    inkDark: '#BECBDC',
    headerFrom: '#414F66',
    headerTo: '#0B1220',
  },
};

export type AccentName = keyof AccentSet;
export const accentNames = Object.keys(lightAccents) as AccentName[];

/* ------------------------------------------------------------------ *
 * Attendance status — drives the tap-to-cycle grid.
 * ------------------------------------------------------------------ */

type StatusStyle = {
  dot: string;
  tint: string;
  tintPressed: string;
  ink: string;
  sub: string;
  border: string;
  /** Dot in the header count pills, a touch deeper than the grid dot. */
  countDot: string;
  glow: string;
};
type StatusSet = Record<'present' | 'late' | 'absent', StatusStyle>;

const lightStatus: StatusSet = {
  present: {
    dot: '#0E9F6E',
    tint: '#EAF6F1',
    tintPressed: '#D5EDE3',
    ink: '#0B7C55',
    sub: '#5E8A78',
    border: '#B7E3D0',
    countDot: '#0E9F6E',
    glow: '0 4px 12px rgba(14,159,110,0.13)',
  },
  late: {
    dot: '#E09A19',
    tint: '#FBEFDC',
    tintPressed: '#F5E2BE',
    ink: '#A8730B',
    sub: '#96814F',
    border: '#F2D9A8',
    countDot: '#E09A19',
    glow: '0 4px 12px rgba(224,154,25,0.15)',
  },
  absent: {
    dot: '#E5484D',
    tint: '#FCEBEC',
    tintPressed: '#F8D8DA',
    ink: '#C13136',
    sub: '#A0757A',
    border: '#F4C4C6',
    countDot: '#E5484D',
    glow: '0 4px 12px rgba(229,72,77,0.13)',
  },
};

const darkStatus: StatusSet = {
  present: {
    dot: '#3FD292',
    tint: '#12291F',
    tintPressed: '#1B3A2E',
    ink: '#38C98A',
    sub: '#6FAB94',
    border: '#245244',
    countDot: '#12A574',
    glow: '0 4px 12px rgba(63,210,146,0.16)',
  },
  late: {
    dot: '#E9AC3D',
    tint: '#2C2415',
    tintPressed: '#3A2F1B',
    ink: '#E5AB3F',
    sub: '#B29C64',
    border: '#453718',
    countDot: '#D89320',
    glow: '0 4px 12px rgba(233,172,61,0.16)',
  },
  absent: {
    dot: '#FF7A7F',
    tint: '#2C1A1C',
    tintPressed: '#3A2326',
    ink: '#F1666B',
    sub: '#C08F94',
    border: '#4A2B2E',
    countDot: '#DE5257',
    glow: '0 4px 12px rgba(255,122,127,0.15)',
  },
};

export type AttendanceStatus = keyof StatusSet;
export const statusCycle: AttendanceStatus[] = ['present', 'late', 'absent'];

/** Glyph and label per status — the same in both themes. */
export const statusMeta: Record<AttendanceStatus, { mark: string; label: string }> = {
  present: { mark: '✓', label: 'Present' },
  late: { mark: '!', label: 'Late' },
  absent: { mark: '×', label: 'Absent' },
};

/* ------------------------------------------------------------------ *
 * Shadows, as `boxShadow` — the cross-platform form React Native 0.86
 * wants. The legacy `shadow*` / `elevation` props warn at runtime.
 * Dark needs far more opacity to register at all.
 * ------------------------------------------------------------------ */

type ShadowSet = {
  card: { boxShadow: string };
  raised: { boxShadow: string };
  fab: { boxShadow: string };
  segment: { boxShadow: string };
};

const lightShadow: ShadowSet = {
  card: { boxShadow: '0 6px 18px rgba(12,23,41,0.06)' },
  raised: { boxShadow: '0 10px 30px rgba(12,23,41,0.09)' },
  fab: { boxShadow: '0 10px 24px rgba(36,87,232,0.4)' },
  segment: { boxShadow: '0 2px 6px rgba(12,23,41,0.09)' },
};

const darkShadow: ShadowSet = {
  card: { boxShadow: '0 6px 18px rgba(0,0,0,0.42)' },
  raised: { boxShadow: '0 10px 30px rgba(0,0,0,0.5)' },
  fab: { boxShadow: '0 10px 24px rgba(16,38,110,0.6)' },
  segment: { boxShadow: '0 2px 6px rgba(0,0,0,0.45)' },
};

/* ------------------------------------------------------------------ *
 * Assembled themes.
 * ------------------------------------------------------------------ */

export type Scheme = 'light' | 'dark';

export type Theme = {
  scheme: Scheme;
  color: Palette;
  accents: AccentSet;
  status: StatusSet;
  shadow: ShadowSet;
};

export const themes: Record<Scheme, Theme> = {
  light: {
    scheme: 'light',
    color: light,
    accents: lightAccents,
    status: lightStatus,
    shadow: lightShadow,
  },
  dark: {
    scheme: 'dark',
    color: dark,
    accents: darkAccents,
    status: darkStatus,
    shadow: darkShadow,
  },
};
