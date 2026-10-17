const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function setup(){
 const {document}=parseHTML('<html><body></body></html>');let exported,sends=0;
 const reports=[],stored={clips:[{id:'sample',name:'Sample',type:'text',content:'Full text',versions:[{id:'v1',type:'text',content:'Previous',savedAt:1}]}],settings:{dockBlur:5},appearancePresets:[]};
 const c=vm.createContext({document,Blob,setTimeout:()=>{},URL:{createObjectURL:b=>{exported=b;return 'blob:sample'},revokeObjectURL(){}},chrome:{storage:{local:{get:async()=>stored}},runtime:{sendMessage:async()=>{sends++;return {success:true,added:1,skipped:0}}}}});
 vm.runInContext(read('clips.js'),c);vm.runInContext(read('backup.js'),c);
 return {api:c.WeavyBackup,reports,stored,document,get blob(){return exported},get sends(){return sends}};
}
test('shared export contains full clip history and settings from storage',async()=>{
 const s=setup();assert.equal(await s.api.exportFile({report:m=>s.reports.push(m)}),true);
 const data=JSON.parse(await s.blob.text());assert.equal(data.schemaVersion,3);assert.deepEqual(data.clips,s.stored.clips);assert.deepEqual(data.settings,s.stored.settings);
});
test('failed pending saves stop export before creating a misleading backup',async()=>{
 const s=setup();assert.equal(await s.api.exportFile({before:async()=>false}),false);assert.equal(s.blob,undefined);
});
test('import rejects oversized or malformed files before sending data to the worker',async()=>{
 const s=setup();assert.equal(await s.api.importFile({size:65*1024*1024,text:async()=>{throw Error('must not read')}}),false);
 assert.equal(await s.api.importFile({size:20,text:async()=>'{broken'}),false);assert.equal(s.sends,0);
});
test('validated imports reach the shared worker action',async()=>{
 const s=setup();assert.equal(await s.api.importFile({size:100,text:async()=>JSON.stringify({schemaVersion:3,clips:s.stored.clips})}),true);assert.equal(s.sends,1);
});
test('popup and tooltip layers stay above the dock and Library',()=>{
 // LinkeDOM's CSS parser predates container queries; these do not set layers.
 let css=read('content.css'),start;
 while((start=css.indexOf('@container'))!==-1){let end=css.indexOf('{',start),depth=1;for(end++;end<css.length&&depth;end++){if(css[end]==='{')depth++;if(css[end]==='}')depth--;}css=css.slice(0,start)+css.slice(end);}
 const {document}=parseHTML('<html><head><style></style></head><body><div id="wc-dock"></div><div class="wc-context-menu"></div><div id="wc-tooltip"></div></body></html>');
 const style=document.querySelector('style');style.textContent=css;
 function layer(selector){const el=document.querySelector(selector);let value=0;for(const rule of style.sheet.cssRules){if(!rule.selectorText||!rule.style?.getPropertyValue('z-index'))continue;if(el.matches(rule.selectorText))value=Number(rule.style.getPropertyValue('z-index'));}return value;}
 assert.ok(layer('.wc-context-menu')>Math.max(layer('#wc-dock'),999998));assert.ok(layer('#wc-tooltip')>layer('#wc-dock'));
});
