console.log('[WeavyClips] Options v2 loaded');

const DEFAULT_SETTINGS = WeavyDefaults.settings;

let state = { clips: [], settings: { ...DEFAULT_SETTINGS }, search: '', filter: 'all' };
const clipStore=new WeavyClips.Client({get:()=>state.clips,set:clips=>{state.clips=clips;scheduleClipsRender()},status:(status)=>{
  const label=document.getElementById('clips-save-status'),retry=document.getElementById('retry-clips-btn');
  if(label){label.hidden=status!=='error';label.textContent='Clips could not be saved';}
  if(retry)retry.hidden=status!=='error';
}});
const PRESET_ICONS = ['📦','🔥','⚡','🎨','🖼','📝','✨','🎯','💡','🔷','⭐','🚀','🎬','❤️','💎','🌊'];

function normalizeSettings(raw = {}) {
  const s = WeavyAppearance.normalize({ ...DEFAULT_SETTINGS, ...raw });
  const old = Number(raw.settingsSchemaVersion || 0);
  let changed = false;
  delete s.resetIconColor;
  delete s.resetButtonSide;
  delete s.resetButtonGap;
  delete s.resetButtonOffsetX;
  delete s.resetButtonOffsetY;
  if (old < 6) {
    if (!('defaultDockHorizontalOffset' in raw) || Number(raw.defaultDockHorizontalOffset) === 200) s.defaultDockHorizontalOffset = 180;
    if (!('defaultDockVerticalOffset' in raw) || Number(raw.defaultDockVerticalOffset) === 40) s.defaultDockVerticalOffset = 11;
    if (!('dockLeft' in raw) || raw.dockLeft === 'calc(50% + 200px)') s.dockLeft = 'calc(50% + 180px)';
    if (!('dockBottom' in raw) || raw.dockBottom === '40px') s.dockBottom = '11px';
    s.perProjectPosition = true;
    if (!('clampDock' in raw)) s.clampDock = true;
    changed = true;
  }
  // v2.0.2 factory default: move the dock 40px left from the previous default.
  // Preserve custom positions; only migrate the exact old factory values.
  if (old < 7) {
    if ((s.defaultDockHorizontalAnchor || 'center') === 'center' && Number(s.defaultDockHorizontalOffset) === 180) {
      s.defaultDockHorizontalOffset = 140;
      changed = true;
    }
    if (s.dockLeft === 'calc(50% + 180px)') {
      s.dockLeft = 'calc(50% + 140px)';
      changed = true;
    }
    s.settingsSchemaVersion = 7;
    changed = true;
  }
  // v2.0.3: delete confirmations are disabled by default.
  if (old < 8) {
    s.showDeleteConfirm = false;
    s.settingsSchemaVersion = 8;
    changed = true;
  }
  if (changed) chrome.storage.local.set({ settings: s });
  return s;
}

function normalizeClips() {
  let changed = false;
  state.clips.forEach((clip, i) => {
    if (!Number.isFinite(clip.sortOrder)) { clip.sortOrder = i; changed = true; }
    if (!Array.isArray(clip.versions)) { clip.versions = []; changed = true; }
    if (clip.locked == null) { clip.locked = false; changed = true; }
    if (clip.group == null) { clip.group = ''; changed = true; }
    if ('pasteMethodOverride' in clip) { delete clip.pasteMethodOverride; changed = true; }
  });
  state.clips.sort((a,b)=>(a.sortOrder-b.sortOrder)||((a.createdAt||0)-(b.createdAt||0)));
  state.clips.forEach((c,i)=>{ if(c.sortOrder!==i){c.sortOrder=i;changed=true;} });
  if (changed) saveClips(true);
}

function saveClips(immediate=false) {
  return clipStore.save(immediate);
}
let settingsSnapshot = {};
let acknowledgedRevision = 0;
const settingsJobs = [];
let savingSettings = false;
function saveSettings() {
  const patch = Object.fromEntries(Object.entries(state.settings).filter(([k,v]) => k !== '_revision' && v !== settingsSnapshot[k]));
  settingsSnapshot = {...state.settings};
  if (!Object.keys(patch).length) return;
  // Collapse pending slider frames; keep the in-flight patch until acknowledged.
  if (settingsJobs.length > 1) Object.assign(settingsJobs[settingsJobs.length-1],patch);
  else settingsJobs.push(patch);
  drainSettings();
}
async function drainSettings() {
  if (savingSettings || !settingsJobs.length) return;
  savingSettings = true;
  const status = document.getElementById('settings-save-status');
  status.textContent = 'Saving…';
  try {
    while (settingsJobs.length) {
      const response = await chrome.runtime.sendMessage({action:'patchSettings',patch:settingsJobs[0]});
      if (!response?.success) throw new Error(response?.error || 'Could not save');
      acknowledgedRevision = Math.max(acknowledgedRevision,Number(response.revision)||0);
      settingsJobs.shift();
    }
    status.textContent = 'All changes saved';
  } catch (error) {
    status.textContent = 'Save failed · change a setting to retry';
    console.error('[WeavyClips]',error);
  } finally { savingSettings = false; }
}
function esc(v=''){ const d=document.createElement('div'); d.textContent=String(v); return d.innerHTML; }
function fmt(ts){return WeavyUI.formatDate(ts);}
function preview(content){ const s=typeof content==='string'?content:JSON.stringify(content); return (s||'').slice(0,120).replace(/\s+/g,' '); }
function dataUrlToBlob(dataUrl){ const [meta,b64]=dataUrl.split(','); const mime=(meta.match(/data:([^;]+)/)||[])[1]||'image/png'; const bytes=atob(b64); const a=new Uint8Array(bytes.length); for(let i=0;i<bytes.length;i++)a[i]=bytes.charCodeAt(i); return new Blob([a],{type:mime}); }
function ensureVersions(c){ if(!Array.isArray(c.versions)) c.versions=[]; return c.versions; }
function simpleHash(value=''){ let h=2166136261; const s=String(value); for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return (h>>>0).toString(16).padStart(8,'0'); }
function signature(type,content){ const s=typeof content==='string'?content:JSON.stringify(content); return `${type}:${s.length}:${simpleHash(s)}`; }
function snapshot(c){ return { id:crypto.randomUUID(), type:c.type, content:c.content, savedAt:c.updatedAt||c.createdAt||Date.now(), signature:signature(c.type,c.content) }; }
function trimVersions(c){ const max=Number(state.settings.maxVersions||25); if(max>0 && c.versions.length>max)c.versions.splice(0,c.versions.length-max); }
function diffSummary(aType,aContent,bType,bContent){
  if(aType!==bType) return `Type: ${aType} → ${bType}`;
  if(aType==='image') return aContent===bContent?'No image change':'Image content changed';
  if(aType==='json'){
    try{ const a=JSON.parse(aContent),b=JSON.parse(bContent); const ak=new Set(Object.keys(a||{})),bk=new Set(Object.keys(b||{})); const added=[...bk].filter(k=>!ak.has(k)); const removed=[...ak].filter(k=>!bk.has(k)); const changed=[...ak].filter(k=>bk.has(k)&&JSON.stringify(a[k])!==JSON.stringify(b[k])); const parts=[]; if(added.length)parts.push(`+ ${added.slice(0,6).join(', ')}`); if(removed.length)parts.push(`− ${removed.slice(0,6).join(', ')}`); if(changed.length)parts.push(`~ ${changed.slice(0,6).join(', ')}`); return parts.join(' · ')||'No structural change'; }catch{}
  }
  const a=String(aContent||'').split('\n'), b=String(bContent||'').split('\n'); let same=0; const n=Math.min(a.length,b.length); for(let i=0;i<n;i++)if(a[i]===b[i])same++; return `${a.length} → ${b.length} lines · ${Math.max(a.length,b.length)-same} changed/added`;
}

