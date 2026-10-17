console.log('[WeavyClips] Content script loaded');

const DEFAULT_SETTINGS = WeavyDefaults.settings;

function normalizeSettings(rawSettings = {}) {
  const settings = WeavyAppearance.normalize(Object.assign({}, DEFAULT_SETTINGS, rawSettings || {}));
  const oldSchema = Number(rawSettings?.settingsSchemaVersion || 0);
  let changed = false;

  // The old floating reset button no longer exists.
  delete settings.resetIconColor;
  delete settings.resetButtonSide;
  delete settings.resetButtonGap;
  delete settings.resetButtonOffsetX;
  delete settings.resetButtonOffsetY;

  if (oldSchema < 6) {
    if (!('defaultDockHorizontalOffset' in rawSettings) || Number(rawSettings.defaultDockHorizontalOffset) === 200) settings.defaultDockHorizontalOffset = 180;
    if (!('defaultDockVerticalOffset' in rawSettings) || Number(rawSettings.defaultDockVerticalOffset) === 40) settings.defaultDockVerticalOffset = 11;
    if (!('dockLeft' in rawSettings) || rawSettings.dockLeft === 'calc(50% + 200px)') settings.dockLeft = 'calc(50% + 180px)';
    if (!('dockBottom' in rawSettings) || rawSettings.dockBottom === '40px') settings.dockBottom = '11px';
    settings.captureSelectionBeforeSave = rawSettings.captureSelectionBeforeSave !== false;
    settings.captureSelectionMethod = rawSettings.captureSelectionMethod || 'synthetic_ctrlc';
    settings.perProjectPosition = true;
    if (!('clampDock' in rawSettings)) settings.clampDock = true;
    changed = true;
  }

  // v2.0.2 factory default. Migrate only the exact previous factory position
  // so hand-tuned user positions remain untouched.
  if (oldSchema < 7) {
    if ((settings.defaultDockHorizontalAnchor || 'center') === 'center' && Number(settings.defaultDockHorizontalOffset) === 180) {
      settings.defaultDockHorizontalOffset = 140;
      changed = true;
    }
    if (settings.dockLeft === 'calc(50% + 180px)') {
      settings.dockLeft = 'calc(50% + 140px)';
      changed = true;
    }
    settings.settingsSchemaVersion = 7;
    changed = true;
  }
  // v2.0.3: delete confirmations are disabled by default.
  if (oldSchema < 8) {
    settings.showDeleteConfirm = false;
    settings.settingsSchemaVersion = 8;
    changed = true;
  }

  if (changed) chrome.storage.local.set({ settings });
  return settings;
}

let storedPosition = {};
const POSITION_KEYS = ['dockLeft','dockRight','dockTop','dockBottom'];
const state = {
  clips: [],
  settings: { ...DEFAULT_SETTINGS },
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  originLeft: 0,
  originTop: 0,
  currentX: 0,
  currentY: 0,
  rafId: null,
  contextMenu: null,
  libraryModal: null,
  historyModal: null,
  lastPasteAt: 0,
  draggedClipId: null,
  suppressClipClickUntil: 0
};

// Rotating icon sets per clip type
const JSON_ICONS  = ['📦','🔷','⚡','🎯','💠','🔵','🟣','🟡','🔶','🌀','✨','🎬'];
const TEXT_ICONS  = ['📝','💬','📄','🗒️','📋','✍️','💡','🔤'];
const IMAGE_ICONS = ['🖼','📷','🖼️','🎨','📸','🏞️'];

function getRotatingIcon(type, counters) {
  if (type === 'json') {
    const idx = (counters.jsonIdx || 0) % JSON_ICONS.length;
    return { icon: JSON_ICONS[idx], nextIdx: { ...counters, jsonIdx: (counters.jsonIdx || 0) + 1 } };
  }
  if (type === 'image') {
    const idx = (counters.imageIdx || 0) % IMAGE_ICONS.length;
    return { icon: IMAGE_ICONS[idx], nextIdx: { ...counters, imageIdx: (counters.imageIdx || 0) + 1 } };
  }
  // text type (including fallback)
  const idx = (counters.textIdx || 0) % TEXT_ICONS.length;
  return { icon: TEXT_ICONS[idx], nextIdx: { ...counters, textIdx: (counters.textIdx || 0) + 1 } };
}

async function init() {
  await chrome.runtime.sendMessage({action:'initializeDefaults'});
  console.log('[WeavyClips] Initializing...');
  chrome.storage.local.get(['clips', 'clipsRevision', 'settings', 'dockPositions'], (result) => {
    state.clips = result.clips || [];
    clipStore.reset(state.clips,result.clipsRevision);
    state.settings = normalizeSettings(result.settings || {});
    storedPosition = Object.fromEntries(POSITION_KEYS.map(k => [k,state.settings[k]]));
    if (state.settings.perProjectPosition) {
      const pos = (result.dockPositions || {})[getProjectKey()];
      if (pos) {
        state.settings.dockLeft = pos.left || 'auto'; state.settings.dockRight = pos.right || 'auto';
        state.settings.dockTop = pos.top || 'auto'; state.settings.dockBottom = pos.bottom || 'auto';
      }
    }
    if (normalizeClipOrder()) saveClips(true);
    applyStyles();
    renderDock();
  });
}

let dockHideTimer;
function revealDock(){clearTimeout(dockHideTimer);document.getElementById('wc-dock')?.classList.remove('wc-idle');}
function scheduleDockHide(){
  clearTimeout(dockHideTimer);
  if(!state.settings.dockAutoHide)return;
  dockHideTimer=setTimeout(()=>{const dock=document.getElementById('wc-dock');if(!dock||state.isDragging||state.draggedClipId||state.libraryModal||state.contextMenu||dock.matches(':hover,:focus-within'))return;dock.classList.add('wc-idle');},1100);
}

function applyStyles() {
  const root = document.documentElement;
  const dock = document.getElementById('wc-dock');
  [root, dock].filter(Boolean).forEach(target => WeavyAppearance.apply(target, state.settings));
  if (dock) {
    dock.dataset.autoHide=String(!!state.settings.dockAutoHide);
    if(!state.settings.dockAutoHide)revealDock();else scheduleDockHide();
    dock.dataset.accentMode = state.settings.accentMode || 'normal';
    dock.dataset.overflowMode = state.settings.dockOverflowMode || 'unlimited';
    dock.style.maxWidth = state.settings.dockOverflowMode === 'scroll' ? `${Math.max(240, Number(state.settings.dockMaxWidth) || 900)}px` : 'none';
  }
}

function generateClipName() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `Node ${hours}:${minutes}`;
}

function detectContentType(text) {
  if (!text) return 'text';
  try {
    JSON.parse(text);
    return 'json';
  } catch {
    if (text.startsWith('data:image/') || text.includes('base64')) {
      return 'image';
    }
    return 'text';
  }
}

function getClipIcon(type, content) {
  if (type === 'json') return '📦';
  if (type === 'image') return '🖼';
  const text = typeof content === 'string' ? content.trim() : '';
  if (!text) return '�';
  // Return first 1-2 uppercase letters
  const letters = text.slice(0, 2).toUpperCase().trim();
  return letters || '📝';
}

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(',');
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bytes = atob(b64);
  const ab = new ArrayBuffer(bytes.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i);
  return new Blob([ab], { type: mime });
}

function getClipPreview(content) {
  if (!content) return '';
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  return str.slice(0, 100).replace(/\n/g, ' ');
}

function formatDate(timestamp){return WeavyUI.formatDate(timestamp);}

let clipRenderFrame=0;
function scheduleClipRender(){if(!clipRenderFrame)clipRenderFrame=requestAnimationFrame(()=>{clipRenderFrame=0;renderDock();if(state.libraryModal)refreshLibraryModal()});}
const clipStore=new WeavyClips.Client({get:()=>state.clips,set:clips=>{state.clips=clips;scheduleClipRender()},status:status=>{
  if(status==='error')showUndoToast('Clip save failed',()=>clipStore.flush(),'Retry');
}});
function saveClips(immediate=false){return clipStore.save(immediate);}
window.addEventListener('pagehide',()=>clipStore.flush());

