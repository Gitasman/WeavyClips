console.log('[WeavyClips] Background service worker started');

importScripts('appearance.js');
importScripts('factory.js');
importScripts('clips.js');
// Native side panel is the default UI; no extra tab/window on toolbar click.
// Toolbar behavior follows the saved opening preference.

function sendDebuggerCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function attachDebugger(tabId) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, '1.3', () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function detachDebugger(tabId) {
  return new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

async function forceSystemShortcut(tabId, key) {
  await attachDebugger(tabId);

  try {
    const isMac = /Mac/i.test(navigator.userAgent || '');
    const modifier = isMac ? 4 : 2;
    const modifierKey = isMac ? 'Meta' : 'Control';
    const modifierCode = isMac ? 'MetaLeft' : 'ControlLeft';
    const modifierVirtualKeyCode = isMac ? 91 : 17;
    const normalizedKey = String(key).toLowerCase();
    const keyCode = normalizedKey === 'c' ? 67 : 86;
    const code = normalizedKey === 'c' ? 'KeyC' : 'KeyV';

    await sendDebuggerCommand(tabId, 'Page.enable');
    await sendDebuggerCommand(tabId, 'Page.bringToFront');
    await new Promise(resolve => setTimeout(resolve, 80));

    await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: modifierKey,
      code: modifierCode,
      windowsVirtualKeyCode: modifierVirtualKeyCode,
      nativeVirtualKeyCode: modifierVirtualKeyCode,
      modifiers: modifier
    });

    await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: normalizedKey,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers: modifier
    });

    await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: normalizedKey,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers: modifier
    });

    await sendDebuggerCommand(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: modifierKey,
      code: modifierCode,
      windowsVirtualKeyCode: modifierVirtualKeyCode,
      nativeVirtualKeyCode: modifierVirtualKeyCode,
      modifiers: 0
    });

    await new Promise(resolve => setTimeout(resolve, normalizedKey === 'c' ? 120 : 80));
  } finally {
    await detachDebugger(tabId);
  }
}


function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(values) {
  return new Promise(resolve => chrome.storage.local.set(values, resolve));
}

function sendTabMessage(tabId, message) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, message, response => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { success: true });
    });
  });
}

function getProjectKeyFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname.split('/').slice(0, 4).join('/')}`;
  } catch {
    return null;
  }
}

function getDefaultDockCssFromSettings(settings = {}) {
  const horizontalAnchor = settings.defaultDockHorizontalAnchor || 'center';
  const verticalAnchor = settings.defaultDockVerticalAnchor || 'bottom';
  const horizontalOffset = Number.isFinite(Number(settings.defaultDockHorizontalOffset)) ? Number(settings.defaultDockHorizontalOffset) : 140;
  const verticalOffset = Number.isFinite(Number(settings.defaultDockVerticalOffset)) ? Number(settings.defaultDockVerticalOffset) : 11;
  const css = { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' };
  if (horizontalAnchor === 'left') css.left = `${horizontalOffset}px`;
  else if (horizontalAnchor === 'right') css.right = `${horizontalOffset}px`;
  else css.left = `calc(50% + ${horizontalOffset}px)`;
  if (verticalAnchor === 'top') css.top = `${verticalOffset}px`;
  else if (verticalAnchor === 'center') css.top = `calc(50% + ${verticalOffset}px)`;
  else css.bottom = `${verticalOffset}px`;
  return css;
}

async function applyDefaultDockToOpenWeavyTabs() {
  const tabs = await chrome.tabs.query({ url: '*://app.weavy.ai/*' });
  if (!tabs.length) return { success: false, error: 'No Weavy tabs', tabs: 0 };

  const stored = await storageGet(['settings', 'dockPositions']);
  const settings = stored.settings || {};
  const css = getDefaultDockCssFromSettings(settings);
  const nextSettings = {
    dockLeft: css.left,
    dockRight: css.right,
    dockTop: css.top,
    dockBottom: css.bottom
  };
  const valuesToStore = {};

  // Persist the reset per path first. This also covers discarded/suspended tabs:
  // when they wake up, the content script loads the already-reset position.
  if (settings.perProjectPosition !== false) {
    const map = stored.dockPositions || {};
    for (const tab of tabs) {
      const key = getProjectKeyFromUrl(tab.url);
      if (key) map[key] = { ...css };
    }
    valuesToStore.dockPositions = map;
  }
  await patchSettings(nextSettings);
  if (Object.keys(valuesToStore).length) await storageSet(valuesToStore);

  const results = await Promise.all(tabs.map(tab => sendTabMessage(tab.id, { action: 'applyDefaultDock' })));
  const immediate = results.filter(result => result?.success).length;
  return { success: true, tabs: tabs.length, immediate };
}

let storageWriteQueue = Promise.resolve();
function patchClips(operations) {
  const write=storageWriteQueue.then(async()=>{
    if(!Array.isArray(operations)||operations.length>100000)throw new Error('Invalid clip operations');
    const stored=await chrome.storage.local.get(['clips','clipsRevision']);
    const clips=WeavyClips.apply(stored.clips||[],operations);
    const revision=(Number(stored.clipsRevision)||0)+1;
    await chrome.storage.local.set({clips,clipsRevision:revision});
    return revision;
  });
  storageWriteQueue=write.catch(()=>{});
  return write;
}
function patchSettings(patch) {
  const write = storageWriteQueue.then(async () => {
    const stored = await chrome.storage.local.get('settings');
    const revision = (Number(stored.settings?._revision) || 0) + 1;
    await chrome.storage.local.set({settings:{...(stored.settings || {}), ...patch, _revision:revision}});
    if(Object.hasOwn(patch,'settingsOpenMode'))await configureOptions(patch.settingsOpenMode);
    return revision;
  });
  storageWriteQueue = write.catch(() => {});
  return write;
}

function mutatePreset(message) {
  const write = storageWriteQueue.then(async()=>{
    const stored = await chrome.storage.local.get('appearancePresets');
    let presets = WeavyAppearance.sanitizePresets(stored.appearancePresets);
    const id = message.id;
    if (message.operation === 'delete') presets = presets.filter(p=>p.id!==id);
    else if (message.operation === 'import') {
      const incoming=WeavyAppearance.sanitizePresets(message.presets);
      const ids=new Set(presets.map(p=>p.id));
      presets.push(...incoming.filter(p=>!ids.has(p.id)));
    } else {
      const name=String(message.name||'').trim().slice(0,60);
      if (!name) throw new Error('Enter a preset name');
      const item={id:message.operation==='create' ? 'custom-'+crypto.randomUUID() : id,name,values:WeavyAppearance.snapshot(message.values)};
      if(message.operation==='create') presets.push(item);
      else if(message.operation==='update') {
        const index=presets.findIndex(p=>p.id===id);
        if(index<0) throw new Error('This preset no longer exists');
        presets[index]=item;
      } else throw new Error('Unknown preset action');
      await chrome.storage.local.set({appearancePresets:presets});
      return {presets,selectedId:item.id};
    }
    await chrome.storage.local.set({appearancePresets:presets});
    return {presets};
  });
  storageWriteQueue=write.catch(()=>{});
  return write;
}

let settingsOpenMode='tab',defaultsReady=null;
async function configureOptions(mode){
  settingsOpenMode=mode==='sidePanel'?'sidePanel':'tab';
  await chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:settingsOpenMode==='sidePanel'});
}
function ensureDefaults(){
  if(defaultsReady)return defaultsReady;
  const write=storageWriteQueue.then(async()=>{
    const stored=await chrome.storage.local.get(['clips','settings','factorySeedVersion']);
    const values={};
    if(!Object.hasOwn(stored,'clips')||!stored.settings){
      const response=await fetch(chrome.runtime.getURL('default-backup.json'));
      if(!response.ok)throw new Error('Could not load bundled defaults');
      const seed=WeavyClips.validateBackup(await response.json());
      if(!Object.hasOwn(stored,'clips')){values.clips=seed.clips;values.clipsRevision=1;}
      if(!stored.settings)values.settings=cleanSettings(seed.settings||{},WeavyDefaults.settings);
    }
    if(!stored.factorySeedVersion)values.factorySeedVersion=1;
    if(Object.keys(values).length)await chrome.storage.local.set(values);
    await configureOptions((values.settings||stored.settings||{}).settingsOpenMode);
  });
  storageWriteQueue=write.catch(()=>{});
  defaultsReady=write.catch(error=>{defaultsReady=null;throw error});return defaultsReady;
}
function cleanSettings(raw,previous={}){
  const known=Object.fromEntries(Object.keys(WeavyDefaults.settings).filter(k=>Object.hasOwn(raw,k)).map(k=>[k,raw[k]]));
  const settings=WeavyAppearance.normalize({...WeavyDefaults.settings,...previous,...known,settingsSchemaVersion:8});
  settings.settingsOpenMode=settings.settingsOpenMode==='sidePanel'?'sidePanel':'tab';
  return settings;
}
function importBackup(data){
  const write=storageWriteQueue.then(async()=>{
    if(data==null){const response=await fetch(chrome.runtime.getURL('default-backup.json'));if(!response.ok)throw new Error('Could not load bundled defaults');data=await response.json();}
    const backup=WeavyClips.validateBackup(data);
    const stored=await chrome.storage.local.get(['clips','clipsRevision','settings','appearancePresets']);
    const clips=stored.clips||[],ids=new Set(clips.map(c=>c.id)),incoming=backup.clips.filter(c=>!ids.has(c.id));
    const maxOrder=clips.reduce((n,c)=>Math.max(n,Number(c.sortOrder)||0),-1);
    incoming.forEach((c,i)=>c.sortOrder=maxOrder+i+1);
    const settings=backup.settings?cleanSettings(backup.settings,stored.settings):stored.settings;
    if(settings)settings._revision=(Number(stored.settings?._revision)||0)+1;
    const presets=WeavyAppearance.sanitizePresets(stored.appearancePresets),presetIds=new Set(presets.map(p=>p.id));
    presets.push(...WeavyAppearance.sanitizePresets(backup.appearancePresets).filter(p=>!presetIds.has(p.id)));
    await chrome.storage.local.set({clips:[...clips,...incoming],clipsRevision:(Number(stored.clipsRevision)||0)+1,settings,appearancePresets:presets});
    await configureOptions(settings?.settingsOpenMode);
    return {added:incoming.length,skipped:backup.clips.length-incoming.length};
  });
  storageWriteQueue=write.catch(()=>{});return write;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'patchClips' && sender.id === chrome.runtime.id) {
    patchClips(msg.operations).then(revision=>sendResponse({success:true,revision})).catch(error=>sendResponse({success:false,error:error.message}));
    return true;
  }
  if (msg.action === 'presetMutation' && sender.id === chrome.runtime.id) {
    mutatePreset(msg).then(result=>sendResponse({success:true,...result})).catch(error=>sendResponse({success:false,error:error.message}));
    return true;
  }
  if (msg.action === 'patchSettings' && sender.id === chrome.runtime.id) {
    patchSettings(msg.patch || {}).then(revision => sendResponse({success:true,revision}))
      .catch(error => sendResponse({success:false,error:error.message}));
    return true;
  }

  if (msg.action === 'initializeDefaults' && sender.id === chrome.runtime.id) {
    ensureDefaults().then(()=>sendResponse({success:true})).catch(error=>sendResponse({success:false,error:error.message}));return true;
  }
  if ((msg.action === 'importBackup'||msg.action === 'applyFactoryDefaults') && sender.id === chrome.runtime.id) {
    importBackup(msg.action==='applyFactoryDefaults'?null:msg.data).then(result=>sendResponse({success:true,...result})).catch(error=>sendResponse({success:false,error:error.message}));return true;
  }
  if (msg.action === 'openOptions' && sender.id === chrome.runtime.id) {
    const mode=msg.mode==='sidePanel'?'sidePanel':msg.mode==='tab'?'tab':settingsOpenMode;
    if(mode==='sidePanel'){
      if(sender.tab?.windowId==null){sendResponse({success:false,error:'Open from a Weavy tab'});return true;}
      // Keep sidePanel.open directly in the user-gesture message handler.
      chrome.sidePanel.open({windowId:sender.tab.windowId}).then(()=>sendResponse({success:true})).catch(error=>sendResponse({success:false,error:error.message}));
    }else chrome.runtime.openOptionsPage().then(()=>sendResponse({success:true})).catch(error=>sendResponse({success:false,error:error.message}));
    return true;
  }

  if (msg.action === 'applyDefaultDockAll') {
    applyDefaultDockToOpenWeavyTabs()
      .then(sendResponse)
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (msg.action === 'forceSystemCopy' || msg.action === 'forceSystemPaste') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No source tab available' });
      return true;
    }

    const key = msg.action === 'forceSystemCopy' ? 'c' : 'v';
    console.log(`[WeavyClips] Executing debugger Ctrl/Cmd+${key.toUpperCase()}`);
    forceSystemShortcut(tabId, key)
      .then(() => sendResponse({ success: true }))
      .catch((error) => {
        console.error('[WeavyClips] Debugger shortcut error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults().catch(console.error);
});

// Native toolbar clicks open the panel when configured by Chrome, or a full tab.
chrome.action?.onClicked.addListener(async()=>{
  await ensureDefaults();
  if(settingsOpenMode!=='sidePanel')await chrome.runtime.openOptionsPage();
});
ensureDefaults().catch(console.error);
