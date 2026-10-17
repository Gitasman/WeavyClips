const {parseHTML}=require('linkedom');
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const path=require('path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const pause=()=>new Promise(r=>setTimeout(r,40));
const clients=[],errors=[];
const clips=Array.from({length:1200},(_,i)=>({id:'clip-'+i,name:'Node '+i,content:i%20===0?'data:image/png;base64,YQ==':'Content '+i,type:i%20===0?'image':'text',icon:'📦',pinned:i<5,sortOrder:i,versions:[],createdAt:Date.now()}));
const store={settings:{settingsSchemaVersion:8},clips};
const storage={local:{async get(_,cb){const data=clone(store);if(cb)cb(data);return data},async set(values,cb){const change={};for(const [k,v]of Object.entries(values)){change[k]={oldValue:clone(store[k]??null),newValue:clone(v)};store[k]=clone(v)}clients.forEach(fn=>fn(change,'local'));cb?.()},getBytesInUse(_,cb){cb(100000)}},onChanged:{addListener(fn){clients.push(fn)}}};
let listener,panelOpen,worker;
const basic={console:{log(){},error(...args){errors.push(args.map(a=>String(a)).join(' '))}},setTimeout,clearTimeout,crypto:require('crypto').webcrypto,URL,queueMicrotask,matchMedia:()=>({matches:false}),ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout};
worker=vm.createContext({...basic,importScripts:file=>vm.runInContext(read(file),worker),chrome:{storage,runtime:{id:'extension',onMessage:{addListener(fn){listener=fn}},onInstalled:{addListener(){}}},sidePanel:{async setPanelBehavior(){},async open(options){panelOpen=options}},tabs:{query:async()=>[]}}});
vm.runInContext(read('background.js'),worker);
function makePage(html){
 const {document,window}=parseHTML(html);
 const proto=window.HTMLElement.prototype;
 proto.getBoundingClientRect=function(){return {x:20,y:100,left:20,top:100,right:380,bottom:500,width:360,height:400}};
 Object.defineProperties(proto,{clientWidth:{get(){return 360},configurable:true},clientHeight:{get(){return 480},configurable:true},offsetWidth:{get(){return 360},configurable:true},offsetHeight:{get(){return 52},configurable:true}});
 proto.scrollIntoView=function(){};proto.setSelectionRange=function(){};proto.animate=function(){};
 Object.defineProperty(document,'activeElement',{get(){return document._active||document.body},configurable:true});proto.focus=function(){document._active=this};
 // Native select value setter is absent in this DOM library.
 const selProto=window.HTMLSelectElement.prototype;
 Object.defineProperty(selProto,'value',{get(){return this._value??this.querySelector('option')?.value??''},set(v){this._value=String(v)},configurable:true});
 proto.showModal=function(){this.setAttribute('open','')};proto.close=function(){this.removeAttribute('open')};
 Object.defineProperty(document,'readyState',{value:'complete',configurable:true});
 const chrome={storage,runtime:{id:'extension',getManifest:()=>JSON.parse(read('manifest.json')),onMessage:{addListener(){}},sendMessage(msg,cb){return new Promise(resolve=>{listener(clone(msg),{id:'extension',tab:{id:1,windowId:1}},result=>{cb?.(result);resolve(result)})})}},tabs:{query(_,cb){cb?.([]);return Promise.resolve([])}}};
 const context=vm.createContext({...basic,window,document,chrome,location:{origin:'https://app.weavy.ai',pathname:'/test'},innerWidth:1280,innerHeight:900,navigator:{clipboard:{writeText:async()=>{},write:async()=>{}}},confirm:()=>true,Blob,Event:window.Event,KeyboardEvent:window.Event});
 window.innerWidth=1280;window.innerHeight=900;
 for(const file of ['appearance.js','ui.js'])vm.runInContext(read(file),context);
 return {context,document,window};
}
let passed=0;function check(test,label){assert.ok(test,label);passed++;console.log('PASS '+label)}
(async()=>{
 const options=makePage(read('options.html'));vm.runInContext(read('options.js'),options.context);await pause();
 const d=options.document;
 check(d.querySelector('.settings-topbar').contains(d.getElementById('settings-nav'))&&d.querySelector('.settings-topbar').contains(d.querySelector('.compact-header')),'header and navigation share one topbar');
 check(d.documentElement.style.getPropertyValue('--settings-topbar-offset')==='412px','navigation offset follows measured topbar height');
 check(d.querySelectorAll('.section-body').length===9&&d.querySelectorAll('#settings-nav button').length===9,'all sections initialized with collapse + navigation');
 check(d.querySelectorAll('#clips-list .clip-item').length>0&&d.querySelectorAll('#clips-list .clip-item').length<20,'1,200 clips create fewer than 20 manager rows');
 check(d.querySelectorAll('#appearance-preset option').length===5,'built-in presets mounted');
 const appearance=d.querySelector('#appearance-section .section-toggle');appearance.click();check(d.querySelector('#appearance-section .section-body').hidden,'collapse hides body');appearance.click();check(!d.querySelector('#appearance-section .section-body').hidden,'collapse restores body');
 const emit=(id,value)=>{const el=d.getElementById(id);el.value=value;el.dispatchEvent(new options.window.Event('input',{bubbles:true}))};
 emit('preset-name','My theme');d.getElementById('preset-create').click();await pause();check(store.appearancePresets?.[0]?.name==='My theme','preset Create UI reaches worker');
 emit('border-radius',22);await pause();d.getElementById('preset-update').click();await pause();check(store.appearancePresets[0].values.borderRadius===22,'preset Update UI saves current settings');
 const chooser=d.getElementById('appearance-preset');chooser.value='builtin-glass';chooser.dispatchEvent(new options.window.Event('change'));await pause();check(store.settings.dockOpacity===68,'preset selection applies Glass');
 emit('dock-opacity',95);await pause();d.getElementById('preset-apply').click();await pause();check(store.settings.dockOpacity===68,'Apply restores modified selected preset');
 chooser.value=store.appearancePresets[0].id;chooser.dispatchEvent(new options.window.Event('change'));await pause();d.getElementById('preset-delete').click();await pause();check(store.appearancePresets.length===0,'preset Delete UI removes custom preset');
 d.getElementById('quick-find-btn').click();check(!!d.querySelector('#wc-command-palette[open]'),'quick-search dialog opens');
 const query=d.getElementById('wc-command-query');query.value='Node 1199';query.dispatchEvent(new options.window.Event('input'));check(d.querySelectorAll('.wc-palette-results button').length===1,'palette searches clips beyond virtual window');d.querySelector('.wc-palette-head button').click();check(!d.getElementById('wc-command-palette'),'palette closes');
 const site=makePage('<!doctype html><html><body><main tabindex="0"></main></body></html>');vm.runInContext(read('content.js'),site.context);await pause();
 const dock=site.document.getElementById('wc-dock');check(!!dock&&dock.querySelectorAll('[data-clip-id]').length===5,'content script mounts dock with pinned clips');
 check(dock.querySelector('#wc-save-btn .wc-glyph').textContent==='💾','save emoji restored');
 site.document.getElementById('wc-settings-btn').click();await pause();check(panelOpen?.windowId===1,'dock gear opens native side panel in source window');
 site.document.getElementById('wc-library-btn').click();await pause();check(!!site.document.getElementById('wc-library-panel'),'Library opens');
 check(site.document.querySelectorAll('#wc-lib-list .wc-lib-item').length>0&&site.document.querySelectorAll('#wc-lib-list .wc-lib-item').length<20,'Library virtualizes 1,200 clips');
 const search=site.document.getElementById('wc-lib-search');search.value='Node 1199';search.dispatchEvent(new site.window.Event('input'));check(site.document.querySelectorAll('#wc-lib-list .wc-lib-item').length===1,'Library search filters beyond virtual window');
 check(site.document.querySelector('#wc-lib-list .wc-lib-name').textContent.includes('1199'),'Library displays correct filtered clip');
 const lib=site.document.getElementById('wc-library-panel');vm.runInContext('refreshLibraryModal()',site.context);check(site.document.getElementById('wc-library-panel')===lib,'Library refresh retains container and search input');
 vm.runInContext('closeLibraryModal()',site.context);check(!site.document.getElementById('wc-library-panel'),'Library closes and disposes list');
 // Free dock padding starts dragging; buttons never start dock drag.
 const start=new site.window.Event('mousedown',{bubbles:true});Object.defineProperties(start,{button:{value:0},clientX:{value:25},clientY:{value:105}});dock.dispatchEvent(start);
 check(vm.runInContext('state.isDragging',site.context),'drag starts on free dock padding');vm.runInContext('onDragEnd()',site.context);
 const buttonDown=new site.window.Event('mousedown',{bubbles:true});Object.defineProperties(buttonDown,{button:{value:0},clientX:{value:25},clientY:{value:105}});site.document.getElementById('wc-save-btn').dispatchEvent(buttonDown);
 check(!vm.runInContext('state.isDragging',site.context),'button clicks do not drag the dock');
 // Verify lazy previews are only assigned a source on intersection.
 let trigger;options.context.IntersectionObserver=class{constructor(fn){trigger=fn}observe(){}unobserve(){}disconnect(){}};
 const images=d.createElement('div');images.innerHTML='<img data-clip-image="clip-0" alt="test">';
 options.context.WeavyUI.lazyImages(images,()=>clips[0].content);check(!images.firstChild.hasAttribute('src'),'offscreen image has no source');trigger([{isIntersecting:true,target:images.firstChild}]);check(images.firstChild.getAttribute('src')===clips[0].content,'visible image receives its source');
 check(errors.length===0,'no JS errors: '+errors.join('; '));console.log(`${passed} DOM integration checks passed; no layout or real Chrome API simulation claim.`);
})().catch(error=>{console.error(error);process.exitCode=1});