function saveSettings() {
  // Position writes must not overwrite concurrent appearance edits.
  const patch = Object.fromEntries(['dockLeft','dockRight','dockTop','dockBottom'].map(k => [k,state.settings[k]]));
  chrome.runtime.sendMessage({action:'patchSettings',patch}).catch(error => console.error('[WeavyClips]',error));
}

function getClipSortValue(clip) {
  return Number.isFinite(clip?.sortOrder) ? clip.sortOrder : Number.MAX_SAFE_INTEGER;
}

function getOrderedClips(clips = state.clips) {
  return [...clips].sort((a, b) => {
    const orderDiff = getClipSortValue(a) - getClipSortValue(b);
    if (orderDiff !== 0) return orderDiff;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

function normalizeClipOrder() {
  const ordered = getOrderedClips();
  let changed = false;
  ordered.forEach((clip, index) => {
    if (clip.sortOrder !== index) { clip.sortOrder = index; changed = true; }
    if (!Array.isArray(clip.versions)) { clip.versions = []; changed = true; }
    if (clip.locked == null) { clip.locked = false; changed = true; }
    if (clip.group == null) { clip.group = ''; changed = true; }
    if ('pasteMethodOverride' in clip) { delete clip.pasteMethodOverride; changed = true; }
  });
  state.clips = ordered;
  return changed;
}

function getNextClipOrder() {
  if (!state.clips.length) return 0;
  return Math.max(...state.clips.map(clip => Number.isFinite(clip.sortOrder) ? clip.sortOrder : -1)) + 1;
}

function clearClipDropHints() {
  document.querySelectorAll('.wc-drop-before, .wc-drop-after').forEach(el => {
    el.classList.remove('wc-drop-before', 'wc-drop-after');
  });
}

function moveClipRelative(draggedId, targetId, placeAfter = false) {
  if (!draggedId || !targetId || draggedId === targetId) return false;

  const ordered = getOrderedClips();
  const sourceIndex = ordered.findIndex(clip => clip.id === draggedId);
  if (sourceIndex < 0) return false;

  const [moved] = ordered.splice(sourceIndex, 1);
  let targetIndex = ordered.findIndex(clip => clip.id === targetId);
  if (targetIndex < 0) return false;
  if (placeAfter) targetIndex += 1;

  ordered.splice(targetIndex, 0, moved);
  ordered.forEach((clip, index) => { clip.sortOrder = index; });
  state.clips = ordered;
  saveClips();
  return true;
}

function onClipReorderDragStart(e) {
  const item = e.currentTarget;
  const clipId = item?.dataset?.clipId;
  if (!clipId) return;

  state.draggedClipId = clipId;
  state.suppressClipClickUntil = Date.now() + 700;
  item.classList.add('wc-dragging');
  hideTooltip();
  hideContextMenu();

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', clipId);
  }
}

function onClipReorderDragOver(e) {
  const item = e.currentTarget;
  const targetId = item?.dataset?.clipId;
  if (!state.draggedClipId || !targetId || targetId === state.draggedClipId) return;

  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  clearClipDropHints();

  const rect = item.getBoundingClientRect();
  const isLibraryItem = item.classList.contains('wc-lib-item');
  const placeAfter = isLibraryItem
    ? e.clientY > rect.top + rect.height / 2
    : e.clientX > rect.left + rect.width / 2;
  if (state.settings.showDragGuides !== false) item.classList.add(placeAfter ? 'wc-drop-after' : 'wc-drop-before');
}

function onClipReorderDrop(e) {
  const item = e.currentTarget;
  const targetId = item?.dataset?.clipId;
  if (!state.draggedClipId || !targetId) return;

  e.preventDefault();
  e.stopPropagation();
  const rect = item.getBoundingClientRect();
  const isLibraryItem = item.classList.contains('wc-lib-item');
  const placeAfter = isLibraryItem
    ? e.clientY > rect.top + rect.height / 2
    : e.clientX > rect.left + rect.width / 2;

  const previousOrder = getOrderedClips().map(clip => clip.id);
  const moved = moveClipRelative(state.draggedClipId, targetId, placeAfter);
  state.draggedClipId = null;
  document.querySelectorAll('.wc-dragging').forEach(el=>el.classList.remove('wc-dragging'));
  state.suppressClipClickUntil = Date.now() + 350;
  clearClipDropHints();

  if (moved) {
    const libraryWasOpen = !!state.libraryModal;
    renderDock();
    if (libraryWasOpen) refreshLibraryModal();
    showUndoToast('↕ Clip order updated', () => {
      const byId = new Map(state.clips.map(clip => [clip.id, clip]));
      previousOrder.forEach((id, index) => { const clip = byId.get(id); if (clip) clip.sortOrder = index; });
      normalizeClipOrder(); saveClips(true); renderDock(); if (state.libraryModal) refreshLibraryModal();
    });
  }
}

function onClipReorderDragEnd(e) {
  e.currentTarget?.classList.remove('wc-dragging');
  state.draggedClipId = null;
  state.suppressClipClickUntil = Date.now() + 250;
  clearClipDropHints();
  state.libraryModal?._virtualList?.draw();
}

function attachClipReorderListeners(items) {
  items.forEach(item => {
    item.draggable = true;
    item.addEventListener('dragstart', onClipReorderDragStart);
    item.addEventListener('dragover', onClipReorderDragOver);
    item.addEventListener('drop', onClipReorderDrop);
    item.addEventListener('dragend', onClipReorderDragEnd);
  });
}

async function readClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
        const imageType = item.types.find(t => t.startsWith('image/'));
        const blob = await item.getType(imageType);
        const base64 = await blobToBase64(blob);
        return { type: 'image', content: base64 };
      }
      if (item.types.includes('text/plain')) {
        const blob = await item.getType('text/plain');
        const text = await blob.text();
        let isJSON = false;
        try { JSON.parse(text); isJSON = true; } catch {}
        return { type: isJSON ? 'json' : 'text', content: text };
      }
    }
  } catch {
    // Fallback to readText
    const text = await navigator.clipboard.readText();
    let isJSON = false;
    try { JSON.parse(text); isJSON = true; } catch {}
    return { type: isJSON ? 'json' : 'text', content: text };
  }
  return null;
}

function requestDebuggerShortcut(action, fallbackError) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || fallbackError));
        return;
      }
      resolve();
    });
  });
}

function requestDebuggerCopy() {
  return requestDebuggerShortcut('forceSystemCopy', 'Ctrl/Cmd+C failed');
}

function requestDebuggerPaste() {
  return requestDebuggerShortcut('forceSystemPaste', 'Ctrl/Cmd+V failed');
}

async function requestDomCopy() {
  // Run synchronously inside the user's click gesture. This triggers the page's
  // copy command without attaching chrome.debugger.
  const supported = typeof document.queryCommandSupported !== 'function' || document.queryCommandSupported('copy');
  if (!supported) throw new Error('DOM copy command is not supported');

  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (error) {
    throw new Error(error?.message || 'DOM copy command failed');
  }

  if (!success) throw new Error('DOM copy command was rejected');
  await new Promise(resolve => setTimeout(resolve, 120));
  return { handled: true };
}

async function requestSyntheticCopy() {
  const isMac = /Mac/i.test(navigator.userAgent || '');
  const active = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : document;
  const eventInit = {
    key: 'c',
    code: 'KeyC',
    keyCode: 67,
    which: 67,
    ctrlKey: !isMac,
    metaKey: isMac,
    bubbles: true,
    cancelable: true,
    composed: true
  };

  const keydownAccepted = active.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  active.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  await new Promise(resolve => setTimeout(resolve, 120));
  return { handled: !keydownAccepted };
}


