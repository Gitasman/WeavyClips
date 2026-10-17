# Changelog

## 2.4.1 — 2026-10-17

- Restore popup/tooltip stacking above the dock and Library.
- Replace the combined Library backup popover with direct Import and Export buttons.
- Compact Library and Clips Manager rows to icon, name, updated date and actions; remove list payload previews and type badges.
- Make group editing an on-demand action and reduce settings/control/navigation spacing.
- Align virtual row sizes with compact responsive layouts, skip empty image observers and cache date formatting.
- Test direct backup actions, group editing, invalid dates and popup layer ordering.

## 2.4.0 — 2026-10-17

- Apply the current factory appearance and centralize shared default settings.
- Seed optional bundled starter clips once on fresh installation while preserving existing libraries.
- Default settings to a full browser tab with an explicit native-side-panel preference.
- Move Backup first and add a Library header import/export popover.
- Share validated, serialized backup import/export between settings and Library.
- Reduce clip tooltips to the name and updated date, and keep them inside the viewport.
- Theme context menus with dock tokens, remove Lock/Pin from that menu and add keyboard navigation.
- Preserve Lock and Pin controls in Library and Clips Manager.
- Fix Escape/blur cancellation when renaming from the context menu.

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