async function readClipboard(){
  try{
    const items=await navigator.clipboard.read();
    for(const item of items){ const imageType=item.types.find(t=>t.startsWith('image/')); if(imageType){ const blob=await item.getType(imageType); const base64=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(blob)}); return {type:'image',content:base64}; } if(item.types.includes('text/plain')){ const t=await (await item.getType('text/plain')).text(); let type='text'; try{JSON.parse(t);type='json'}catch{} return {type,content:t}; } }
  }catch{}
  const t=await navigator.clipboard.readText(); let type='text'; try{JSON.parse(t);type='json'}catch{} return {type,content:t};
}

async function updateClipFromClipboard(clip){
  if(clip.locked) throw new Error('Clip is locked');
  const data=await readClipboard(); if(!data?.content)throw new Error('Clipboard empty');
  const oldSig=signature(clip.type,clip.content), newSig=signature(data.type,data.content); if(oldSig===newSig) return false;
  clip.versions.push(snapshot(clip)); trimVersions(clip); clip.type=data.type; clip.content=data.content; clip.updatedAt=Date.now(); saveClips(true); return true;
}
function restoreVersion(clip,v){ if(clip.locked)return false; const current=snapshot(clip); clip.versions.push(current); trimVersions(clip); clip.type=v.type; clip.content=v.content; clip.updatedAt=Date.now(); saveClips(true); return true; }

function getFilteredClips(){
  const ordered=[...state.clips].sort((a,b)=>a.sortOrder-b.sortOrder);
  return WeavyUI.searchClips(ordered,state.search).filter(c=>state.filter==='all'||(state.filter==='pinned'?c.pinned:c.type===state.filter));
}

let clipsView=null,clipsRenderFrame=0;
function scheduleClipsRender(){if(!clipsRenderFrame)clipsRenderFrame=requestAnimationFrame(()=>{clipsRenderFrame=0;renderClipsList()});}
function renderClipsList(){
  const root=document.getElementById('clips-list');
  const filtered=getFilteredClips();
  // Reserve the final list height before lazy rendering so anchor targets stay put.
  root.style.height=`min(400px,55vh,${Math.max(90,filtered.length*(root.clientWidth<620?92:64))}px)`;
  const count=document.getElementById('clips-count');if(count)count.textContent=`${filtered.length} / ${state.clips.length} clips`;
  if(!visibleSettingsSections.has('clips-section'))return;
  if(!clipsView)clipsView=new WeavyUI.VirtualList(root,{rowHeight:()=>root.clientWidth<620?92:64,render:clipRowMarkup,bind:bindClipRows,empty:'No matching clips. Save a clip in Weavy to get started.'});
  clipsView.set(filtered);
}
function clipRowMarkup(c){return `<div class="clip-item ${c.locked?'locked':''}" draggable="true" data-clip-id="${esc(c.id)}">
    <button type="button" class="clip-icon-btn" data-icon-for="${esc(c.id)}" title="Change icon"><span class="wc-glyph">${esc(c.icon||'📦')}</span></button>
    <div class="clip-info"><div class="clip-title-row"><button type="button" class="clip-name-text" data-name-for="${esc(c.id)}" title="Rename clip">${esc(c.name)}</button></div><div class="clip-meta">${fmt(c.updatedAt||c.createdAt)}${c.group?` · ${esc(c.group)}`:''}</div></div>
    <div class="clip-actions">
      <button type="button" class="btn-icon ${c.pinned?'active':''}" data-action="pin" data-id="${esc(c.id)}" title="${c.pinned?'Unpin · hide from dock':'Pin · show on dock'}">${c.pinned?'📌':'📍'}</button>
      <button type="button" class="btn-icon ${c.locked?'active':''}" data-action="lock" data-id="${esc(c.id)}" title="${c.locked?'Unlock · allow updates and deletion':'Lock · protect content and deletion'}">${c.locked?'🔒':'🔓'}</button>
      <button type="button" class="btn-icon" data-action="group" data-id="${esc(c.id)}" title="Edit group">🏷️</button>
      <button type="button" class="btn-icon" data-action="copy" data-id="${esc(c.id)}" title="Copy">📋</button>
      <button type="button" class="btn-icon" data-action="update" data-id="${esc(c.id)}" title="Update">🔄</button>
      <button type="button" class="btn-icon" data-action="history" data-id="${esc(c.id)}" title="Version history">🕘</button>
      <button type="button" class="btn-icon clip-delete" data-action="delete" data-id="${esc(c.id)}" title="Delete">🗑️</button>
    </div></div>`;}