function simpleHash(value = '') {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function contentSignature(type, content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  return `${type}:${text?.length || 0}:${simpleHash(text || '')}`;
}

async function tryCaptureMethod(method) {
  if (method === 'debugger_ctrlc') { await requestDebuggerCopy(); return { handled: true }; }
  if (method === 'synthetic_ctrlc') return requestSyntheticCopy();
  return requestDomCopy();
}

async function writeClipboardData(data) {
  if (!data) return;
  if (data.type === 'image') {
    const blob = dataUrlToBlob(data.content);
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
  } else {
    await navigator.clipboard.writeText(data.content || '');
  }
}

async function captureClipboardData() {
  if (!state.settings.captureSelectionBeforeSave) return readClipboard();

  const original = await readClipboard().catch(() => null);
  const configured = state.settings.captureSelectionMethod || DEFAULT_SETTINGS.captureSelectionMethod;
  const methods = configured === 'smart'
    ? ['synthetic_ctrlc', 'execcommand_copy', ...(state.settings.smartAllowDebugger ? ['debugger_ctrlc'] : [])]
    : [configured];

  let sentinel = null;
  if (state.settings.verifySelectionCopy && original) {
    sentinel = `__WEAVY_CLIPS_VERIFY_${crypto.randomUUID()}__`;
    try { await navigator.clipboard.writeText(sentinel); } catch { sentinel = null; }
  }

  let lastError = null;
  for (const method of methods) {
    let copyEventSeen = false;
    let nativeTypes = [];
    const onCopy = event => {
      copyEventSeen = true;
      try { nativeTypes = Array.from(event.clipboardData?.types || []); } catch {}
    };
    document.addEventListener('copy', onCopy, true);
    try {
      const signal = await tryCaptureMethod(method);
      await new Promise(resolve => setTimeout(resolve, method === 'debugger_ctrlc' ? 170 : 145));
      const after = await readClipboard();
      if (!after?.content) throw new Error('Clipboard is empty after copy');
      const stillSentinel = sentinel && after.type !== 'image' && after.content === sentinel;
      if (!state.settings.verifySelectionCopy || !sentinel || !stillSentinel) {
        state.lastCaptureStatus = {
          ok: true, method, verified: !!sentinel, copyEventSeen,
          handled: !!signal?.handled, nativeTypes, at: Date.now()
        };
        return after;
      }
      lastError = new Error('Weavy did not replace the clipboard');
    } catch (error) {
      lastError = error;
    } finally {
      document.removeEventListener('copy', onCopy, true);
    }
  }

  if (sentinel && original) {
    try { await writeClipboardData(original); } catch {}
  }
  state.lastCaptureStatus = { ok: false, method: configured, error: lastError?.message || 'Copy failed', at: Date.now() };
  throw lastError || new Error('Selection copy failed');
}

function ensureVersions(clip) {
  if (!Array.isArray(clip.versions)) clip.versions = [];
  return clip.versions;
}

function makeVersionSnapshot(clip) {
  return {
    id: crypto.randomUUID(),
    type: clip.type,
    content: clip.content,
    savedAt: clip.updatedAt || clip.createdAt || Date.now(),
    signature: contentSignature(clip.type, clip.content)
  };
}

function pushVersionSnapshot(clip) {
  const versions = ensureVersions(clip);
  const snap = makeVersionSnapshot(clip);
  const last = versions[versions.length - 1];
  if (!last || (last.signature || contentSignature(last.type, last.content)) !== snap.signature) versions.push(snap);
  const max = Number(state.settings.maxVersions || 25);
  if (max > 0 && versions.length > max) versions.splice(0, versions.length - max);
}

async function updateClipContent(clip) {
  if (clip.locked) throw new Error('Clip is locked');
  const clipboardData = await captureClipboardData();
  if (!clipboardData || !clipboardData.content) throw new Error('Clipboard is empty');
  if (contentSignature(clip.type, clip.content) === contentSignature(clipboardData.type, clipboardData.content)) return false;
  pushVersionSnapshot(clip);
  clip.type = clipboardData.type;
  clip.content = clipboardData.content;
  clip.updatedAt = Date.now();
  saveClips(true);
  renderDock();
  return true;
}

function restoreClipVersion(clip, version) {
  if (!version || clip.locked) return false;
  pushVersionSnapshot(clip);
  clip.type = version.type;
  clip.content = version.content;
  clip.updatedAt = Date.now();
  saveClips(true);
  renderDock();
  return true;
}

async function saveCurrentClipboard() {
  console.log('[WeavyClips] Reading clipboard...');
  try {
    const clipboardData = await captureClipboardData();
    if (!clipboardData || !clipboardData.content) { showToast('⚠️ Clipboard is empty'); return; }

    const type = clipboardData.type;
    const content = clipboardData.content;
    const incomingSig = contentSignature(type, content);
    const duplicate = state.clips.find(c => contentSignature(c.type, c.content) === incomingSig);
    if (duplicate && state.settings.duplicateBehavior !== 'allow') {
      if (state.settings.duplicateBehavior === 'focus_existing') {
        state.librarySearch = '';
        openLibraryModal(duplicate.id);
        showToast(`Already saved: ${duplicate.name}`);
      } else {
        showToast(`⚠️ Already saved: ${duplicate.name}`);
      }
      return;
    }

    const countersRes = await new Promise(resolve => chrome.storage.local.get(['iconCounters'], resolve));
    const counters = countersRes.iconCounters || { jsonIdx: 0, textIdx: 0, imageIdx: 0 };
    const { icon, nextIdx } = getRotatingIcon(type, counters);
    chrome.storage.local.set({ iconCounters: nextIdx });

    const now = Date.now();
    const clip = {
      id: crypto.randomUUID(), name: generateClipName(), type, content, icon,
      pinned: true, locked: false, group: '',
      createdAt: now, updatedAt: now, usageCount: 0, versions: [], sortOrder: getNextClipOrder()
    };

    state.clips.push(clip);
    saveClips(true);
    renderDock();
    showToast(state.settings.captureSelectionBeforeSave ? '💾 Selection saved: ' + clip.name : '💾 Saved: ' + clip.name);
  } catch (err) {
    console.error('[WeavyClips] Failed to save clipboard:', err);
    showToast(state.settings.captureSelectionBeforeSave ? `❌ ${err.message || 'Failed to copy/save selection'}` : '❌ Failed to read clipboard');
  }
}

function numberSetting(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getDefaultDockCss(settings = state.settings) {
  const horizontalAnchor = settings.defaultDockHorizontalAnchor || 'center';
  const verticalAnchor = settings.defaultDockVerticalAnchor || 'bottom';
  const horizontalOffset = numberSetting(settings.defaultDockHorizontalOffset, 140);
  const verticalOffset = numberSetting(settings.defaultDockVerticalOffset, 11);

  const css = { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' };
  if (horizontalAnchor === 'left') css.left = `${horizontalOffset}px`;
  else if (horizontalAnchor === 'right') css.right = `${horizontalOffset}px`;
  else css.left = `calc(50% + ${horizontalOffset}px)`;

  if (verticalAnchor === 'top') css.top = `${verticalOffset}px`;
  else if (verticalAnchor === 'center') css.top = `calc(50% + ${verticalOffset}px)`;
  else css.bottom = `${verticalOffset}px`;

  return css;
}

function resetDockPosition() {
  const css = getDefaultDockCss();
  state.settings.dockLeft = css.left;
  state.settings.dockRight = css.right;
  state.settings.dockTop = css.top;
  state.settings.dockBottom = css.bottom;
  saveSettings();
  positionDock();
  // If per-path positions are enabled, overwrite the stored position for this
  // path as well so the reset survives reloads and tab activation.
  saveProjectDockPosition();
  showToast('↺ Dock moved to configured default');
}

let dockSignature='';
function renderDock() {
  let dock=document.getElementById('wc-dock');
  const pinnedClips=getOrderedClips(state.clips.filter(c=>c.pinned));
  const signature=JSON.stringify(pinnedClips.map(c=>[c.id,c.name,c.icon,c.locked,c.group]));
  if(dock&&signature===dockSignature)return;
  dockSignature=signature;
  const previousPositions=WeavyUI.positions(dock,'.wc-clip-btn');
  if(!dock){dock=document.createElement('div');dock.id='wc-dock';document.body.appendChild(dock);}
  let lastGroup=null;
  const clipHtml=pinnedClips.map(clip=>{
    const group=clip.group||'';let divider='';
    if(lastGroup!==null && group!==lastGroup) divider=`<span class="wc-group-divider" title="${escapeHtml(group||'Ungrouped')}"></span>`;
    lastGroup=group;
    return `${divider}<button class="wc-clip-btn ${clip.locked?'wc-locked':''}" draggable="true" data-clip-id="${escapeHtml(clip.id)}" title="${escapeHtml(clip.name)}${group?` · ${escapeHtml(group)}`:''}"><span class="wc-glyph">${escapeHtml(clip.icon||'📦')}</span></button>`;
  }).join('');
  dock.innerHTML=`<div id="wc-drag-handle">⠿</div><button id="wc-save-btn" data-wc-role="save" title="Save clipboard" aria-label="Save clipboard"><span class="wc-glyph">💾</span></button><button id="wc-settings-btn" title="Settings" aria-label="Settings"><span class="wc-glyph">⚙️</span></button><button id="wc-library-btn" title="Library" aria-label="Library">${WeavyAppearance.icons.library}</button><div id="wc-clips-row">${clipHtml}</div>`;
  applyStyles();WeavyAppearance.centerGlyphs(dock);positionDock();attachDockListeners();
  WeavyUI.animatePositions(dock,previousPositions,'.wc-clip-btn');
}


function clampDockToViewport() {
  if (!state.settings.clampDock) return;
  const dock = document.getElementById('wc-dock');
  if (!dock) return;
  const rect = dock.getBoundingClientRect();
  const margin = 8;
  let left = rect.left, top = rect.top;
  if (rect.right > window.innerWidth - margin) left -= rect.right - (window.innerWidth - margin);
  if (rect.left < margin) left = margin;
  if (rect.bottom > window.innerHeight - margin) top -= rect.bottom - (window.innerHeight - margin);
  if (rect.top < margin) top = margin;
  if (Math.abs(left - rect.left) > .5 || Math.abs(top - rect.top) > .5) {
    dock.style.left = `${Math.round(left)}px`;
    dock.style.right = 'auto';
    dock.style.top = `${Math.round(top)}px`;
    dock.style.bottom = 'auto';
    state.settings.dockLeft = dock.style.left;
    state.settings.dockRight = 'auto';
    state.settings.dockTop = dock.style.top;
    state.settings.dockBottom = 'auto';
  }
}

function getProjectKey() {
  return `${location.origin}${location.pathname.split('/').slice(0, 4).join('/')}`;
}

function saveProjectDockPosition() {
  if (!state.settings.perProjectPosition) return;
  chrome.storage.local.get(['dockPositions'], result => {
    const map = result.dockPositions || {};
    map[getProjectKey()] = {
      left: state.settings.dockLeft, right: state.settings.dockRight,
      top: state.settings.dockTop, bottom: state.settings.dockBottom
    };
    chrome.storage.local.set({ dockPositions: map });
  });
}
function positionDock() {
  const dock = document.getElementById('wc-dock');
  if (!dock) return;
  dock.style.left = state.settings.dockLeft || 'auto';
  dock.style.right = state.settings.dockRight || 'auto';
  dock.style.top = state.settings.dockTop || 'auto';
  dock.style.bottom = state.settings.dockBottom || 'auto';
  dock.style.transform = 'none';
  requestAnimationFrame(() => { clampDockToViewport(); });
}

function attachDockListeners() {
  const dock = document.getElementById('wc-dock');
  const handle = document.getElementById('wc-drag-handle');
  const saveBtn = document.getElementById('wc-save-btn');
  const libraryBtn = document.getElementById('wc-library-btn');
  const settingsBtn = document.getElementById('wc-settings-btn');
  const clipsRow = document.getElementById('wc-clips-row');

  // Empty padding, gaps and the handle all drag; controls retain their own actions.
  dock.onmousedown=e=>{if(e.button!==0||e.target.closest('button,input,select,textarea,a,[data-clip-id]'))return;onDragStart(e)};
  dock.onmouseenter=revealDock;dock.onmouseleave=scheduleDockHide;dock.onfocusin=revealDock;dock.onfocusout=scheduleDockHide;
  scheduleDockHide();

  if (saveBtn) {
    // Preserve Weavy focus so optional Ctrl+C reaches the current editor/canvas.
    saveBtn.addEventListener('mousedown', (e) => e.preventDefault());
    saveBtn.addEventListener('click', () => {
      console.log('[WeavyClips] Save button clicked');
      saveCurrentClipboard();
    });
  }

  if (libraryBtn) {
    libraryBtn.addEventListener('mousedown', (e) => e.preventDefault());
    libraryBtn.addEventListener('click', () => {
      console.log('[WeavyClips] Library button clicked');
      openLibraryModal();
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      console.log('[WeavyClips] Settings button clicked');
      try {
        chrome.runtime.sendMessage({ action: 'openOptions', mode:state.settings.settingsOpenMode }, (response) => {
          if (chrome.runtime.lastError || response?.success === false) {
            console.error('[WeavyClips] Failed to open panel:', chrome.runtime.lastError?.message||response.error);
            showToast('⚠️ Could not open settings. Try the extension icon in Chrome.');
          }
        });
      } catch (err) {
        console.error('[WeavyClips] Extension context invalidated:', err);
        showToast('⚠️ Extension updated. Please refresh the page');
      }
    });
  }

  if (clipsRow) {
    clipsRow.onclick = handleClipClick;
    
    const clipButtons = [...clipsRow.querySelectorAll('.wc-clip-btn')];
    clipButtons.forEach(btn => {
      btn.addEventListener('mouseenter', showTooltip);
      btn.addEventListener('mouseleave', hideTooltip);
      btn.addEventListener('contextmenu', showContextMenu);
    });
    attachClipReorderListeners(clipButtons);
  }
}

function onDragStart(e) {
  if(e.button!==0)return;
  revealDock();
  e.preventDefault();e.stopPropagation();
  console.log('[WeavyClips] Drag started');
  
  state.isDragging = true;
  state.dragStartX = e.clientX;
  state.dragStartY = e.clientY;
  
  const dock = document.getElementById('wc-dock');
  const rect = dock.getBoundingClientRect();
  state.originLeft = rect.left;
  state.originTop = rect.top;
  state.currentX = 0;
  state.currentY = 0;
  
  dock.style.willChange = 'transform';
  
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e) {
  if (!state.isDragging) return;
  e.preventDefault();
  
  state.currentX = e.clientX - state.dragStartX;
  state.currentY = e.clientY - state.dragStartY;
  
  if (!state.rafId) {
    state.rafId = requestAnimationFrame(renderDrag);
  }
}

function renderDrag() {
  state.rafId = null;
  const dock = document.getElementById('wc-dock');
  if (dock) {
    dock.style.transform = `translate3d(${state.currentX}px, ${state.currentY}px, 0)`;
  }
}

function onDragEnd() {
  if (!state.isDragging) return;
  state.isDragging = false;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = null; }
  const dock = document.getElementById('wc-dock');
  const rect = dock.getBoundingClientRect();
  let finalLeft = rect.left;
  let finalTop = rect.top;
  if (state.settings.snapDock) {
    const t = 16;
    const centerLeft = (window.innerWidth - rect.width) / 2;
    const centerTop = (window.innerHeight - rect.height) / 2;
    if (Math.abs(finalLeft - 8) < t) finalLeft = 8;
    else if (Math.abs((finalLeft + rect.width) - (window.innerWidth - 8)) < t) finalLeft = window.innerWidth - rect.width - 8;
    else if (Math.abs(finalLeft - centerLeft) < t) finalLeft = centerLeft;
    if (Math.abs(finalTop - 8) < t) finalTop = 8;
    else if (Math.abs((finalTop + rect.height) - (window.innerHeight - 8)) < t) finalTop = window.innerHeight - rect.height - 8;
    else if (Math.abs(finalTop - centerTop) < t) finalTop = centerTop;
  }
  dock.style.transform = 'none';
  dock.style.left = `${Math.round(finalLeft)}px`; dock.style.right = 'auto';
  dock.style.top = `${Math.round(finalTop)}px`; dock.style.bottom = 'auto';
  dock.style.willChange = 'auto';
  state.settings.dockLeft = dock.style.left; state.settings.dockRight = 'auto';
  state.settings.dockTop = dock.style.top; state.settings.dockBottom = 'auto';
  clampDockToViewport();
  saveSettings();
  saveProjectDockPosition();
  scheduleDockHide();
}

async function handleClipClick(e) {
  if (Date.now() < state.suppressClipClickUntil) return;

  const btn = e.target.closest('[data-clip-id]');
  if (!btn) return;

  const clipId = btn.dataset.clipId;
  const clip = state.clips.find(c => c.id === clipId);
  if (!clip) return;

  const now = Date.now();
  if (now - state.lastPasteAt < 250) {
    console.log('[WeavyClips] Double-click prevented');
    return;
  }
  state.lastPasteAt = now;

  console.log('[WeavyClips] Clip clicked:', clip.name);
  await pasteClip(clip);
}

function showTooltip(e){
  if(state.contextMenu)return;
  const btn=e.target.closest('[data-clip-id]'),clip=state.clips.find(c=>c.id===btn?.dataset.clipId);if(!clip)return;
  let tooltip=document.getElementById('wc-tooltip');
  if(!tooltip){tooltip=document.createElement('div');tooltip.id='wc-tooltip';tooltip.className='wc-tooltip';tooltip.setAttribute('role','tooltip');document.body.appendChild(tooltip);}
  const title=document.createElement('div');title.className='wc-tooltip-name';title.textContent=clip.name;
  const time=document.createElement('time');time.className='wc-tooltip-date';const stamp=Number(clip.updatedAt||clip.createdAt);
  if(stamp>0&&Number.isFinite(new Date(stamp).getTime())){time.textContent=formatDate(stamp);time.setAttribute('datetime',new Date(stamp).toISOString());}else time.textContent='—';
  tooltip.replaceChildren(title,time);btn.setAttribute('aria-describedby','wc-tooltip');
  const r=btn.getBoundingClientRect();tooltip.style.transform='none';tooltip.style.bottom='auto';
  const size=tooltip.getBoundingClientRect(),margin=8;
  tooltip.style.left=Math.max(margin,Math.min(r.left+r.width/2-size.width/2,innerWidth-size.width-margin))+'px';
  const top=r.top>=size.height+margin*2?r.top-size.height-margin:r.bottom+margin;
  tooltip.style.top=Math.max(margin,Math.min(top,innerHeight-size.height-margin))+'px';tooltip.style.opacity='1';
}
function hideTooltip(){
  const tooltip=document.getElementById('wc-tooltip');if(tooltip)tooltip.style.opacity='0';
  document.querySelectorAll('[aria-describedby="wc-tooltip"]').forEach(el=>el.removeAttribute('aria-describedby'));
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function writeClipToClipboard(clip) {
  if (clip.type === 'image') {
    const blob = dataUrlToBlob(clip.content);
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
    return;
  }

  const str = typeof clip.content === 'string' ? clip.content : JSON.stringify(clip.content);
  await navigator.clipboard.writeText(str);
}

function showContextMenu(e){
  e.preventDefault();hideContextMenu();hideTooltip();
  const btn=e.target.closest('[data-clip-id]'),clip=state.clips.find(c=>c.id===btn?.dataset.clipId);if(!clip)return;
  const menu=document.createElement('div');menu.className='wc-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Clip actions');menu._trigger=btn;
  const actions=[['copy','📋','Copy'],['update','🔄','Update'],['history','🕘','Version history'],['rename','✏️','Rename'],['delete','🗑️','Delete']];
  menu.innerHTML=actions.map(([action,icon,label])=>`${action==='delete'?'<div class="wc-context-divider" role="separator"></div>':''}<button type="button" role="menuitem" class="wc-context-item ${action==='delete'?'wc-context-danger':''}" data-action="${action}" data-clip-id="${escapeHtml(clip.id)}" ${clip.locked&&['update','delete'].includes(action)?'disabled title="Unlock in Library or Clips Manager first"':''}><span class="wc-menu-glyph" aria-hidden="true">${icon}</span><span>${label}</span></button>`).join('');
  document.body.appendChild(menu);state.contextMenu=menu;
  const r=btn.getBoundingClientRect(),m=menu.getBoundingClientRect(),gap=8;
  const openDown=innerHeight-r.bottom>=m.height+gap||innerHeight-r.bottom>=r.top;
  menu.style.top=Math.max(gap,Math.min(openDown?r.bottom+gap:r.top-m.height-gap,innerHeight-m.height-gap))+'px';
  menu.style.left=Math.max(gap,Math.min(e.clientX,innerWidth-m.width-gap))+'px';
  menu.querySelectorAll('button').forEach(item=>item.onclick=handleContextMenuClick);
  const outside=event=>{if(!menu.contains(event.target))hideContextMenu()};document.addEventListener('click',outside);menu._outside=outside;
  menu.onkeydown=event=>{
    if(event.target.matches('input'))return;
    if(event.key==='Escape'){event.preventDefault();hideContextMenu();btn.focus();}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      event.preventDefault();const buttons=[...menu.querySelectorAll('button:not(:disabled)')],i=buttons.indexOf(document.activeElement);
      const index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length;buttons[index]?.focus();
    }
  };
  menu.querySelector('button:not(:disabled)')?.focus();
}
function hideContextMenu(){
  if(state.contextMenu){const menu=state.contextMenu;state.contextMenu=null;menu._cancelRename?.();document.removeEventListener('click',menu._outside);menu.remove();}
}

async function handleContextMenuClick(e) {
  e.stopPropagation();
  const action=e.currentTarget.dataset.action, clipId=e.currentTarget.dataset.clipId;
  const clip=state.clips.find(c=>c.id===clipId); if(!clip)return;
  if(action==='rename'){ startRename(clip,e.currentTarget); return; }
  hideContextMenu();
  if(action==='copy'){
    try{await writeClipToClipboard(clip);showToast('📋 Copied: '+clip.name)}catch{showToast('❌ Copy failed')}
  } else if(action==='update'){
    if(clip.locked){showToast('🔒 Unlock clip before updating');return;}
    try{const changed=await updateClipContent(clip);showToast(changed?'🔄 Updated: '+clip.name:'No content change')}catch(error){showToast('❌ '+(error.message||'Update failed'))}
  } else if(action==='history') showClipHistory(clip);
  else if(action==='delete'){
    if(clip.locked){showToast('🔒 Unlock clip before deleting');return;}
    if(state.settings.showDeleteConfirm&&!confirm(`Delete "${clip.name}"?`))return;
    const index=state.clips.findIndex(c=>c.id===clipId); const removed=state.clips[index];
    state.clips.splice(index,1); saveClips(true); renderDock(); showUndoToast('🗑️ Deleted',()=>{state.clips.splice(Math.min(index,state.clips.length),0,removed);normalizeClipOrder();saveClips(true);renderDock();});
  }
}

function startRename(clip,menuItem){
  const menu=state.contextMenu;if(!menu)return;
  const editor=document.createElement('div');editor.className='wc-context-editor';
  const input=document.createElement('input');input.type='text';input.value=clip.name;input.className='wc-rename-input';input.setAttribute('aria-label','Clip name');editor.appendChild(input);menuItem.replaceWith(editor);
  let finished=false;menu._cancelRename=()=>{finished=true};
  const done=(cancel=false)=>{if(finished)return;finished=true;const current=state.clips.find(c=>c.id===clip.id),name=input.value.trim();if(!cancel&&current&&name&&name!==current.name){current.name=name;saveClips();renderDock();showToast('✏️ Renamed to: '+name)}hideContextMenu();menu._trigger?.focus({preventScroll:true});};
  input.addEventListener('click',event=>event.stopPropagation());
  input.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopPropagation();done(event.key==='Escape')}});
  input.addEventListener('blur',()=>done());input.focus();input.select();
}

