const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8'),clone=x=>JSON.parse(JSON.stringify(x));
const seed={schemaVersion:3,settings:{dockOpacity:0,dockBlur:5,dockShadow:41,settingsOpenMode:'tab'},clips:[{id:'starter',name:'Starter',type:'text',content:'Fixture',versions:[]}],appearancePresets:[]};
function worker(initial={}){
 const store=clone(initial),events=[],calls={tabs:0,side:[],behaviors:[]};let message,action;
 const c=vm.createContext({console,setTimeout,clearTimeout,queueMicrotask,URL,crypto:require('node:crypto').webcrypto,navigator:{userAgent:'Linux'},fetch:async()=>({ok:true,json:async()=>clone(seed)}),chrome:{storage:{local:{async get(){return clone(store)},async set(values){Object.assign(store,clone(values));}},onChanged:{addListener(fn){events.push(fn)}}},runtime:{id:'test',getURL:p=>p,openOptionsPage:async()=>{calls.tabs++},onMessage:{addListener(fn){message=fn}},onInstalled:{addListener(){}}},action:{onClicked:{addListener(fn){action=fn}}},sidePanel:{setPanelBehavior:async v=>{calls.behaviors.push(v)},open:async v=>{calls.side.push(v)}},tabs:{query:async()=>[]}}});
 c.importScripts=f=>vm.runInContext(read(f),c);vm.runInContext(read('background.js'),c);
 return {store,c,calls,send:msg=>new Promise(r=>{if(message(msg,{id:'test',tab:{id:4,windowId:2}},r)!==true)r({success:false,error:'Unhandled request'})}),click:()=>action?.()};
}
test('new installs receive factory settings and their bundled clips only once',async()=>{
 const w=worker();const r=await w.send({action:'initializeDefaults'});assert.equal(r.success,true);assert.equal(w.store.settings.dockOpacity,0);assert.equal(w.store.clips[0].id,'starter');
 w.store.clips=[];await w.send({action:'initializeDefaults'});assert.equal(w.store.clips.length,0);
});
test('updates preserve existing preferences and an intentionally empty library',async()=>{
 const w=worker({settings:{settingsSchemaVersion:8,dockOpacity:73},clips:[]});await w.send({action:'initializeDefaults'});
 assert.equal(w.store.settings.dockOpacity,73);assert.equal(w.store.clips.length,0);
});
test('settings open in a tab by default from both the dock and toolbar',async()=>{
 const w=worker({settings:{settingsSchemaVersion:8},clips:[]});await w.send({action:'initializeDefaults'});await w.send({action:'openOptions'});await w.click();
 assert.equal(w.calls.tabs,2);assert.equal(w.calls.side.length,0);assert.equal(w.calls.behaviors.at(-1).openPanelOnActionClick,false);
});
test('side panel remains available as an explicit saved preference',async()=>{
 const w=worker({settings:{settingsSchemaVersion:8},clips:[]});await w.send({action:'initializeDefaults'});
 await w.send({action:'patchSettings',patch:{settingsOpenMode:'sidePanel'}});await w.send({action:'openOptions',mode:'sidePanel'});await w.click();
 assert.equal(w.calls.side[0].windowId,2);assert.equal(w.calls.tabs,0);assert.equal(w.calls.behaviors.at(-1).openPanelOnActionClick,true);
});
test('backup import merges current data and settings in a single write path',async()=>{
 const w=worker({settings:{settingsSchemaVersion:8,dockOpacity:73},clips:[]});await w.send({action:'initializeDefaults'});
 const result=await w.send({action:'importBackup',data:seed});assert.equal(result.success,true);assert.equal(result.added,1);assert.equal(w.store.settings.dockOpacity,0);
 const again=await w.send({action:'importBackup',data:seed});assert.equal(again.added,0);assert.equal(again.skipped,1);
});
test('invalid backups leave existing settings and clips untouched',async()=>{
 const w=worker({settings:{settingsSchemaVersion:8,dockOpacity:73},clips:[]});await w.send({action:'initializeDefaults'});const before=clone(w.store);
 const result=await w.send({action:'importBackup',data:{clips:[null],settings:{dockOpacity:1}}});assert.equal(result.success,false);assert.deepEqual(w.store,before);
});
