import type { TextStyle } from 'react-native';

import { color } from './tokens';

/**
 * React Native cannot synthesise weights for custom fonts — each weight is a
 * separate family. These maps turn a CSS-ish weight into the right family name.
 */
export const display = {
  500: 'SpaceGrotesk_500Medium',
  600: 'SpaceGrotesk_600SemiBold',
  700: 'SpaceGrotesk_700Bold',
} as const;

export const body = {
  400: 'PlusJakartaSans_400Regular',
  500: 'PlusJakartaSans_500Medium',
  600: 'PlusJakartaSans_600SemiBold',
  700: 'PlusJakartaSans_700Bold',
} as const;

/**
 * The design uses `letter-spacing` in `em`. RN wants absolute points, so this
 * converts at a given size — keeps the numbers in screens readable as the
 * original `-.03em` etc.
 */
export const tracking = (fontSize: number, em: number) =>
  Math.round(fontSize * em * 100) / 100;

const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Named text styles. Screens compose these and override colour/size locally
 * where the design deviates.
 */
export const text = {
  /** 38/600 Space Grotesk — sign-in hero. */
  hero: {
    fontFamily: display[600],
    fontSize: 38,
    lineHeight: 42.5,
    letterSpacing: tracking(38, -0.03),
  } as TextStyle,

  /** 30/600 — group detail title. */
  screenTitle: {
    fontFamily: display[600],
    fontSize: 30,
    letterSpacing: tracking(30, -0.03),
  } as TextStyle,

  /** 28/700 — home greeting. */
  greeting: {
    fontFamily: display[700],
    fontSize: 28,
    lineHeight: 32.2,
    letterSpacing: tracking(28, -0.03),
  } as TextStyle,

  /** 24/600 — calendar + messages headers, student name. */
  pageTitle: {
    fontFamily: display[600],
    fontSize: 24,
    letterSpacing: tracking(24, -0.025),
  } as TextStyle,

  /** 23/600 — "up next" group name on the home hero card. */
  heroCardTitle: {
    fontFamily: display[600],
    fontSize: 23,
    letterSpacing: tracking(23, -0.02),
  } as TextStyle,

  /** 22/600 — stat tile numeral. */
  stat: {
    fontFamily: display[600],
    fontSize: 22,
    letterSpacing: tracking(22, -0.02),
    ...tabular,
  } as TextStyle,

  /** 29/600 tabular — the big clock on the home hero card. */
  clock: {
    fontFamily: display[600],
    fontSize: 29,
    lineHeight: 29,
    letterSpacing: tracking(29, -0.03),
    ...tabular,
  } as TextStyle,

  /** 19/600 — sheet heading ("Get started"). */
  sheetTitle: {
    fontFamily: display[600],
    fontSize: 19,
    letterSpacing: tracking(19, -0.02),
  } as TextStyle,

  /** 17/600 — section heading ("Your groups", "Students"). */
  section: {
    fontFamily: display[600],
    fontSize: 17,
    letterSpacing: tracking(17, -0.02),
  } as TextStyle,

  /** 11.5/700 uppercase — small caps label above a group of fields. */
  overline: {
    fontFamily: body[700],
    fontSize: 11.5,
    letterSpacing: tracking(11.5, 0.12),
    textTransform: 'uppercase',
    color: color.mutedLight,
  } as TextStyle,

  /** 16/700 — list row primary (group name). */
  rowTitle: {
    fontFamily: body[700],
    fontSize: 16,
    letterSpacing: tracking(16, -0.015),
  } as TextStyle,

  /** 15/700 — list row primary (student name). */
  rowTitleSm: {
    fontFamily: body[700],
    fontSize: 15,
    letterSpacing: tracking(15, -0.01),
  } as TextStyle,

  /** 15.5/700 — nav bar title. */
  navTitle: {
    fontFamily: body[700],
    fontSize: 15.5,
    letterSpacing: tracking(15.5, -0.01),
  } as TextStyle,

  /** 14.5/600 — primary button label. */
  button: {
    fontFamily: body[700],
    fontSize: 14.5,
  } as TextStyle,

  /** 15/400 — body copy. */
  body: {
    fontFamily: body[400],
    fontSize: 15,
    lineHeight: 23.25,
  } as TextStyle,

  /** 14.5/400 — message body / note copy. */
  bodySm: {
    fontFamily: body[400],
    fontSize: 14.5,
    lineHeight: 22.5,
  } as TextStyle,

  /** 12.5/400 — row subtitle. */
  meta: {
    fontFamily: body[400],
    fontSize: 12.5,
    color: color.muted,
  } as TextStyle,

  /** 12.5/600 — emphasised meta. */
  metaStrong: {
    fontFamily: body[600],
    fontSize: 12.5,
  } as TextStyle,

  /** 11/700 uppercase — pill / badge. */
  badge: {
    fontFamily: body[700],
    fontSize: 11,
    letterSpacing: tracking(11, 0.06),
    textTransform: 'uppercase',
  } as TextStyle,

  /** Tabular-figure modifier — spread onto any style holding digits. */
  tabular,
} as const;