const PRESET_ICONS = ['📦', '🔥', '⚡', '🎨', '🖼', '📝', '✨', '🎯', '💡', '🔷', '⭐', '🚀', '🎬', '❤️', '💎', '🌊'];

function openLibraryModal(focusClipId = null) {
  if (state.libraryModal) { closeLibraryModal(); if (!focusClipId) return; }
  revealDock();
  state.librarySearch = state.librarySearch || '';
  const dock = document.getElementById('wc-dock');
  const dockRect = dock.getBoundingClientRect();
  const panel = document.createElement('div');
  panel.id = 'wc-library-panel';
  panel.style.cssText = `position:fixed;z-index:999998;width:420px;max-width:calc(100vw - 16px);max-height:560px;overflow:auto;border-radius:var(--wc-radius,9px);padding:12px;background:var(--wc-bg,#212126);border:1px solid rgba(255,255,255,.10);box-shadow:0 10px 36px rgba(0,0,0,.55);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#fff;`;
  document.body.appendChild(panel);
  const panelHeight = Math.min(560, window.innerHeight - 16);
  const openAbove = dockRect.top > window.innerHeight / 2;
  panel.style.left = `${Math.min(Math.max(8, dockRect.right - 420), Math.max(8, window.innerWidth - 428))}px`;
  panel.style.top = openAbove ? 'auto' : `${Math.min(window.innerHeight - panelHeight - 8, dockRect.bottom + 8)}px`;
  panel.style.bottom = openAbove ? `${window.innerHeight - dockRect.top + 8}px` : 'auto';
  state.libraryModal = panel;

  panel.innerHTML=`<div class="wc-lib-header"><span id="wc-library-count" style="font-weight:600;font-size:14px">🗂 Library</span><div class="wc-lib-header-actions"><button type="button" id="wc-library-import" class="wc-lib-header-btn" title="Import JSON backup" aria-label="Import JSON backup"><span class="wc-glyph" aria-hidden="true">📥</span></button><button type="button" id="wc-library-export" class="wc-lib-header-btn" title="Export JSON backup" aria-label="Export JSON backup"><span class="wc-glyph" aria-hidden="true">📤</span></button><button id="wc-library-reset" class="wc-lib-header-btn" title="Reset dock position" aria-label="Reset dock position">↺</button><button id="wc-library-close" class="wc-lib-header-btn" aria-label="Close">×</button></div></div><input class="wc-lib-search" id="wc-lib-search" placeholder="Search clips… (Alt+K for quick search)" value="${escapeHtml(state.librarySearch)}"><div id="wc-lib-list"></div>`;
  const root=panel.querySelector('#wc-lib-list');
  const renderRow=clip=>`<div class="wc-lib-item ${clip.locked?'wc-lib-lock':''}" draggable="true" data-clip-id="${escapeHtml(clip.id)}">
    <button type="button" class="wc-lib-icon-btn" draggable="false" data-clip-id="${escapeHtml(clip.id)}" title="Change icon" aria-label="Change clip icon"><span class="wc-glyph">${escapeHtml(clip.icon||'📦')}</span></button>
    <div class="wc-lib-info"><button type="button" class="wc-lib-name" data-clip-id="${escapeHtml(clip.id)}" title="Rename clip">${escapeHtml(clip.name)}</button><time class="wc-lib-date">${formatDate(clip.updatedAt||clip.createdAt)}</time></div>
    <div class="wc-lib-actions">
      <button type="button" class="wc-lib-action" data-action="copy" data-clip-id="${escapeHtml(clip.id)}" title="Copy clip" aria-label="Copy clip">📋</button>
      <button type="button" class="wc-lib-action" data-action="update" data-clip-id="${escapeHtml(clip.id)}" title="Update from clipboard" aria-label="Update from clipboard">🔄</button>
      <button type="button" class="wc-lib-action" data-action="history" data-clip-id="${escapeHtml(clip.id)}" title="Version history" aria-label="Version history">🕘</button>
      <button type="button" class="wc-lib-action" data-action="lock" data-clip-id="${escapeHtml(clip.id)}" aria-pressed="${!!clip.locked}" title="${clip.locked?'Unlock · allow updates and deletion':'Lock · protect content and deletion'}" aria-label="${clip.locked?'Unlock clip':'Lock clip'}">${clip.locked?'🔒':'🔓'}</button>
      <button type="button" class="wc-lib-action" data-action="toggle-pin" data-clip-id="${escapeHtml(clip.id)}" aria-pressed="${!!clip.pinned}" title="${clip.pinned?'Unpin · hide from dock':'Pin · show on dock'}" aria-label="${clip.pinned?'Unpin clip':'Pin clip'}">${clip.pinned?'📌':'📍'}</button>
      <button type="button" class="wc-lib-action wc-lib-delete" data-action="delete" data-clip-id="${escapeHtml(clip.id)}" title="Delete clip" aria-label="Delete clip">🗑️</button>
    </div></div>`;
  const bindRows=root=>{
    root.querySelectorAll('.wc-lib-action').forEach(btn => { if(btn.dataset.action==='update')btn.addEventListener('mousedown',ev=>ev.preventDefault()); btn.addEventListener('click',handleLibraryAction); });
    const items=[...root.querySelectorAll('.wc-lib-item')]; attachClipReorderListeners(items);
    items.forEach(item=>item.addEventListener('click',ev=>{
      if(Date.now()<state.suppressClipClickUntil)return;
      if(ev.target.closest('.wc-lib-action,.wc-lib-icon-btn,.wc-lib-name'))return;
      const clip=state.clips.find(c=>c.id===item.dataset.clipId); if(clip){pasteClip(clip);closeLibraryModal();}
    }));
    root.querySelectorAll('.wc-lib-name').forEach(nameEl=>nameEl.addEventListener('click',ev=>{
      ev.stopPropagation(); const clip=state.clips.find(c=>c.id===nameEl.dataset.clipId); if(!clip)return;
      const input=document.createElement('input'); input.value=clip.name; input.className='wc-lib-rename';input.setAttribute('aria-label','Clip name'); nameEl.replaceWith(input);input.focus();input.select();
      let finished=false;const done=(cancel=false)=>{if(finished)return;finished=true;const v=input.value.trim();if(!cancel&&v){clip.name=v;saveClips(true);renderDock();}input.remove();renderList();};input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Escape'){e.preventDefault();e.stopPropagation();done(e.key==='Escape')}});input.addEventListener('blur',()=>done());
    }));
    root.querySelectorAll('.wc-lib-icon-btn').forEach(btn=>btn.addEventListener('click',ev=>{ev.stopPropagation();openLibraryIconPicker(btn.dataset.clipId,btn,renderList);}));

    root.querySelectorAll('.wc-lib-action,.wc-lib-icon-btn').forEach(button=>{if(!button.children.length){const glyph=document.createElement('span');glyph.className='wc-glyph';glyph.textContent=button.textContent;button.textContent='';button.appendChild(glyph);}});
  };
  const list=new WeavyUI.VirtualList(root,{rowHeight:()=>root.clientWidth<340?92:64,render:renderRow,bind:bindRows});
  panel._virtualList=list;
  const renderList=()=>{
    const before=WeavyUI.positions(root,'.wc-lib-item');
    const query=state.librarySearch.trim().toLowerCase(),ordered=getOrderedClips();
    const filtered=WeavyUI.searchClips(ordered,query);
    panel.querySelector('#wc-library-count').textContent=`🗂 Library (${filtered.length}/${ordered.length})`;
    list.set(filtered);WeavyUI.animatePositions(root,before,'.wc-lib-item');
    if(focusClipId){const index=filtered.findIndex(c=>c.id===focusClipId);if(index>=0)list.scrollToIndex(index);focusClipId=null;}
  };
  panel._refresh=focus=>{focusClipId=focus;renderList()};
  panel.querySelector('#wc-library-import').onclick=event=>{event.stopPropagation();WeavyBackup.chooseFile({before:()=>clipStore.flush(),report:showToast});};
  panel.querySelector('#wc-library-export').onclick=event=>{event.stopPropagation();WeavyBackup.exportFile({before:()=>clipStore.flush(),report:showToast});};
  panel.querySelector('#wc-library-close').onclick=closeLibraryModal;
  panel.querySelector('#wc-library-reset').onclick=e=>{e.stopPropagation();resetDockPosition();closeLibraryModal()};
  panel.querySelector('#wc-lib-search').oninput=e=>{state.librarySearch=e.target.value;root.scrollTop=0;renderList()};
  renderList();
  setTimeout(()=>document.addEventListener('click',function outside(ev){if(!panel.isConnected){document.removeEventListener('click',outside);return;}if(!panel.contains(ev.target)&&!ev.target.closest('#wc-library-btn,#wc-icon-picker,.wc-history-overlay,#wc-command-palette')){closeLibraryModal();document.removeEventListener('click',outside);}},false),0);
}