function bindClipRows(root){
  root.querySelectorAll('.btn-icon').forEach(button=>{if(!button.children.length){const span=document.createElement('span');span.className='wc-glyph';span.textContent=button.textContent;button.textContent='';button.appendChild(span);}});
  root.querySelectorAll('[data-name-for]').forEach(el=>el.onclick=()=>startRename(el.dataset.nameFor,el));
  root.querySelectorAll('[data-icon-for]').forEach(el=>el.onclick=e=>openIconPicker(el.dataset.iconFor,el,e));
  root.querySelectorAll('[data-action]').forEach(b=>{b.onclick=handleClipAction;b.setAttribute('aria-label',b.title)});

  root.querySelectorAll('.clip-item').forEach(row=>{
    row.addEventListener('dragstart',e=>{if(e.target.closest('input,button')){e.preventDefault();return;}row.classList.add('wc-dragging');state.draggedId=row.dataset.clipId;e.dataTransfer.setData('text/plain',state.draggedId)});
    row.addEventListener('dragover',e=>{if(!state.draggedId)return;e.preventDefault();row.classList.add('clip-drop-target')});
    row.addEventListener('dragleave',()=>row.classList.remove('clip-drop-target'));
    row.addEventListener('drop',e=>{e.preventDefault();const id=state.draggedId,target=row.dataset.clipId;state.draggedId=null;root.querySelectorAll('.wc-dragging').forEach(el=>el.classList.remove('wc-dragging'));if(!id||id===target)return;
      const before=WeavyUI.positions(root,'.clip-item');const ordered=[...state.clips].sort((a,b)=>a.sortOrder-b.sortOrder);const from=ordered.findIndex(c=>c.id===id);if(from<0)return;const [clip]=ordered.splice(from,1);let to=ordered.findIndex(c=>c.id===target);if(to<0)return;const r=row.getBoundingClientRect();if(e.clientY>r.top+r.height/2)to++;ordered.splice(to,0,clip);ordered.forEach((c,i)=>c.sortOrder=i);state.clips=ordered;saveClips(true);renderClipsList();WeavyUI.animatePositions(root,before,'.clip-item');
    });
    row.addEventListener('dragend',()=>{row.classList.remove('wc-dragging');state.draggedId=null;root.querySelectorAll('.clip-drop-target').forEach(el=>el.classList.remove('clip-drop-target'));clipsView.draw()});
  });
}
function startRename(id,el,field='name'){
  const c=state.clips.find(x=>x.id===id);if(!c)return;
  const input=document.createElement('input');input.className='search-input clip-inline-editor';input.value=c[field]||'';input.setAttribute('aria-label',field==='name'?'Clip name':'Clip group');el.replaceWith(input);input.focus();input.select();
  let finished=false;
  const done=(cancel=false)=>{if(finished)return;finished=true;const current=state.clips.find(x=>x.id===id),v=input.value.trim();if(!cancel&&current&&(v||field==='group')){current[field]=v.slice(0,300);saveClips();}input.remove();renderClipsList();};
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();done()}if(e.key==='Escape'){e.preventDefault();done(true)}};input.onblur=()=>done();
}
function openIconPicker(id,anchor,e){ e.stopPropagation(); document.getElementById('icon-picker')?.remove(); const c=state.clips.find(x=>x.id===id);if(!c)return; const p=document.createElement('div');p.id='icon-picker';p.className='icon-picker';p.innerHTML=`<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px">${PRESET_ICONS.map(i=>`<button data-i="${i}" class="btn-icon">${i}</button>`).join('')}</div><input id="custom-icon" class="search-input" style="width:100%;margin-top:9px" maxlength="8" placeholder="Emoji or short text">`;document.body.appendChild(p);const r=anchor.getBoundingClientRect();const left=Math.min(innerWidth-p.offsetWidth-8,Math.max(8,r.left));const top=r.bottom+8+p.offsetHeight>innerHeight?Math.max(8,r.top-p.offsetHeight-8):r.bottom+8;p.style.left=left+'px';p.style.top=top+'px'; p.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>{c.icon=b.dataset.i;saveClips(true);p.remove();renderClipsList()});const ci=p.querySelector('#custom-icon');ci.onkeydown=ev=>{if(ev.key==='Enter'&&ci.value.trim()){c.icon=ci.value.trim();saveClips(true);p.remove();renderClipsList()}};setTimeout(()=>document.addEventListener('click',function close(ev){if(!p.contains(ev.target)){p.remove();document.removeEventListener('click',close)}}, {once:false}),0); }

async function handleClipAction(e){ const c=state.clips.find(x=>x.id===e.currentTarget.dataset.id);const a=e.currentTarget.dataset.action;if(!c)return;
  if(a==='group'){startRename(c.id,e.currentTarget.closest('.clip-item').querySelector('.clip-meta'),'group');return;}
  if(a==='pin'){c.pinned=!c.pinned;saveClips(true);renderClipsList();notify(c.pinned?'Pinned':'Unpinned');}
  if(a==='lock'){c.locked=!c.locked;saveClips(true);renderClipsList();notify(c.locked?'Clip locked':'Clip unlocked');}
  if(a==='copy'){try{if(c.type==='image'){const b=dataUrlToBlob(c.content);await navigator.clipboard.write([new ClipboardItem({[b.type||'image/png']:b})])}else await navigator.clipboard.writeText(String(c.content));notify('Copied')}catch{notify('Copy failed')}}
  if(a==='update'){if(c.locked){notify('Unlock clip before updating');return;}try{const changed=await updateClipFromClipboard(c);renderClipsList();notify(changed?'Clip updated':'No content change')}catch(err){notify(err.message||'Update failed')}}
  if(a==='history')openHistory(c);
  if(a==='delete'){if(c.locked){notify('Unlock clip before deleting');return;}if(state.settings.showDeleteConfirm&&!confirm(`Delete "${c.name}"?`))return;const idx=state.clips.indexOf(c);state.clips.splice(idx,1);saveClips(true);renderClipsList();notify('Clip deleted',()=>{if(state.clips.some(x=>x.id===c.id))return;state.clips.splice(Math.min(idx,state.clips.length),0,c);state.clips.forEach((item,i)=>item.sortOrder=i);saveClips(true);renderClipsList();});}
}

