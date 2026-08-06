# ClassCare — Held icon assets

Mark: **Held** — three heads over one cradling stroke. Master grid 96 units,
cradle 13-unit stroke, heads 6.5-unit radius, mark shifted +6.5 units on Y so it
sits optically centred in a rounded tile.

## Colour
| Context | Cradle | Heads |
|---|---|---|
| Blue tile (>=60px) | #FFFFFF | #6FE3DE |
| Blue tile (<60px) | #FFFFFF | #FFFFFF |
| Light surface | #2457E8 | #0E8C8C |
| Dark theme | #7FA2FF | #7FA2FF |
| One colour | #0C1729 or #FFFFFF | same |

Tile gradient: linear-gradient(150deg, #2457E8, #123AAE).

## Folders
- **ios/** — square, no alpha, no rounding (iOS masks it). AppIcon-1024 is the
  App Store asset. apple-touch-icon-180 is pre-rounded for web use.
- **android/** — adaptive layers at 432px (108dp @4x): background, foreground,
  monochrome for Material You. Foreground art stays inside the 264px safe
  circle. legacy-* are pre-masked squircles for old launchers.
- **web/** — PWA and favicon sizes, pre-rounded at 22.4%. maskable-512 has extra
  padding so any mask can crop it.
- **mark/** — transparent mark on its own, for decks and documents.
- **svg/** — vector masters. Edit these, not the PNGs.

## Small-size rule
At 44px and below, swap to `held-mark-small.svg`: cradle thickens to 15.5 units,
heads grow to 7.5-unit radius, colour drops to one. The PNGs in this pack already
apply the rule.

## Clear space
One head diameter (13 units, 14% of mark width) on all four sides.
Minimum size 16px on screen, 6mm in print, measured across the cradle.
