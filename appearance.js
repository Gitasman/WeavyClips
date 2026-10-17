// Shared by the content script and options page: one appearance model.
(() => {
  const defaults = Object.freeze({
    accentColor: '#ffffff', bgColor: '#1e1e1e', borderRadius: 11,
    dockButtonSize: 36, dockOpacity: 0, dockBlur: 5, dockShadow: 41, accentMode: 'normal',
    dockShadowSoftness: 18, dockShadowDirection: 90, dockShadowDistance: 3.25,
    dockBorderWidth: 1, dockBorderColor: '#ffffff', dockBorderOpacity: 6,
    settingsBgColor: '#1e1e1e', settingsPanelColor: '#2b2b2b', settingsAccentColor: '#ffffff',
    settingsPatternSpacing: 16, settingsPatternOpacity: 11, settingsPatternEnabled: true
  });
  const ranges = {borderRadius:[0,24], dockButtonSize:[30,42], dockOpacity:[0,100],
    dockBlur:[0,24], dockShadow:[0,48], dockShadowSoftness:[0,80], dockShadowDirection:[0,360], dockShadowDistance:[0,40], dockBorderWidth:[0,6], dockBorderOpacity:[0,100], settingsPatternSpacing:[8,64], settingsPatternOpacity:[0,30]};
  const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  const foreground = hex => {
    const [r,g,b] = rgb(hex).map(c => {c/=255; return c<=.04045 ? c/12.92 : ((c+.055)/1.055)**2.4;});
    return .2126*r+.7152*g+.0722*b > .179 ? '#16161d' : '#ffffff';
  };
  function normalize(raw = {}) {
    const s = {...defaults, ...raw};
    for (const key of ['accentColor','bgColor','settingsBgColor','settingsPanelColor','settingsAccentColor','dockBorderColor']) {
      if (!/^#[0-9a-f]{6}$/i.test(s[key])) s[key] = defaults[key];
    }
    for (const [key,[min,max]] of Object.entries(ranges)) {
      const value = s[key] == null || s[key] === '' ? NaN : Number(s[key]);
      s[key] = Number.isFinite(value) ? Math.min(max,Math.max(min,value)) : defaults[key];
    }
    if (!['minimal','normal','strong'].includes(s.accentMode)) s.accentMode = defaults.accentMode;
    s.settingsPatternEnabled = s.settingsPatternEnabled !== false;
    return s;
  }
  function apply(target, raw) {
    const s = normalize(raw), color = rgb(s.bgColor), strength = s.dockShadow/48;
    const radians = s.dockShadowDirection * Math.PI / 180;
    const offsetX = +(Math.cos(radians)*s.dockShadowDistance).toFixed(3);
    const offsetY = +(Math.sin(radians)*s.dockShadowDistance).toFixed(3);
    const values = {
      '--wc-accent':s.accentColor, '--wc-accent-rgb':rgb(s.accentColor).join(', '),
      '--wc-on-accent':foreground(s.accentColor), '--wc-on-bg':foreground(s.bgColor),
      '--wc-bg':s.bgColor, '--wc-surface':`rgba(${color.join(', ')}, ${s.dockOpacity/100})`,
      '--wc-radius':s.borderRadius+'px', '--wc-button-radius':Math.max(0,s.borderRadius-1)+'px',
      '--wc-btn-size':s.dockButtonSize+'px', '--wc-blur':s.dockBlur ? `blur(${s.dockBlur}px)` : 'none',
      '--wc-border-width':s.dockBorderWidth+'px',
      '--wc-border-color':`rgba(${rgb(s.dockBorderColor).join(', ')}, ${s.dockBorderOpacity/100})`,
      '--wc-shadow':s.dockShadow === 0 ? 'none' : `${offsetX}px ${offsetY}px ${s.dockShadowSoftness}px rgba(0,0,0,${.75*strength})`
    };
    for (const [key,value] of Object.entries(values)) target.style.setProperty(key,value);
    if (target.id === 'wc-dock' || target.id === 'dock-preview-box') target.dataset.accentMode = s.accentMode;
  }
  const keys = Object.freeze(Object.keys(defaults));
  const snapshot = raw => {const s=normalize(raw);return Object.fromEntries(keys.map(k=>[k,s[k]]));};
  const presets = Object.freeze([
    {id:'builtin-default',name:'Default',values:snapshot(defaults)},
    {id:'builtin-glass',name:'Glass',values:snapshot({...defaults,dockOpacity:68,dockBlur:18,dockShadow:18,dockShadowSoftness:28,dockShadowDistance:8,dockBorderOpacity:22})},
    {id:'builtin-solid',name:'Solid',values:snapshot({...defaults,dockOpacity:100,dockBlur:0,dockShadow:0,dockBorderWidth:1,dockBorderOpacity:30})},
    {id:'builtin-compact',name:'Compact',values:snapshot({...defaults,dockButtonSize:30,borderRadius:8,dockBlur:0,dockShadow:8,dockShadowSoftness:10,dockShadowDistance:2})}
  ]);
  const equal = (a,b) => {const x=normalize(a),y=normalize(b);return keys.every(k=>x[k]===y[k]);};
  const icons = Object.freeze({library:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg>'});
  const glyphFont = '400 18px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui';
  const glyphOffsets = new Map();
  let glyphContext;
  // Center the painted glyph, rather than the font's baseline box. Emoji metrics
  // differ between macOS, Windows and Linux; a fixed pixel nudge cannot fit all.
  function centerGlyphs(root) {
    const glyphs = root?.querySelectorAll('.wc-glyph');
    if (!glyphs?.length) return;
    if (glyphContext === undefined) {
      try { glyphContext = document.createElement('canvas').getContext('2d'); }
      catch { glyphContext = null; }
    }
    if (!glyphContext) return;
    glyphContext.font = glyphFont;
    for (const glyph of glyphs) {
      const text = glyph.textContent;
      if (!glyphOffsets.has(text)) {
        const m = glyphContext.measureText(text);
        const offset = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent - m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 2;
        if (!Number.isFinite(offset)) continue;
        if (glyphOffsets.size >= 256) glyphOffsets.clear();
        glyphOffsets.set(text, Math.max(-6, Math.min(6, offset)));
      }
      glyph.style.setProperty('--wc-glyph-offset', glyphOffsets.get(text)+'px');
    }
  }
  const sanitizePresets = value => {
    if (!Array.isArray(value)) return [];
    const ids=new Set();
    return value.filter(p=>p && typeof p.id==='string' && p.id.startsWith('custom-') && !ids.has(p.id) && ids.add(p.id) && typeof p.name==='string' && p.name.trim()).map(p=>({id:p.id,name:p.name.trim().slice(0,60),values:snapshot(p.values||{})}));
  };
  globalThis.WeavyAppearance = Object.freeze({defaults, keys, normalize, apply, foreground, rgb, snapshot, presets, equal, sanitizePresets, icons, centerGlyphs});
})();