function openHistory(c){ document.getElementById('clip-history-overlay')?.remove(); const versions=[...ensureVersions(c)].sort((a,b)=>b.savedAt-a.savedAt); const o=document.createElement('div');o.id='clip-history-overlay';o.className='history-overlay';o.innerHTML=`<div class="history-modal"><div class="history-header"><div><strong>${esc(c.name)}</strong><div class="clip-meta">${versions.length} previous versions</div></div><button class="history-close">×</button></div><div class="history-current"><strong>Current</strong> · ${fmt(c.updatedAt||c.createdAt)}<div class="history-preview">${c.type==='image'?'[Image]':esc(preview(c.content))}</div></div>${versions.map((v,i)=>`<div class="history-item"><div><strong>Version ${versions.length-i}</strong> · ${fmt(v.savedAt)} · ${esc(v.type)}<div class="history-preview">${v.type==='image'?'[Image]':esc(preview(v.content))}</div><div class="history-diff">${esc(diffSummary(v.type,v.content,c.type,c.content))}</div></div><button class="btn-secondary" data-restore="${esc(v.id)}">Restore</button></div>`).join('')||'<div class="empty-state">No previous versions.</div>'}</div>`;document.body.appendChild(o);o.querySelector('.history-close').onclick=()=>o.remove();o.onclick=e=>{if(e.target===o)o.remove()};o.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{if(c.locked){notify('Unlock clip before restoring');return;}const v=c.versions.find(x=>x.id===b.dataset.restore);if(v&&restoreVersion(c,v)){o.remove();renderClipsList();notify('Version restored')}}); }

const EXTRA_APPEARANCE={
  'dock-shadow-softness':['dockShadowSoftness','px'],'dock-shadow-direction':['dockShadowDirection','°'],'dock-shadow-distance':['dockShadowDistance','px'],
  'dock-border-width':['dockBorderWidth','px'],'dock-border-color':['dockBorderColor',''],'dock-border-opacity':['dockBorderOpacity','%']
};
function renderExtraAppearance(){for(const [id,[key,unit]] of Object.entries(EXTRA_APPEARANCE)){document.getElementById(id).value=state.settings[key];document.getElementById(id+'-value').textContent=state.settings[key]+unit;}}
let customPresets=[],selectedPreset='';
const allPresets=()=>[...WeavyAppearance.presets,...customPresets];
function applySelectedPreset(){const p=allPresets().find(p=>p.id===selectedPreset);if(!p)return;Object.assign(state.settings,p.values);saveSettings();renderSettings();}
function renderPresets(){
  const list=allPresets();let selected=list.find(p=>p.id===selectedPreset);
  if(!selected){selected=list.find(p=>WeavyAppearance.equal(p.values,state.settings));selectedPreset=selected?.id||'';}
  const select=document.getElementById('appearance-preset');
  select.innerHTML='<option value="" disabled>Custom appearance</option><optgroup label="Built-in">'+WeavyAppearance.presets.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')+'</optgroup>'+(customPresets.length?'<optgroup label="My presets">'+customPresets.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')+'</optgroup>':'');
  select.value=selectedPreset;
  const own=!!selected?.id.startsWith('custom-');
  document.getElementById('preset-apply').disabled=!selected;
  const nameInput=document.getElementById('preset-name');if(own&&!nameInput.value)nameInput.value=selected.name;
  document.getElementById('preset-update').disabled=!own;
  document.getElementById('preset-delete').disabled=!own;
  const modified=selected&&!WeavyAppearance.equal(selected.values,state.settings);
  document.getElementById('preset-status').textContent=modified?'Modified · update your preset or save a new one.':selected?'Preset: '+selected.name+' · includes dock and settings-page theme.':'Save the current dock and page theme as a preset.';
}
async function persistPreset(operation){
  const name=document.getElementById('preset-name').value.trim();
  if(operation!=='delete'&&!name){document.getElementById('preset-name').focus();notify('Enter a preset name');return;}
  if(operation!=='create'&&!selectedPreset.startsWith('custom-'))return;
  if(operation==='delete'&&!confirm('Delete this custom preset? Your current appearance will stay the same.'))return;
  const buttons=['preset-create','preset-update','preset-delete'];buttons.forEach(id=>document.getElementById(id).disabled=true);
  try{
    const result=await chrome.runtime.sendMessage({action:'presetMutation',operation,id:selectedPreset,name,values:WeavyAppearance.snapshot(state.settings)});
    if(!result?.success)throw new Error(result?.error||'Could not save preset');
    customPresets=result.presets;selectedPreset=result.selectedId||'';
    if(operation==='delete')document.getElementById('preset-name').value='';
    notify(operation==='delete'?'Preset deleted':operation==='update'?'Preset updated':'Preset created');
  }catch(error){notify(error.message)}finally{document.getElementById('preset-create').disabled=false;renderPresets();}
}
function openQuickFind(){WeavyUI.palette({clips:()=>getFilteredClipsForPalette(),onChoose:async clip=>{try{if(clip.type==='image'){const b=dataUrlToBlob(clip.content);await navigator.clipboard.write([new ClipboardItem({[b.type]:b})])}else await navigator.clipboard.writeText(String(clip.content));notify('Copied · paste into Weavy')}catch{notify('Could not copy clip')}}});}
function getFilteredClipsForPalette(){return [...state.clips].sort((a,b)=>a.sortOrder-b.sortOrder);}
let currentSettingsSection = '';
const sectionLinks = [];
const visibleSettingsSections = new Set();
function markCurrentSection(id) {
  if (id === currentSettingsSection) return;
  currentSettingsSection = id;
  for (const {section,link} of sectionLinks) {
    if (section.id === id) link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  }
  const link=sectionLinks.find(item=>item.section.id===id)?.link;
  if(link){
    // Scroll only the navigation strip; scrolling an anchor into view can cancel
    // the page's ongoing smooth scroll or move the page unexpectedly.
    const nav=link.parentElement,a=nav.getBoundingClientRect(),b=link.getBoundingClientRect();
    if(b.left<a.left)nav.scrollLeft-=a.left-b.left;
    else if(b.right>a.right)nav.scrollLeft+=b.right-a.right;
  }
}
function refreshSection(id) {
  if (id === 'clips-section') renderClipsList();
  if (id === 'dock-position-section') {updatePositionPreview();refreshCurrentPosition();}
  if (id === 'diagnostics-section') refreshDiagnostics();
}
function initNavigation() {
  const nav = document.getElementById('settings-nav');
  const sections = [...document.querySelectorAll('.container > section')];
  const jump = section => {
    markCurrentSection(section.id);
    // Prepare deferred content before scrolling so the destination has its final size.
    visibleSettingsSections.add(section.id);
    refreshSection(section.id);
    section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  };
  sections.forEach((section,index) => {
    section.hidden = false;
    if (!section.id) section.id = 'settings-section-'+index;
    const heading = section.querySelector('h2');
    heading.id = section.id+'-title';
    section.setAttribute('aria-labelledby',heading.id);
    const link = document.createElement('a');
    link.id = 'settings-link-'+index;
    link.href = '#'+section.id;
    link.textContent = heading.textContent;
    link.onclick = e => {e.preventDefault();jump(section);};
    link.onkeydown = e => {
      let next;
      if (e.key === 'ArrowRight') next = (index+1)%sections.length;
      if (e.key === 'ArrowLeft') next = (index+sections.length-1)%sections.length;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = sections.length-1;
      if (next === undefined) return;
      e.preventDefault();sectionLinks[next].link.focus({preventScroll:true});jump(sections[next]);
    };
    nav.appendChild(link);sectionLinks.push({section,link});
  });
  markCurrentSection(sections[0]?.id);
  if ('IntersectionObserver' in globalThis) {
    const visibility = new IntersectionObserver(entries => {
      for (const {target,isIntersecting} of entries) {
        if (isIntersecting) {
          const entered = !visibleSettingsSections.has(target.id);
          visibleSettingsSections.add(target.id);
          if (entered) refreshSection(target.id);
        } else visibleSettingsSections.delete(target.id);
      }
      updatePreviewAlignment();
    },{rootMargin:'200px 0px'});
    sections.forEach(section=>visibility.observe(section));
    window.addEventListener('pagehide',()=>visibility.disconnect(),{once:true});
  } else {
    sections.forEach(section=>visibleSettingsSections.add(section.id));
    sections.forEach(section=>refreshSection(section.id));
  }
  const observer = new ResizeObserver(() => {updateTopbarOffset();updatePreviewAlignment();updatePositionPreview()});
  observer.observe(document.querySelector('.container'));
  observer.observe(document.querySelector('.settings-topbar'));
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
  updateTopbarOffset();
}
function updateSectionNavigation() {
  if (!sectionLinks.length) return;
  const top = document.querySelector('.settings-topbar').getBoundingClientRect().bottom+20;
  let active = sectionLinks[0];
  for (const item of sectionLinks) {
    if (item.section.getBoundingClientRect().top <= top) active = item;
    else break;
  }
  const height = document.documentElement.scrollHeight;
  if (height > innerHeight && window.scrollY+innerHeight >= height-2) active = sectionLinks.at(-1);
  markCurrentSection(active.section.id);
}
function refreshVisibleSections() {
  for (const id of ['dock-position-section','diagnostics-section']) {
    if (visibleSettingsSections.has(id)) refreshSection(id);
  }
}
function updateTopbarOffset(){
  const bar=document.querySelector('.settings-topbar');
  if(!bar)return;
  document.documentElement.style.setProperty('--settings-topbar-offset',Math.ceil(bar.getBoundingClientRect().height+12)+'px');
}
let previewFrame=0;
function updatePreviewAlignment(){
  if(previewFrame)return;
  previewFrame=requestAnimationFrame(()=>{previewFrame=0;updateSectionNavigation();const stage=document.querySelector('.preview-stage');if(!stage)return;const r=stage.getBoundingClientRect();stage.style.backgroundPosition=`${-r.left}px ${-r.top}px`;});
}
window.addEventListener('scroll',updatePreviewAlignment,{passive:true});
window.addEventListener('resize',updatePreviewAlignment);