function openLibraryIconPicker(clipId, anchor, refresh) {
  document.getElementById('wc-icon-picker')?.remove();
  const clip=state.clips.find(c=>c.id===clipId); if(!clip)return;
  const picker=document.createElement('div');picker.id='wc-icon-picker';picker.style.cssText='position:fixed;z-index:1000001;background:#2a2a35;border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:10px;box-shadow:0 8px 32px rgba(0,0,0,.5);width:260px;max-width:calc(100vw - 16px)';
  picker.innerHTML=`<div style="display:grid;grid-template-columns:repeat(8,24px);justify-content:space-between;gap:6px;margin-bottom:10px">${PRESET_ICONS.map(icon=>`<button data-icon="${icon}" style="width:24px;height:24px;border:0;border-radius:5px;background:rgba(255,255,255,.09);font-size:14px">${icon}</button>`).join('')}</div><input id="wc-custom-icon" maxlength="8" placeholder="Emoji or short text" style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:6px;padding:7px 9px;color:#fff">`;
  document.body.appendChild(picker);const r=anchor.getBoundingClientRect(),pr=picker.getBoundingClientRect();picker.style.left=Math.min(Math.max(8,r.left),window.innerWidth-pr.width-8)+'px';picker.style.top=(r.bottom+pr.height+8<=window.innerHeight?r.bottom+8:Math.max(8,r.top-pr.height-8))+'px';
  picker.querySelectorAll('[data-icon]').forEach(b=>b.addEventListener('click',()=>{clip.icon=b.dataset.icon;saveClips(true);renderDock();picker.remove();refresh();}));const ci=picker.querySelector('#wc-custom-icon');ci.focus();ci.addEventListener('keydown',e=>{if(e.key==='Enter'&&ci.value.trim()){clip.icon=ci.value.trim();saveClips(true);renderDock();picker.remove();refresh();}});
}

