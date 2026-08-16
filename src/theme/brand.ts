/**
 * The mark's palette.
 *
 * Deliberately outside the theme tokens: these four do not follow light or dark
 * mode and never take an accent. They are the same four colours in the launcher
 * icon, the opening title card and the `Logo` tile, and the whole point of a
 * mark is that it looks the same everywhere.
 *
 * `scripts/make-icons.py` holds the same values for the PNGs the OS needs.
 * Change a colour here and there together.
 */
export const brand = {
  /** The card's ground, and the tile behind the Cc. */
  ground: '#000000',
  /** CLASS, and the capital C. */
  blue: '#2457E8',
  /** CARE, and the lowercase c. Purer than the app's own `success` green. */
  green: '#00A551',
  /** KERVEN BAYLYEV'S, above the mark on the title card. */
  sage: '#C9D7AE',
} as const;