function renderSettings(){
  document.getElementById('settings-open-mode').value=state.settings.settingsOpenMode;
  const s=state.settings;
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v}; const check=(id,v)=>{const e=document.getElementById(id);if(e)e.checked=!!v};
  set('accent-color',s.accentColor);document.getElementById('accent-color-value').textContent=s.accentColor;set('bg-color',s.bgColor);document.getElementById('bg-color-value').textContent=s.bgColor;
  set('border-radius',s.borderRadius);document.getElementById('border-radius-value').textContent=s.borderRadius+'px';set('dock-button-size',s.dockButtonSize);set('accent-mode',s.accentMode);set('dock-opacity',s.dockOpacity);document.getElementById('dock-opacity-value').textContent=s.dockOpacity+'%';set('dock-blur',s.dockBlur);document.getElementById('dock-blur-value').textContent=s.dockBlur+'px';set('dock-shadow',s.dockShadow);document.getElementById('dock-shadow-value').textContent=Math.round(s.dockShadow/48*100)+'%';
  check('dock-auto-hide',s.dockAutoHide);
  check('show-delete-confirm',s.showDeleteConfirm);check('capture-selection-before-save',s.captureSelectionBeforeSave);check('verify-selection-copy',s.verifySelectionCopy);check('smart-allow-debugger',s.smartAllowDebugger);check('restore-clipboard-after-debugger',s.restoreClipboardAfterDebuggerPaste);check('quick-paste-enabled',s.quickPasteEnabled);
  document.querySelectorAll('[name="capture-selection-method"]').forEach(r=>r.checked=r.value===s.captureSelectionMethod);document.querySelectorAll('[name="paste-method"]').forEach(r=>r.checked=r.value===s.pasteMethod);document.querySelectorAll('[name="site-mode"]').forEach(r=>r.checked=r.value===s.siteMode);
  set('duplicate-behavior',s.duplicateBehavior);set('max-versions',s.maxVersions);document.getElementById('capture-method-setting').classList.toggle('disabled',!s.captureSelectionBeforeSave);
  document.querySelectorAll('#capture-method-setting input').forEach(input=>input.disabled=!s.captureSelectionBeforeSave);
  set('default-dock-h-anchor',s.defaultDockHorizontalAnchor);set('default-dock-x',s.defaultDockHorizontalOffset);set('default-dock-v-anchor',s.defaultDockVerticalAnchor);set('default-dock-y',s.defaultDockVerticalOffset);
  set('dock-overflow-mode',s.dockOverflowMode);document.getElementById('dock-max-width').disabled=s.dockOverflowMode!=='scroll';set('dock-max-width',s.dockMaxWidth);check('clamp-dock',s.clampDock);check('snap-dock',s.snapDock);check('per-project-position',s.perProjectPosition);check('show-drag-guides',s.showDragGuides);
  renderExtraAppearance();renderPresets();
  updateAppearancePreview();updatePageAppearance();updatePositionPreview();refreshVisibleSections();
}
const PAGE_FIELDS = {
  'settings-bg-color':'settingsBgColor', 'settings-panel-color':'settingsPanelColor',
  'settings-accent-color':'settingsAccentColor', 'settings-pattern-spacing':'settingsPatternSpacing',
  'settings-pattern-opacity':'settingsPatternOpacity', 'settings-pattern-enabled':'settingsPatternEnabled'
};
function updatePageAppearance() {
  const s = state.settings, root = document.documentElement;
  const fg = WeavyAppearance.foreground(s.settingsPanelColor), pageFg = WeavyAppearance.foreground(s.settingsBgColor);
  const vars = {'--page-bg':s.settingsBgColor,'--panel-bg':s.settingsPanelColor,
    '--page-fg':pageFg,'--panel-fg':fg,'--panel-muted':`rgba(${WeavyAppearance.rgb(fg).join(',')},.65)`,
    '--ui-accent':s.settingsAccentColor,'--ui-on-accent':WeavyAppearance.foreground(s.settingsAccentColor),
    '--pattern-size':s.settingsPatternSpacing+'px',
    '--pattern-color':`rgba(${WeavyAppearance.rgb(pageFg).join(',')},${s.settingsPatternEnabled ? s.settingsPatternOpacity/100 : 0})`};
  for (const [key,value] of Object.entries(vars)) root.style.setProperty(key,value);
  root.style.colorScheme = fg === '#ffffff' ? 'dark' : 'light';
  for (const [id,key] of Object.entries(PAGE_FIELDS)) {
    const el = document.getElementById(id);
    if (el.type === 'checkbox') el.checked = s[key]; else el.value = s[key];
    const label = document.getElementById(id+'-value');
    if (label) label.textContent = s[key] + (id.endsWith('spacing') ? 'px' : id.endsWith('opacity') ? '%' : '');
  }
  document.getElementById('settings-pattern-spacing').disabled = !s.settingsPatternEnabled;
  document.getElementById('settings-pattern-opacity').disabled = !s.settingsPatternEnabled;
  updatePreviewAlignment();
}
function updateAppearancePreview() {
  const s = state.settings;
  const preview = document.getElementById('dock-preview-box');
  WeavyAppearance.apply(preview,s);
  WeavyAppearance.centerGlyphs(preview);
  document.getElementById('blur-help').textContent = s.dockBlur > 0 && s.dockOpacity === 100
    ? 'Blur is enabled but hidden by the opaque background. Try 65–85% background opacity.'
    : 'Blur softens content behind the dock. Background opacity never fades buttons or text.';
}
function updatePositionPreview(){
  const vp=document.getElementById('position-preview'),dock=document.getElementById('position-preview-dock');
  if(!vp||!dock)return;
  const s=state.settings,w=vp.clientWidth,h=vp.clientHeight,dw=dock.offsetWidth||180,dh=dock.offsetHeight||42;
  let x=s.defaultDockHorizontalAnchor==='left'?s.defaultDockHorizontalOffset:s.defaultDockHorizontalAnchor==='right'?window.innerWidth-dw-s.defaultDockHorizontalOffset:window.innerWidth/2+s.defaultDockHorizontalOffset;
  let y=s.defaultDockVerticalAnchor==='top'?s.defaultDockVerticalOffset:s.defaultDockVerticalAnchor==='center'?window.innerHeight/2+s.defaultDockVerticalOffset:window.innerHeight-dh-s.defaultDockVerticalOffset;
  const scale=.28;
  x=Math.max(4,Math.min(w-dw-4,(x-window.innerWidth/2)*scale+w/2));
  y=Math.max(4,Math.min(h-dh-4,(y-window.innerHeight/2)*scale+h/2));
  dock.style.left=x+'px';dock.style.top=y+'px';
}