function closeLibraryModal() {
  if (state.libraryModal) {
    state.libraryModal._virtualList?.destroy();
    state.libraryModal.remove();
    state.libraryModal = null;
    scheduleDockHide();
  }
}

function refreshLibraryModal(focusClipId = null) { if(state.libraryModal?._refresh)state.libraryModal._refresh(focusClipId);else openLibraryModal(focusClipId); }

async function handleLibraryAction(e) {
  e.stopPropagation();
  const action=e.currentTarget.dataset.action||e.target.dataset.action;
  const clipId=e.currentTarget.dataset.clipId||e.target.dataset.clipId;
  const clip=state.clips.find(c=>c.id===clipId); if(!clip)return;
  if(action==='copy'){try{await writeClipToClipboard(clip);showToast('📋 Copied: '+clip.name)}catch{showToast('❌ Copy failed')}}
  else if(action==='update'){
    if(clip.locked){showToast('🔒 Unlock clip before updating');return;}
    try{const changed=await updateClipContent(clip);refreshLibraryModal(clip.id);showToast(changed?'🔄 Updated: '+clip.name:'No content change')}catch(err){showToast('❌ '+(err.message||'Update failed'))}
  }
  else if(action==='history') showClipHistory(clip);
  else if(action==='lock'){clip.locked=!clip.locked;saveClips(true);renderDock();refreshLibraryModal(clip.id);showToast(clip.locked?'🔒 Locked':'🔓 Unlocked');}
  else if(action==='toggle-pin'){clip.pinned=!clip.pinned;saveClips(true);renderDock();refreshLibraryModal(clip.id);showToast(clip.pinned?'📌 Pinned':'📌 Unpinned');}
  else if(action==='delete'){
    if(clip.locked){showToast('🔒 Unlock clip before deleting');return;}
    if(state.settings.showDeleteConfirm&&!confirm(`Delete "${clip.name}"?`))return;
    const idx=state.clips.findIndex(c=>c.id===clipId);const removed=state.clips[idx];state.clips.splice(idx,1);saveClips(true);renderDock();refreshLibraryModal();showUndoToast('🗑️ Deleted',()=>{state.clips.splice(Math.min(idx,state.clips.length),0,removed);normalizeClipOrder();saveClips(true);renderDock();refreshLibraryModal(removed.id);});
  }
}

