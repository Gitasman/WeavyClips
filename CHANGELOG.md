# Changelog

## 2.3.0 — 2026-10-17

- Serialize clip writes in the service worker and merge additions/field edits across extension pages and Weavy tabs.
- Retain failed clip edits for retry while the originating page remains open; flush deferred writes on page exit.
- Send clip diffs rather than complete libraries through runtime messages; preserve the existing storage format.
- Preserve dock DOM on usage-only updates and keep active editors during list refreshes.
- Add cached, multiword, accent-insensitive search and library type/pinned filters with counts.
- Avoid rebuilding quick-search results for arrow-key selection; expose active options to assistive technology.
- Fix Escape/blur rename behavior and add Undo to Clips Manager deletion.
- Validate backup versions, clip IDs, content types and version history before import; limit imported settings to known keys.
- Make the main README English, retain a linked Russian guide and bundle browser-aware EN/RU offline help.
- Add storage concurrency/retry, import validation, search, editing and localization regression coverage.

## 2.2.1

- Keep settings header and navigation together on an opaque sticky surface.
- Measure the top bar when scrolling to settings sections.

## 2.2.0

- Add shared dock appearance, independent settings-page colors, presets, native side-panel settings, virtual lists and lazy image previews.