function bindSetting(id,key,type='value',after){const e=document.getElementById(id);if(!e)return;e.addEventListener(type==='checked'?'change':'input',()=>{let v=type==='checked'?e.checked:e.value;if(e.type==='number'||e.type==='range')v=Number(v);state.settings[key]=v;saveSettings();after?.();renderPresets();});}
function attachListeners(){
  for(const [id,[key]] of Object.entries(EXTRA_APPEARANCE)) bindSetting(id,key,'value',()=>{renderExtraAppearance();updateAppearancePreview()});
  bindSetting('dock-auto-hide','dockAutoHide','checked');
  document.getElementById('appearance-preset').onchange=()=>{
    const preset=allPresets().find(p=>p.id===document.getElementById('appearance-preset').value);
    if(!preset)return;selectedPreset=preset.id;Object.assign(state.settings,preset.values);saveSettings();renderSettings();
    document.getElementById('preset-name').value=preset.id.startsWith('custom-')?preset.name:'';
  };
  document.getElementById('preset-apply').onclick=applySelectedPreset;
  document.getElementById('preset-create').onclick=()=>persistPreset('create');
  document.getElementById('preset-update').onclick=()=>persistPreset('update');
  document.getElementById('preset-delete').onclick=()=>persistPreset('delete');
  document.getElementById('quick-find-btn').onclick=openQuickFind;
  bindSetting('settings-open-mode','settingsOpenMode');
  document.getElementById('apply-defaults-btn').onclick=applyBundledDefaults;
  document.getElementById('retry-clips-btn').onclick=()=>clipStore.flush();
  document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{
    state.filter=button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    document.getElementById('clips-list').scrollTop=0;renderClipsList();
  });
  document.addEventListener('keydown',e=>{if(e.altKey&&!e.ctrlKey&&!e.metaKey&&e.code==='KeyK'){e.preventDefault();openQuickFind()}});
  for (const [id,key] of Object.entries(PAGE_FIELDS)) {
    bindSetting(id,key,id.endsWith('enabled') ? 'checked' : 'value',updatePageAppearance);
  }
  document.getElementById('reset-page-appearance-btn').onclick = () => {
    Object.values(PAGE_FIELDS).forEach(key => state.settings[key] = WeavyAppearance.defaults[key]);
    updatePageAppearance(); saveSettings(); notify('Settings page appearance reset');
  };
  document.getElementById('clips-search').addEventListener('input',e=>{state.search=e.target.value;document.getElementById('clips-list').scrollTop=0;renderClipsList()});
  ['accent-color','bg-color'].forEach(id=>bindSetting(id,id==='accent-color'?'accentColor':'bgColor','value',()=>{document.getElementById(id+'-value').textContent=document.getElementById(id).value;updateAppearancePreview();updatePositionPreview()}));
  bindSetting('border-radius','borderRadius','value',()=>{document.getElementById('border-radius-value').textContent=state.settings.borderRadius+'px';updateAppearancePreview()});bindSetting('dock-button-size','dockButtonSize','value',()=>{updateAppearancePreview()});bindSetting('accent-mode','accentMode','value',()=>{updateAppearancePreview()});bindSetting('dock-opacity','dockOpacity','value',()=>{document.getElementById('dock-opacity-value').textContent=state.settings.dockOpacity+'%';updateAppearancePreview()});bindSetting('dock-blur','dockBlur','value',()=>{document.getElementById('dock-blur-value').textContent=state.settings.dockBlur+'px';updateAppearancePreview()});bindSetting('dock-shadow','dockShadow','value',()=>{document.getElementById('dock-shadow-value').textContent=Math.round(state.settings.dockShadow/48*100)+'%';updateAppearancePreview()});
  bindSetting('show-delete-confirm','showDeleteConfirm','checked');bindSetting('capture-selection-before-save','captureSelectionBeforeSave','checked',()=>renderSettings());bindSetting('verify-selection-copy','verifySelectionCopy','checked');bindSetting('smart-allow-debugger','smartAllowDebugger','checked');bindSetting('restore-clipboard-after-debugger','restoreClipboardAfterDebuggerPaste','checked');bindSetting('quick-paste-enabled','quickPasteEnabled','checked');
  document.querySelectorAll('[name="capture-selection-method"]').forEach(r=>r.onchange=()=>{if(r.checked){state.settings.captureSelectionMethod=r.value;saveSettings()}});document.querySelectorAll('[name="paste-method"]').forEach(r=>r.onchange=()=>{if(r.checked){state.settings.pasteMethod=r.value;saveSettings()}});document.querySelectorAll('[name="site-mode"]').forEach(r=>r.onchange=()=>{if(r.checked){state.settings.siteMode=r.value;saveSettings()}});
  bindSetting('duplicate-behavior','duplicateBehavior');bindSetting('max-versions','maxVersions');
  [['default-dock-h-anchor','defaultDockHorizontalAnchor'],['default-dock-v-anchor','defaultDockVerticalAnchor'],['dock-overflow-mode','dockOverflowMode']].forEach(([id,k])=>bindSetting(id,k,'value',()=>{document.getElementById('dock-max-width').disabled=state.settings.dockOverflowMode!=='scroll';updatePositionPreview()}));
  [['default-dock-x','defaultDockHorizontalOffset'],['default-dock-y','defaultDockVerticalOffset'],['dock-max-width','dockMaxWidth']].forEach(([id,k])=>bindSetting(id,k,'value',()=>{updatePositionPreview()}));
  bindSetting('clamp-dock','clampDock','checked');bindSetting('snap-dock','snapDock','checked');bindSetting('per-project-position','perProjectPosition','checked');bindSetting('show-drag-guides','showDragGuides','checked');
  document.querySelectorAll('.nudge-btn').forEach(b=>b.onclick=()=>nudge(b.dataset.target,b.dataset.dir));
  document.getElementById('apply-default-dock-btn').onclick=()=>resetOpenWeavyDocks();
  document.getElementById('use-current-as-default-btn').onclick=useCurrentAsDefault;
  document.getElementById('factory-position-btn').onclick=()=>{Object.assign(state.settings,{defaultDockHorizontalAnchor:'center',defaultDockHorizontalOffset:140,defaultDockVerticalAnchor:'bottom',defaultDockVerticalOffset:11});saveSettings();renderSettings();notify('Factory position restored')};
  document.getElementById('reset-appearance-btn').onclick=()=>{['accentColor','bgColor','borderRadius','dockButtonSize','dockOpacity','dockBlur','dockShadow','accentMode','dockShadowSoftness','dockShadowDirection','dockShadowDistance','dockBorderWidth','dockBorderColor','dockBorderOpacity'].forEach(k=>state.settings[k]=DEFAULT_SETTINGS[k]);saveSettings();renderSettings();notify('Appearance reset')};
  document.getElementById('import-btn').onclick=()=>document.getElementById('import-file').click();document.getElementById('import-file').onchange=handleImport;document.getElementById('export-btn').onclick=handleExport;document.getElementById('clear-btn').onclick=handleClear;
  document.getElementById('refresh-diagnostics-btn').onclick=refreshDiagnostics;document.getElementById('copy-diagnostics-btn').onclick=copyDiagnostics;
}
async function resetOpenWeavyDocks(){
  try {
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'applyDefaultDockAll' }, response => {
        if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
        if (!response?.success) { reject(new Error(response?.error || 'No Weavy tabs')); return; }
        resolve(response);
      });
    });
    const count = Number(result.tabs || 0);
    notify(count === 1 ? 'Dock reset in Weavy' : `Dock reset in ${count} Weavy tabs`);
    refreshCurrentPosition();
  } catch (error) {
    notify(error.message === 'No Weavy tabs' ? 'Open a Weavy tab first' : 'Could not reset dock');
  }
}