async function pasteClip(clip) {
  const method = state.settings.pasteMethod || DEFAULT_SETTINGS.pasteMethod;
  const target = document.querySelector('canvas,[class*="canvas"],[class*="editor"],main') || document.body;
  if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  let previousClipboard = null;
  try {
    if (method === 'debugger_ctrlv' && state.settings.restoreClipboardAfterDebuggerPaste) {
      previousClipboard = await readClipboard().catch(() => null);
    }

    if (method === 'datatransfer') {
      const dt = new DataTransfer();
      if (clip.type === 'image') {
        const blob=dataUrlToBlob(clip.content);const mime=blob.type||'image/png';const ext=mime.includes('jpeg')?'jpg':(mime.split('/')[1]||'png');dt.items.add(new File([blob],`weavy-clip.${ext}`,{type:mime}));
      } else {
        const str=typeof clip.content==='string'?clip.content:JSON.stringify(clip.content);dt.setData('text/plain',str);if(clip.type==='json')dt.setData('application/json',str);
      }
      target.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));
      showToast('✅ Auto-pasted');
    } else {
      await writeClipToClipboard(clip);
      if (method === 'copy_only') showToast('✅ Copied. Paste manually');
      else { await requestDebuggerPaste(); showToast('↗ Paste triggered'); }
    }

    clip.usageCount=(clip.usageCount||0)+1;saveClips();
    if (previousClipboard && method === 'debugger_ctrlv') {
      setTimeout(async()=>{
        try {
          if(previousClipboard.type==='image'){const b=dataUrlToBlob(previousClipboard.content);await navigator.clipboard.write([new ClipboardItem({[b.type||'image/png']:b})]);}
          else await navigator.clipboard.writeText(previousClipboard.content||'');
        } catch(error){console.warn('[WeavyClips] Clipboard restore failed:',error);}
      },160);
    }
  } catch(error){console.error('[WeavyClips] Paste failed:',error);showToast(method==='debugger_ctrlv'?'❌ Debugger paste failed':'❌ Paste failed');}
}


