const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {parseHTML}=require('linkedom'),root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
function help(){const c=vm.createContext({});if(fs.existsSync(path.join(root,'help.js')))vm.runInContext(read('help.js'),c);assert.ok(c.WeavyHelp,'localized help is available');return c.WeavyHelp;}
test('help selects the first supported browser language with an English fallback',()=>{
 const h=help();assert.equal(h.language(['ru-RU','en-US'],'auto'),'ru');assert.equal(h.language(['en-GB','ru'],'auto'),'en');assert.equal(h.language(['fr-FR'],'auto'),'en');
});
test('explicit help language overrides the browser',()=>{const h=help();assert.equal(h.language(['ru'],'en'),'en');assert.equal(h.language(['en'],'ru'),'ru');});
test('every help topic is present in both languages',()=>{const h=help();assert.deepEqual(Object.keys(h.copy.en).sort(),Object.keys(h.copy.ru).sort());assert.ok(h.copy.en.update.includes('same folder'));assert.ok(h.copy.ru.update.includes('ту же папку'));});
test('help renders Russian automatically and persists an English override',async()=>{
 const {document,window}=parseHTML(read('help.html'));const saved=[];
 const c=vm.createContext({document,navigator:{languages:['ru-RU']},chrome:{storage:{local:{get:async()=>({}),set:async v=>saved.push(v)}}},console});
 vm.runInContext(read('help.js'),c);await new Promise(r=>setTimeout(r,0));
 assert.equal(document.documentElement.lang,'ru');assert.equal(document.getElementById('help-title').textContent,'Справка Weavy Clips');
 const select=document.getElementById('help-language');Object.defineProperty(select,'value',{value:'en',writable:true});select.dispatchEvent(new window.Event('change'));await new Promise(r=>setTimeout(r,0));
 assert.equal(document.documentElement.lang,'en');assert.equal(saved.at(-1).helpLanguage,'en');
});
test('help follows the saved light theme and disabled background pattern',async()=>{
 const {document}=parseHTML(read('help.html'));
 const c=vm.createContext({document,navigator:{languages:['en']},chrome:{storage:{local:{get:async()=>({settings:{settingsBgColor:'#ffffff',settingsPanelColor:'#eeeeee',settingsPatternEnabled:false}}),set:async()=>{}}}}});
 vm.runInContext(read('appearance.js'),c);vm.runInContext(read('help.js'),c);await new Promise(r=>setTimeout(r,0));
 assert.equal(document.documentElement.style.getPropertyValue('--page-bg'),'#ffffff');assert.equal(document.documentElement.style.getPropertyValue('--panel-fg'),'#16161d');assert.equal(document.documentElement.style.getPropertyValue('--pattern'),'transparent');
});
function ui(){const c=vm.createContext({});vm.runInContext(read('ui.js'),c);return c.WeavyUI;}
test('search handles accents and multiple words and invalidates after renaming',()=>{
 const u=ui(),clips=[{name:'Café node',type:'text',content:'summer',group:'Design'}];
 assert.equal(u.searchClips(clips,'cafe design').length,1);clips[0].name='Winter';assert.equal(u.searchClips(clips,'cafe').length,0);
});
test('search never reads image payloads and stops at the result limit',()=>{
 const u=ui(),clip={name:'Photo',type:'image',get content(){throw Error('Image content must not be indexed')}};
 assert.equal(u.searchClips([clip],'photo').length,1);assert.equal(u.searchClips(Array.from({length:1000},(_,i)=>({name:'Node '+i})), 'node',60).length,60);
});