function nudge(target,dir){
  const step=Number(document.getElementById('dock-nudge-step').value||5);
  let x=Number(state.settings.defaultDockHorizontalOffset||0),y=Number(state.settings.defaultDockVerticalOffset||0);
  if(dir==='left')x-=step;if(dir==='right')x+=step;
  if(dir==='up')y+=(state.settings.defaultDockVerticalAnchor==='bottom'?step:-step);
  if(dir==='down')y+=(state.settings.defaultDockVerticalAnchor==='bottom'?-step:step);
  state.settings.defaultDockHorizontalOffset=x;state.settings.defaultDockVerticalOffset=y;
  saveSettings();renderSettings();
}

async function refreshCurrentPosition(){
  const el=document.getElementById('current-dock-position');if(!el)return;
  try{const g=await messageWeavy({action:'getDockGeometry'});el.textContent=`Current dock: left ${Math.round(g.rect.left)} px · top ${Math.round(g.rect.top)} px · ${Math.round(g.rect.width)}×${Math.round(g.rect.height)} px`;}
  catch{el.textContent='Current dock: open Weavy to read position.';}
}
async function useCurrentAsDefault(){try{const g=await messageWeavy({action:'getDockGeometry'});const x=g.rect.left+g.rect.width/2-g.viewport.width/2;const bottom=g.viewport.height-(g.rect.top+g.rect.height);state.settings.defaultDockHorizontalAnchor='center';state.settings.defaultDockHorizontalOffset=Math.round(x);state.settings.defaultDockVerticalAnchor='bottom';state.settings.defaultDockVerticalOffset=Math.max(0,Math.round(bottom));saveSettings();renderSettings();notify('Current dock position saved as default')}catch{notify('Open a Weavy tab first')}}
function messageWeavy(message){return new Promise((resolve,reject)=>chrome.tabs.query({url:'*://app.weavy.ai/*',currentWindow:true},tabs=>{const tab=tabs.find(t=>t.active)||tabs[0];if(!tab){reject(new Error('No Weavy tab'));return;}chrome.tabs.sendMessage(tab.id,message,r=>{if(chrome.runtime.lastError||!r){reject(new Error(chrome.runtime.lastError?.message||'No response'));return;}resolve(r)})}))}