function versionDiffSummary(version, clip) {
  if (version.type !== clip.type) return `Type: ${version.type} → ${clip.type}`;
  if (version.type === 'image') return version.content === clip.content ? 'No image change' : 'Image content changed';
  if (version.type === 'json') {
    try {
      const a=JSON.parse(version.content), b=JSON.parse(clip.content);
      const ak=new Set(Object.keys(a||{})), bk=new Set(Object.keys(b||{}));
      const added=[...bk].filter(k=>!ak.has(k)); const removed=[...ak].filter(k=>!bk.has(k));
      const changed=[...ak].filter(k=>bk.has(k)&&JSON.stringify(a[k])!==JSON.stringify(b[k]));
      const parts=[]; if(added.length)parts.push(`+ ${added.slice(0,5).join(', ')}`); if(removed.length)parts.push(`− ${removed.slice(0,5).join(', ')}`); if(changed.length)parts.push(`~ ${changed.slice(0,5).join(', ')}`);
      return parts.join(' · ') || 'No structural change';
    } catch {}
  }
  const a=String(version.content||'').split('\n'), b=String(clip.content||'').split('\n');
  let same=0; for(let i=0;i<Math.min(a.length,b.length);i++) if(a[i]===b[i]) same++;
  return `${a.length} → ${b.length} lines · ${Math.max(a.length,b.length)-same} changed/added`;
}
function closeClipHistory() {
  if (state.historyModal) {
    state.historyModal.remove();
    state.historyModal = null;
  }
}

function showClipHistory(clip) {
  closeClipHistory();
  const versions=[...ensureVersions(clip)].sort((a,b)=>b.savedAt-a.savedAt);
  const overlay=document.createElement('div');overlay.className='wc-history-overlay';
  overlay.innerHTML=`<div class="wc-history-modal"><div class="wc-history-header"><div><div class="wc-history-title">🕘 ${escapeHtml(clip.name)} ${clip.locked?'🔒':''}</div><div class="wc-history-subtitle">${versions.length} previous version${versions.length===1?'':'s'}</div></div><button class="wc-history-close">&times;</button></div>
    <div class="wc-history-current"><strong>Current</strong> · ${formatDate(clip.updatedAt||clip.createdAt)} · ${String(clip.type).toUpperCase()}<div class="wc-history-preview">${clip.type==='image'?'[Image]':escapeHtml(getClipPreview(clip.content))}</div></div>
    <div class="wc-history-list">${versions.length?versions.map((version,index)=>`<div class="wc-history-item"><div class="wc-history-info"><div><strong>Version ${versions.length-index}</strong> · ${formatDate(version.savedAt)} · ${String(version.type).toUpperCase()}</div><div class="wc-history-preview">${version.type==='image'?'[Image]':escapeHtml(getClipPreview(version.content))}</div><div class="wc-tooltip-meta2">${escapeHtml(versionDiffSummary(version,clip))}</div></div><button class="wc-history-restore" data-version-id="${version.id}">Restore</button></div>`).join(''):'<div class="wc-history-empty">No previous versions yet.</div>'}</div></div>`;
  document.body.appendChild(overlay);state.historyModal=overlay;overlay.querySelector('.wc-history-close').addEventListener('click',closeClipHistory);overlay.addEventListener('click',e=>{if(e.target===overlay)closeClipHistory()});
  overlay.querySelectorAll('.wc-history-restore').forEach(btn=>btn.addEventListener('click',()=>{
    if(clip.locked){showToast('🔒 Unlock clip before restoring');return;}
    const version=ensureVersions(clip).find(v=>v.id===btn.dataset.versionId);if(!version)return;const refresh=!!state.libraryModal;
    if(restoreClipVersion(clip,version)){closeClipHistory();if(refresh)refreshLibraryModal(clip.id);showToast('↩️ Restored previous version');}
  }));
}


function showUndoToast(message, undo, label='Undo') {
  let toast=document.getElementById('wc-toast');
  if(!toast){toast=document.createElement('div');toast.id='wc-toast';document.body.appendChild(toast);}
  toast.style.cssText='position:fixed;z-index:9999999;background:#2a2a3a;color:#e8e8f0;border-radius:18px;padding:7px 9px 7px 14px;font:13px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;pointer-events:auto';
  toast.setAttribute('role','status');
  toast.innerHTML=`<span>${escapeHtml(message)}</span><button id="wc-undo-btn" style="border:0;border-radius:12px;background:var(--wc-accent,#fff);color:var(--wc-on-accent,#16161d);padding:5px 9px;cursor:pointer">${escapeHtml(label)}</button>`;
  const dock=document.getElementById('wc-dock');const r=dock?.getBoundingClientRect()||{left:innerWidth/2,width:0,top:innerHeight-40};toast.style.left=(r.left+r.width/2)+'px';toast.style.top=Math.max(8,r.top-46)+'px';toast.style.transform='translateX(-50%)';
  clearTimeout(toast._timer);toast.querySelector('#wc-undo-btn').onclick=()=>{clearTimeout(toast._timer);undo?.();toast.style.opacity='0'};toast._timer=setTimeout(()=>{toast.style.opacity='0'},4500);
}
function showToast(message) {
  let toast=document.getElementById('wc-toast');
  if(!toast){toast=document.createElement('div');toast.id='wc-toast';document.body.appendChild(toast);}
  toast.style.cssText='position:fixed;z-index:9999999;pointer-events:none;background:#2a2a3a;color:#e8e8f0;border-radius:20px;padding:8px 16px;font:13px system-ui;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.4);transition:opacity .2s ease';
  toast.textContent=message;toast.style.opacity='1';
  const dock=document.getElementById('wc-dock');const r=dock?.getBoundingClientRect()||{left:innerWidth/2,width:0,top:innerHeight-40};
  toast.style.left=(r.left+r.width/2)+'px';toast.style.top=Math.max(8,r.top-44)+'px';toast.style.transform='translateX(-50%)';
  clearTimeout(toast._timer);toast._timer=setTimeout(()=>{toast.style.opacity='0'},2200);
}

function receiveSettings(raw) {
  if (Number(raw?._revision || 0) < Number(state.settings._revision || 0)) return;
  const next = normalizeSettings(raw);
  const positionChanged = POSITION_KEYS.some(k => next[k] !== storedPosition[k]);
  storedPosition = Object.fromEntries(POSITION_KEYS.map(k => [k,next[k]]));
  if (!positionChanged && next.perProjectPosition === state.settings.perProjectPosition) {
    POSITION_KEYS.forEach(k => next[k] = state.settings[k]);
  }
  state.settings = next;
  applyStyles();
  positionDock();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.clips) {
    clipStore.receive(changes.clips.newValue||[],changes.clipsRevision?.newValue);
    normalizeClipOrder();
  }
  if (changes.settings) {
    receiveSettings(changes.settings.newValue || {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'settingsRefresh') {
    chrome.storage.local.get(['settings'], result => {
      receiveSettings(result.settings || {});
      sendResponse({ success: true });
    });
    return true;
  }
  if (msg.action === 'applyDefaultDock') {
    resetDockPosition();
    sendResponse({ success: true });
    return true;
  }
  if (msg.action === 'getDockGeometry') {
    const dock = document.getElementById('wc-dock');
    if (!dock) { sendResponse(null); return true; }
    const rect = dock.getBoundingClientRect();
    sendResponse({ rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, viewport: { width: innerWidth, height: innerHeight } });
    return true;
  }
  if (msg.action === 'getRuntimeDiagnostics') {
    sendResponse({
      capture: state.lastCaptureStatus || null,
      projectKey: getProjectKey(),
      dockPosition: { left: state.settings.dockLeft, right: state.settings.dockRight, top: state.settings.dockTop, bottom: state.settings.dockBottom }
    });
    return true;
  }
  if (msg.action === 'updateColors') {
    if (msg.accentColor) state.settings.accentColor = msg.accentColor;
    if (msg.bgColor) state.settings.bgColor = msg.bgColor;
    if (msg.borderRadius !== undefined) state.settings.borderRadius = msg.borderRadius;
    applyStyles();
    sendResponse({ success: true });
    return true;
  }
  return false;
});

window.addEventListener('resize', () => { clampDockToViewport(); });


document.addEventListener('keydown', (event) => {
  if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyK') {
    event.preventDefault();event.stopPropagation();
    WeavyUI.palette({clips:()=>getOrderedClips(),onChoose:clip=>pasteClip(clip)});
    return;
  }
  if (!state.settings.quickPasteEnabled || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
  const n = Number(event.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return;
  const clip = getOrderedClips(state.clips.filter(c => c.pinned))[n - 1];
  if (!clip) return;
  event.preventDefault();
  pasteClip(clip);
});
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
