# Weavy Clips

**English** · [Русский](README-RU.md)

**v2.3.0 · Chrome 116+ · app.weavy.ai**

Save clipboard content and reusable Weavy clips, then paste them from a compact floating dock.

- Search your library with **Alt+K**, pin favorites, organize groups and keep clip history.
- Customize the dock and settings page with independent colors, radii, opacity, blur, shadows and outlines.
- Use built-in or personal appearance presets and export your library as JSON.
- Open settings in Chrome’s native side panel, next to your canvas.
- Read the bundled **Help** guide in English or Russian, selected from your browser language with a manual override.

## Download and install

1. **[Download the latest source ZIP](https://github.com/Gitasman/WeavyClips/archive/refs/heads/main.zip)** and extract it to a permanent folder.
2. Open `chrome://extensions` in Chrome and enable **Developer mode**.
3. Select **Load unpacked** and choose the folder containing `manifest.json` — normally `WeavyClips-main` in the GitHub archive.
4. Open or refresh [app.weavy.ai](https://app.weavy.ai/). Click the extension icon or the dock’s ⚙️ button to open settings.

Keep the extracted folder after installation. **No Node.js, npm or build step is needed to use the extension.** This is a source installation, not a Chrome Web Store listing.

## Update without losing your clips

1. In the existing extension, choose **Backup → Export JSON**.
2. Download the new ZIP and extract it separately.
3. Copy its files into **the same folder Chrome already uses**, replacing the previous files. Include the new `clips.js` and `help.*` files.
4. Click **Reload** for Weavy Clips in `chrome://extensions`, refresh **all** open Weavy tabs and reopen settings.

Do not remove the extension or load a different folder: a different path can create a different extension ID and separate local storage. GitHub installations do not update automatically.

## What changed in 2.3.0

- **Safer editing across tabs.** Clip changes go through a serialized service-worker queue. Additions and independent field edits are merged; a stale edit does not resurrect a deleted clip. Simultaneous edits to the same field use the last processed value.
- **Smaller messages.** Renaming or pinning sends the changed fields rather than every image and history entry. The existing local storage format is retained; the stored library is still read and written as a whole.
- **Less UI rebuilding.** Usage updates preserve dock buttons; background refreshes preserve the active editor. Arrow-key navigation in quick search updates selection without rebuilding the result list.
- **Better search.** A shared cached index handles multiple words and diacritics. It covers names, groups, types and the first 2,000 characters of text/JSON content, and excludes image payloads.
- **Library filters.** Switch between All, Pinned, Images, Text and JSON, with a matching/total count.
- **Recovery.** Failed clip writes remain pending while the page stays open, with a Retry action. Deferred edits are handed to the worker on page exit. Deleting a clip in Clips Manager now offers Undo.
- **Validated imports.** Reject unsupported backup versions, duplicate/unsafe IDs, invalid clip types and malformed history before adding clips. Import files are limited to 64 MB and 50,000 clips; imported settings are limited to known keys.
- **English-first documentation**, with a Russian translation and a browser-aware offline help guide.

See [CHANGELOG.md](CHANGELOG.md) for the release history.

## Everyday use

Select content on the Weavy canvas, then click **💾** to capture a clip. Depending on **Clipboard & Paste**, saving first attempts to copy the selection or reads the existing clipboard. Click a pinned clip to use the selected paste method.

- **Alt+K:** open quick search. ↑ / ↓ select, Enter uses the clip, Escape closes. In settings, choosing a result copies it; on Weavy, it uses your selected paste method.
- **Clips Manager:** filter, search, click a name to rename, change its icon or group, pin, lock, update from the clipboard, inspect history or delete. Enter commits a rename; Escape cancels it.
- **Drag:** reorder clips, or move the dock by its handle and empty space around its buttons.
- **History:** updating a clip stores the previous content. Restore a version to bring it back. Locked clips cannot be updated, restored or individually deleted until unlocked.
- **Help:** open the guide from the top bar. Automatic language follows the first supported English/Russian browser preference; other languages fall back to English. You can override it in the guide. The settings interface remains English.

This GitHub README is English with a manual Russian link. Automatic language selection is implemented in the extension’s Help page.

## Appearance

**Appearance** controls the dock. **Settings Page** controls the settings background, section/menu surfaces and dot pattern. Live preview shares the settings-page background and dot alignment.

| Default | Value |
| --- | --- |
| Dock accent / background | `#ffffff` / `#1e1e1e` |
| Corner radius / button size | 11 px / 36 px |
| Opacity / backdrop blur | 100% / 7 px |
| Shadow strength / softness | 27% / 13 px |
| Shadow direction / distance | 90° / 3.25 px |
| Outline width / color / opacity | 1 px / `#ffffff` / 14% |
| Settings background / sections / accent | `#1e1e1e` / `#2b2b2b` / `#ffffff` |
| Background dots | enabled, 16 px spacing, 11% contrast |

Blur is visible only through a partly transparent background. At 100% opacity the background hides it. Shadow strength changes opacity; softness changes blur; direction and distance control the offset. Directions: 0° right, 90° down, 180° left, 270° up. Zero strength removes the shadow; zero outline width removes the border.

**Default, Glass, Solid and Compact** presets include both dock and settings-page appearance. Choose a preset to apply it. **Apply** reapplies it after manual edits. **Save new**, **Update** and **Delete** manage personal presets; built-in presets are protected. Resets affect appearance only. Existing saved preferences are preserved through updates.

The top header/navigation has an opaque sticky background. Sections can be collapsed. Optional dock auto-hide and Alt+1…9 quick paste are disabled by default. Animations respect reduced-motion preferences. Lists render a bounded window; image preview sources are assigned near the viewport. The complete stored library is still loaded into memory.

## Backup, data and permissions

**Export JSON** includes your clips, versions, settings and custom presets. **Import JSON** adds clips with new IDs, skips IDs already present and imports supported settings/presets. Keep backups private: they contain your actual clip data.

Clips and settings live in `chrome.storage.local` in the current browser profile. GitHub does not store or synchronize your personal clips. A failed write can only remain pending while its page is open; Retry and verify the result before closing it.

| Permission | Purpose |
| --- | --- |
| `app.weavy.ai` host access | Dock, clip capture and paste on Weavy pages |
| `clipboardRead`, `clipboardWrite` | Clipboard capture and paste |
| `storage`, `unlimitedStorage` | Local library, including image clips |
| `tabs` | Find and message open Weavy tabs |
| `debugger` | Simulated system copy/paste for the corresponding Clipboard & Paste methods |
| `sidePanel` | Native settings side panel |

## Share, report and contribute

Share [this repository](https://github.com/Gitasman/WeavyClips) or the download link above. Recipients can follow the installation steps without developer tools beyond Chrome’s Load unpacked.

- **Code / main:** current source.
- **Commits:** the saved change history.
- **Issues:** bug reports and ideas. Include the extension version, reproduction steps, expected/actual behavior and sanitized diagnostics.
- **Pull requests:** proposed changes for review before merging.

Do not attach private clips or backups to public issues. To publish a new version, update `manifest.json` and `package.json` together, update the lockfile/release notes, run the tests and check the affected flow in Chrome.

## Development and checks

Plain JavaScript, HTML and CSS; no runtime dependencies or compilation. Node.js 22+ is recommended for development.

```sh
npm ci --ignore-scripts
npm test
```

Or run the original logic checks without installing dependencies:

```sh
node tests/regression.cjs
```

The tests execute the real extension code with mocked Chrome transport and a LinkeDOM document. They cover appearance, presets, virtual lists, filters, editing, concurrent clip writes, retry behavior, import validation, search and help language selection. They do not establish real Chrome/Weavy clipboard compatibility or pixel-level layout correctness.

| Source | Responsibility |
| --- | --- |
| `manifest.json` | Chrome entry points, version and permissions |
| `background.js` | Service worker, serialized writes, native copy/paste shortcuts |
| `clips.js` | Shared clip diffs, validation and retryable client writes |
| `content.js`, `content.css` | Dock and library on the Weavy page |
| `options.*` | Settings and Clips Manager |
| `appearance.js`, `appearance.css` | Shared appearance model and preview tokens |
| `ui.js`, `ui.css` | Virtual lists, cached search and command palette |
| `help.*` | Offline English/Russian guide |
| `tests/` | Logic, DOM, storage and help/search regression tests |

Do not commit secrets, exported backups, `node_modules` or generated archives. There is no automatic release or update pipeline in this repository.