async function handleImport(e){const file=e.target.files[0];e.target.value='';return WeavyBackup.importFile(file,{before:()=>clipStore.flush(),report:notify});}
function handleExport(){return WeavyBackup.exportFile({before:()=>clipStore.flush(),report:notify});}
async function applyBundledDefaults(){
  if(!confirm('Apply bundled settings and add missing starter clips? Existing clips will be kept.'))return;
  if(!await clipStore.flush())return;
  const result=await chrome.runtime.sendMessage({action:'applyFactoryDefaults'});
  notify(result?.success?`Defaults applied · ${result.added} starter clips added`:'Could not apply defaults: '+(result?.error||'Unknown error'));
}

function handleClear(){if(!confirm('Delete ALL clips? Export a backup first if needed.'))return;if(state.settings.showDeleteConfirm&&!confirm('Really delete all clips?'))return;state.clips=[];saveClips(true);renderClipsList();notify('All clips cleared')}

let diagnosticsInFlight=null;
function refreshDiagnostics(){
  if(!diagnosticsInFlight)diagnosticsInFlight=collectDiagnostics().finally(()=>{diagnosticsInFlight=null});
  return diagnosticsInFlight;
}
async function collectDiagnostics(){const root=document.getElementById('diagnostics');if(!root)return;const versions=state.clips.reduce((n,c)=>n+(c.versions?.length||0),0),locked=state.clips.filter(c=>c.locked).length,pinned=state.clips.filter(c=>c.pinned).length;const bytes=await new Promise(r=>chrome.storage.local.getBytesInUse(null,n=>r(n||0)));let runtime=null;try{runtime=await messageWeavy({action:'getRuntimeDiagnostics'})}catch{}const capture=runtime?.capture;const captureText=capture?`${capture.ok?'OK':'Failed'} · ${capture.method}${capture.verified?' · verified':''}${capture.copyEventSeen?' · copy event':''}`:'No runtime capture yet';const nativeTypes=capture?.nativeTypes?.length?capture.nativeTypes.join(', '):'—';const data=[['Version',chrome.runtime.getManifest().version],['Clips',String(state.clips.length)],['Pinned',String(pinned)],['Locked',String(locked)],['Stored versions',String(versions)],['Storage',formatBytes(bytes)],['Save method',state.settings.captureSelectionMethod],['Last selection copy',captureText],['Native copy types',nativeTypes],['Paste method',state.settings.pasteMethod],['Dock default',`${state.settings.defaultDockHorizontalAnchor} ${state.settings.defaultDockHorizontalOffset}px / ${state.settings.defaultDockVerticalAnchor} ${state.settings.defaultDockVerticalOffset}px`],['Current Weavy path',runtime?.projectKey||'—'],['Schema',String(state.settings.settingsSchemaVersion)]];root.innerHTML=data.map(([k,v])=>`<div class="diag-row"><span>${esc(k)}</span><code>${esc(v)}</code></div>`).join('');}
function formatBytes(n){if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(2)+' MB'}
async function copyDiagnostics(){await refreshDiagnostics();const text=[...document.querySelectorAll('.diag-row')].map(r=>`${r.children[0].textContent}: ${r.children[1].textContent}`).join('\n');await navigator.clipboard.writeText(text);notify('Diagnostics copied')}
function notify(message,undo){document.querySelector('.toast')?.remove();const t=document.createElement('div');t.className='toast';t.setAttribute('role','status');const text=document.createElement('span');text.textContent=message;t.appendChild(text);if(undo){const button=document.createElement('button');button.textContent='Undo';button.onclick=()=>{undo();t.remove()};t.appendChild(button)}document.body.appendChild(t);setTimeout(()=>t.remove(),undo?6000:2200)}
function renderUI(){renderSettings();renderClipsList()}
async function init(){await chrome.runtime.sendMessage({action:'initializeDefaults'});chrome.storage.local.get(['clips','clipsRevision','settings','appearancePresets'],r=>{state.clips=r.clips||[];clipStore.reset(state.clips,r.clipsRevision);customPresets=WeavyAppearance.sanitizePresets(r.appearancePresets);state.settings=normalizeSettings(r.settings||{});settingsSnapshot={...state.settings};document.querySelectorAll('[data-version]').forEach(el=>el.textContent='v'+chrome.runtime.getManifest().version);normalizeClips();renderUI();attachListeners();initNavigation();updatePreviewAlignment()})}
chrome.storage.onChanged.addListener((ch,area)=>{
  if(area !== 'local') return;
  if(ch.appearancePresets){customPresets=WeavyAppearance.sanitizePresets(ch.appearancePresets.newValue);renderPresets()}
  if(ch.clips){clipStore.receive(ch.clips.newValue||[],ch.clipsRevision?.newValue);normalizeClips()}
  if(ch.settings){
    if (Number(ch.settings.newValue?._revision || 0) < acknowledgedRevision) return;
    const next = normalizeSettings(ch.settings.newValue||{});
    settingsJobs.forEach(patch=>Object.assign(next,patch));
    const changed = Object.keys(next).some(k=>next[k]!==state.settings[k]);
    state.settings=next;
    settingsSnapshot={...next};
    if(changed) renderSettings();
  }
});
// Hand remaining edits to the worker when the settings tab closes.
window.addEventListener('pagehide',()=>{
  clipStore.flush();
  if (settingsJobs.length > 1) chrome.runtime.sendMessage({action:'patchSettings',patch:Object.assign({},...settingsJobs)}).catch(()=>{});
});
window.addEventListener('resize',()=>{updatePositionPreview();scheduleClipsRender()});
init();
