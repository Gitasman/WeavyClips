# Weavy Clips visual language

Use this guide to build companion Weavy extensions with the same appearance. It describes the implemented design; `factory.js`, `appearance.js`, `appearance.css` and `options.css` are the source of truth.

## Character

A compact, neutral utility UI: quiet dark surfaces, restrained outlines, clear labels and short purposeful motion. Color identifies the primary action, selection and errors. Avoid decorative gradients, large branding, oversized cards and permanent payload previews.

Use the system UI font, without downloads. Settings text is 13 px; labels and buttons are 12 px; supporting text is 11 px. Section headings are 18 px with a medium weight. Controls are 34 px high. Use a 4 px spacing base, 8–12 px gaps and 12–20 px panel padding. Outer panels have 12 px corners; controls generally have 7 px corners.

## Two independent themes

The **dock theme** controls its background, accent, geometry and effects. The **settings-page theme** controls page background, panel surfaces, control accent and dot pattern. Changing the page theme must not change the dock. Appearance presets intentionally include both themes; clip data, position and paste methods are excluded.

| Factory value | Setting |
| --- | --- |
| Dock background / accent | `#1e1e1e` / `#ffffff` |
| Dock radius / button size | 11 px / 36 px |
| Dock background opacity / blur | 0% / 5 px |
| Shadow strength / softness | 41 of 48 (85%) / 18 px |
| Shadow direction / distance | 90° / 3.25 px |
| Outline width / color / opacity | 1 px / `#ffffff` / 6% |
| Page / panel / accent | `#1e1e1e` / `#2b2b2b` / `#ffffff` |
| Dot pattern | 16 px spacing, 11% contrast |

Choose light or dark foreground from the background’s luminance. Derive muted text and outlines from that foreground instead of embedding blue-gray colors. Inputs, menus, disabled states and overlays use the same semantic tokens. Native browser controls remain subject to Chrome and OS rendering.

## Dock and icon geometry

Use one shared component style in the real dock and live preview. Buttons are equal squares: 30, 36 or 42 px. Center the icon area with flex alignment and reset inherited margin, padding, text indent and letter spacing.

Keep the Save icon as a colored **💾** emoji. The Settings gear and clip emoji use an explicit 18 px emoji font in a 20 px line box. `centerGlyphs()` calculates a vertical correction from the painted glyph and font bounds, with a small cache and a native fallback. Do not add a second fixed vertical nudge. Library uses an 18 px SVG with symmetric strokes in a 24 × 24 view box.

## Appearance behavior

Apply settings through shared CSS variables. Background opacity affects only the dock surface; it never fades the buttons or text. Blur filters content behind that surface, so an opaque surface conceals it. Shadow strength controls alpha, softness controls blur, and direction/distance control the offset. Zero strength produces `box-shadow: none`; zero outline width removes the border. Save is the primary accent action; Minimal and Strong accent modes use the same theme values.

Live preview uses the actual page background and the same dot phase, resembling a cutout in the panel. Keep popup surfaces opaque so labels remain readable even with a transparent dock. Context menus follow dock background, foreground, accent, radius, outline and shadow. Layer menus and tooltips above the dock and Library, with dialogs above menus.

## Settings layout and interaction

A small name/version and tools sit above a horizontally scrollable tab bar. The entire top bar has an opaque panel background. Show one settings section at a time, highlight its tab and remember the destination. Support Left/Right, Home/End, visible keyboard focus and reduced motion. Backup comes first; Clipboard & Paste is penultimate.

Group related controls, keep helpers close to their controls, and disclose occasional actions such as preset editing or clearing data. On narrow screens, grids become a single column and clip actions move below the title. Lists show icon, name, updated date and actions; payloads remain available in storage and exports.

Use brief 140–160 ms transitions for interaction or panel entry, with no blanket `transition: all`. Respect `prefers-reduced-motion`. Create list rows only for the visible window, defer inactive settings work and preserve active editors during storage updates. Autosave must show progress or failure and preserve retryable edits. Changes to design must preserve existing user settings and clip data.
