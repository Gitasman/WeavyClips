// Regression tests using real extension JS and a minimal DOM / Chrome API adapter.
// Does not substitute for a live Chrome/Weavy visual or clipboard integration test.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(r=>setTimeout(r,0));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let passed=0;function check(ok,message){assert.ok(ok,message);passed++;console.log('PASS '+message)}
class Element {
 constructor(attrs={}) {Object.assign(this,attrs);this.style={setProperty(k,v){this[k]=String(v)},getPropertyValue(k){return this[k]||''}};this.dataset={};this.listeners={};this.classList={toggle(){},add(){},remove(){}};this.clientWidth=900;this.clientHeight=210;this.offsetWidth=240;this.offsetHeight=52;this.textContent='';this._value=attrs.value||'';}
 set value(v){this._value=String(v)}get value(){return this._value}
 addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
 dispatch(name){for(const fn of this.listeners[name]||[])fn({target:this});this['on'+name]?.({target:this})}
 setAttribute(k,v){this[k]=String(v)}
 querySelectorAll(){return []}querySelector(){return null}appendChild(){}remove(){}
 matches(){return false}contains(){return false}
 getBoundingClientRect(){return {left:20,top:100,right:260,bottom:152,width:240,height:52}}
}
function documentFixture(){
 const nodes=[];for(const tag of read('options.html').matchAll(/<(?:input|select|div|span|code|button|header|footer|p|small)[^>]*>/g)){
  const attrs={};for(const a of tag[0].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]||'';
  nodes.push(new Element(attrs));
 }
 const byId=new Map(nodes.filter(n=>n.id).map(n=>[n.id,n]));
 return {nodes,byId,readyState:'loading',documentElement:new Element(),body:new Element(),addEventListener(){},
  getElementById(id){return byId.get(id)||null},createElement:()=>new Element(),querySelector(){return null},
  querySelectorAll(selector){const match=selector.match(/^\[name="(.*)"\]$/);if(match)return nodes.filter(n=>n.name===match[1]);if(selector==='[data-version]')return nodes.filter(n=>'data-version' in n);return []}
 };
}
const events=[];const store={settings:{settingsSchemaVersion:8,borderRadius:9,dockLeft:'20px',dockTop:'100px',dockRight:'auto',dockBottom:'auto'},clips:[]};
let failNext=false,delayEvents=false,queuedEvents=[],writes=0;
const storage={local:{async get(keys,cb){await tick();const data=clone(store);if(cb)cb(data);else return data},async set(values,cb){await tick();if(failNext){failNext=false;throw new Error('Simulated write failure')}writes++;const changes={};for(const [k,v]of Object.entries(values)){changes[k]={oldValue:clone(store[k]??null),newValue:clone(v)};store[k]=clone(v)};const emit=()=>events.forEach(fn=>fn(clone(changes),'local'));if(delayEvents)queuedEvents.push(emit);else emit();cb?.()},getBytesInUse(_,cb){cb(1024)}},onChanged:{addListener(fn){events.push(fn)}}};
let workerListener;
const base={matchMedia:()=>({matches:false}),queueMicrotask,ResizeObserver:class{observe(){}disconnect(){}},console:{log(){},error(){}},setTimeout,clearTimeout,Promise,crypto:require('crypto').webcrypto,URL,innerWidth:1280,innerHeight:900};
const worker=vm.createContext({...base,navigator:{userAgent:'Linux'},chrome:{sidePanel:{setPanelBehavior:async()=>{},open:async()=>{}},storage,runtime:{id:'test',onMessage:{addListener(fn){workerListener=fn}},onInstalled:{addListener(){}}},action:{onClicked:{addListener(){}}},tabs:{query:async()=>[]}}});
worker.importScripts=file=>vm.runInContext(read(file),worker);vm.runInContext(read('background.js'),worker);
function clientChrome(){return {storage,runtime:{id:'test',getManifest:()=>JSON.parse(read('manifest.json')),onMessage:{addListener(){}},sendMessage(msg){return new Promise(resolve=>workerListener(clone(msg),{id:'test'},resolve))}},tabs:{query(_,cb){cb([])}}}}
function context(doc){const c=vm.createContext({...base,document:doc,chrome:clientChrome(),requestAnimationFrame:fn=>fn(),location:{origin:'https://app.weavy.ai',pathname:'/test/project'},navigator:{},window:{innerWidth:1280,innerHeight:900,addEventListener(){}}});vm.runInContext(read('appearance.js'),c);vm.runInContext(read('clips.js'),c);vm.runInContext(read('ui.js'),c);return c}
(async()=>{
 const doc=documentFixture(),options=context(doc);
 vm.runInContext(read('options.js').replace(/\ninit\(\);\s*$/,'\n'),options);
 vm.runInContext('state.settings=normalizeSettings('+JSON.stringify(store.settings)+'); settingsSnapshot={...state.settings}; renderSettings(); attachListeners();',options);
 const contentDoc=documentFixture(),dock=new Element({id:'wc-dock'});contentDoc.byId.set('wc-dock',dock);
 const content=context(contentDoc);vm.runInContext(read('content.js'),content);
 vm.runInContext('state.settings=normalizeSettings('+JSON.stringify(store.settings)+');storedPosition=Object.fromEntries(POSITION_KEYS.map(k=>[k,state.settings[k]]));applyStyles();',content);
 const A=options.WeavyAppearance;
 const input=(id,value)=>{const el=doc.getElementById(id);assert.ok(el,id);el.value=value;el.dispatch('input')};
 const drain=async()=>{for(let i=0;i<100;i++){await sleep(2);if(!vm.runInContext('savingSettings || settingsJobs.length',options))return}throw Error('Queue did not drain')};
 for(const radius of [0,24,9]){input('border-radius',radius);await drain();check(dock.style['--wc-radius']===radius+'px','radius '+radius+' reaches content without rerender');}
 input('dock-shadow',0);await drain();check(dock.style['--wc-shadow']==='none','zero shadow produces none');
 check(doc.getElementById('dock-shadow-value').textContent==='0%','shadow label is a percentage');
 input('dock-shadow',48);input('dock-blur',24);input('dock-opacity',65);await drain();
 check(dock.style['--wc-shadow']===doc.getElementById('dock-preview-box').style['--wc-shadow'],'preview and content use identical shadow');
 check(dock.style['--wc-blur']==='blur(24px)'&&dock.style['--wc-surface'].endsWith(', 0.65)'),'blur and alpha passed independently');
 input('dock-opacity',0);input('dock-blur',0);await drain();check(dock.style['--wc-blur']==='none'&&dock.style['--wc-surface'].endsWith(', 0)'),'zero opacity and blur are valid');
 input('accent-color','#163399');input('bg-color','#eeeeee');await drain();check(dock.style['--wc-on-accent']==='#ffffff'&&dock.style['--wc-on-bg']==='#16161d','foreground adapts to dark accents / light dock');
 input('accent-mode','minimal');input('dock-button-size','42');await drain();check(dock.dataset.accentMode==='minimal'&&dock.style['--wc-btn-size']==='42px','accent mode and size reach content');
 input('dock-opacity',100);input('dock-blur',24);await drain();check(doc.getElementById('blur-help').textContent.includes('hidden'),'opaque blur explains why it is hidden');
 const startWrites=writes;for(let i=0;i<300;i++){input('border-radius',i%25);input('dock-shadow',i%49)}input('border-radius',17);input('dock-shadow',0);await drain();
 check(store.settings.borderRadius===17&&dock.style['--wc-radius']==='17px'&&doc.getElementById('border-radius').value==='17','602 rapid edits keep final value in storage, UI and content');
 check(store.settings.dockShadow===0&&dock.style['--wc-shadow']==='none','rapid edits preserve zero');
 check(writes-startWrites<=3,'pending slider frames coalesced into '+(writes-startWrites)+' writes');
 delayEvents=true;input('border-radius',10);await drain();input('border-radius',18);await drain();for(const emit of queuedEvents.reverse())emit();queuedEvents=[];delayEvents=false;
 check(doc.getElementById('border-radius').value==='18','late older storage event cannot roll UI back');
 // Fresh latest delivery restores content after deliberately impossible reverse event ordering.
 events.forEach(fn=>fn({settings:{newValue:clone(store.settings)}},'local'));
 const originalDockBg=dock.style['--wc-bg'];input('settings-bg-color','#ffffff');input('settings-panel-color','#eeeeee');input('settings-pattern-spacing',8);input('settings-pattern-opacity',30);await drain();
 check(doc.documentElement.style['--page-bg']==='#ffffff'&&doc.documentElement.style['--pattern-size']==='8px','page background and pattern spacing independent');
 check(doc.documentElement.style['--panel-fg']==='#16161d','light page sections have dark text');
 check(dock.style['--wc-bg']===originalDockBg,'page colors leave dock unchanged');
 const toggle=doc.getElementById('settings-pattern-enabled');toggle.checked=false;toggle.dispatch('change');await drain();check(doc.documentElement.style['--pattern-color'].endsWith(',0)')&&doc.getElementById('settings-pattern-spacing').disabled,'pattern can be turned off');
 doc.getElementById('reset-page-appearance-btn').onclick();await drain();check(store.settings.settingsBgColor==='#1e1e1e'&&store.settings.borderRadius===18,'page reset preserves dock');
 doc.getElementById('reset-appearance-btn').onclick();await drain();check(store.settings.borderRadius===11&&store.settings.settingsBgColor==='#1e1e1e','dock reset independent');
 vm.runInContext("state.settings.dockLeft='314px';state.settings.dockTop='271px';",content);input('accent-color','#aabbcc');await drain();check(dock.style.left==='314px'&&dock.style.top==='271px','appearance update preserves local per-project position');
 await Promise.all([vm.runInContext("patchSettings({bgColor:'#123456'})",worker),vm.runInContext("patchSettings({dockLeft:'50px'})",worker)]);
 check(store.settings.bgColor==='#123456'&&store.settings.dockLeft==='50px','concurrent worker patches preserve unrelated changes');
 failNext=true;input('border-radius',3);await sleep(30);check(doc.getElementById('settings-save-status').textContent.includes('failed'),'write failure visible');input('border-radius',4);await drain();check(store.settings.borderRadius===4,'queue retries after failure with latest value');
 const invalid=A.normalize({borderRadius:NaN,dockShadow:null,bgColor:'url(bad)',accentColor:'red',settingsPatternSpacing:0,dockOpacity:-10});check(invalid.borderRadius===11&&invalid.dockShadow===13&&invalid.bgColor==='#1e1e1e'&&invalid.settingsPatternSpacing===8&&invalid.dockOpacity===0,'invalid imported appearance is sanitized');
 const backup=clone(store.settings);const normalized=A.normalize(backup);check(normalized.dockLeft===backup.dockLeft&&normalized.borderRadius===backup.borderRadius,'normalization preserves saved unrelated settings');
 const html=read('options.html');const headers=[...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map(m=>m[1]);check(headers.at(-2).includes('Clipboard'),'Clipboard section is penultimate');
 check((html.match(/data-version/g)||[]).length===2&&!html.includes('<h1>'),'compact version labels at top and bottom');
 const manifest=JSON.parse(read('manifest.json'));check(manifest.content_scripts[0].js[0]==='appearance.js'&&manifest.content_scripts[0].css.indexOf('appearance.css')>manifest.content_scripts[0].css.indexOf('content.css'),'shared scripts and cascade order present in manifest');
 const old=JSON.parse(read('tests/baseline-manifest.json'));check(JSON.stringify([...old.permissions,'sidePanel'])===JSON.stringify(manifest.permissions)&&JSON.stringify(old.host_permissions)===JSON.stringify(manifest.host_permissions),'only native sidePanel permission added; host access unchanged');
 input('dock-shadow',24);input('dock-shadow-softness',0);input('dock-shadow-direction',180);input('dock-shadow-distance',8);input('dock-border-width',0);await drain();
 check(dock.style['--wc-shadow'].startsWith('-8px 0px 0px '),'shadow direction and sharp softness independent');
 check(dock.style['--wc-border-width']==='0px','outline completely off at zero width');
 input('dock-border-color','#ff6600');input('dock-border-opacity',100);input('dock-border-width',3);await drain();
 check(dock.style['--wc-border-color']==='rgba(255, 102, 0, 1)'&&dock.style['--wc-border-width']==='3px','outline color, thickness and opacity');
 check(A.defaults.accentColor==='#ffffff'&&A.defaults.bgColor==='#1e1e1e'&&A.defaults.borderRadius===11&&A.defaults.dockBlur===7&&Math.round(A.defaults.dockShadow/48*100)===27&&A.defaults.settingsPatternSpacing===16,'screenshot defaults');
 check(A.presets.length===4&&A.presets.every(p=>A.keys.every(k=>k in p.values)),'four complete built-in presets');
 const created=await vm.runInContext("mutatePreset({operation:'create',name:'Ocean',values:{accentColor:'#00ccff'}})",worker);
 check(created.selectedId.startsWith('custom-')&&store.appearancePresets[0].values.accentColor==='#00ccff','create custom preset');
 worker.testPresetId=created.selectedId;
 await vm.runInContext("mutatePreset({operation:'update',id:testPresetId,name:'Ocean edited',values:{borderRadius:0}})",worker);
 check(store.appearancePresets.length===1&&store.appearancePresets[0].name==='Ocean edited'&&store.appearancePresets[0].values.borderRadius===0,'update custom preset without duplicating');
 const settingsBeforeDelete=JSON.stringify(store.settings);
 await vm.runInContext("mutatePreset({operation:'delete',id:testPresetId})",worker);
 check(store.appearancePresets.length===0&&JSON.stringify(store.settings)===settingsBeforeDelete,'delete preset leaves current appearance unchanged');
 await Promise.all([vm.runInContext("mutatePreset({operation:'create',name:'One',values:{}})",worker),vm.runInContext("mutatePreset({operation:'create',name:'Two',values:{}})",worker)]);
 check(store.appearancePresets.length===2,'concurrent preset creation retains both entries');
 check(A.sanitizePresets([{id:'builtin-default',name:'Fake',values:{}},{id:'custom-good',name:'Valid',values:{bgColor:'invalid'}}]).length===1,'invalid preset ids rejected');
 const range=options.WeavyUI.virtualRange(10000,500000,500,150);check(range.end-range.start<15&&range.start>3000,'large lists render only a bounded window');
 check(options.WeavyUI.virtualRange(0,1000,500,150).end===0,'empty virtual list range');
 const headings=[...read('options.html').matchAll(/<h2>([^<]+)<\/h2>/g)].map(m=>m[1]);check(headings[0].includes('Appearance')&&headings[1].includes('Settings Page')&&headings[2].includes('Clips Manager'),'Appearance, Settings Page, Clips Manager order');
 check(manifest.side_panel.default_path==='options.html'&&manifest.minimum_chrome_version==='116','native side panel declared');
 console.log(`\n${passed} checks passed. Real JS, mocked Chrome transport/DOM; no live-browser claim.`);
})().catch(e=>{console.error(e);process.exitCode=1});
