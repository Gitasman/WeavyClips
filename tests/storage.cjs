// Real shared model and worker, with an in-memory Chrome transport.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
const clip=(id,extra={})=>({id,name:id,type:'text',content:'hello',versions:[],pinned:true,sortOrder:0,...extra});
function setup(initial=[clip('a')]){
 const store={clips:copy(initial),clipsRevision:0,settings:{settingsSchemaVersion:8},factorySeedVersion:1},clients=[];let listener,writes=0,fail=false;
 const context=vm.createContext({console,setTimeout,clearTimeout,queueMicrotask,crypto:require('node:crypto').webcrypto,navigator:{userAgent:'Linux'},chrome:{storage:{local:{async get(){return copy(store)},async set(values){if(fail){fail=false;throw Error('Disk full')}writes++;Object.assign(store,copy(values));clients.forEach(c=>c.receive(copy(store.clips),store.clipsRevision));}}},runtime:{id:'test',onMessage:{addListener(fn){listener=fn}},onInstalled:{addListener(){}}},sidePanel:{setPanelBehavior:async()=>{}},tabs:{query:async()=>[]}}});
 context.importScripts=f=>vm.runInContext(read(f),context);
 if(fs.existsSync(path.join(root,'clips.js')))vm.runInContext(read('clips.js'),context);
 assert.ok(context.WeavyClips,'shared clip persistence is available');
 vm.runInContext(read('background.js'),context);
 const send=msg=>new Promise(resolve=>listener(copy(msg),{id:'test'},resolve));
 function page(){let state=copy(store.clips);const statuses=[];const client=new context.WeavyClips.Client({get:()=>state,set:v=>{state=v},send,status:s=>statuses.push(s)});client.reset(state,store.clipsRevision);clients.push(client);return {client,statuses,get clips(){return state}};}
 return {context,page,store,get writes(){return writes},failNext(){fail=true}};
}
test('concurrent tabs retain additions and independent edits to one clip',async()=>{
 const s=setup(),a=s.page(),b=s.page();a.clips[0].name='Renamed';b.clips[0].pinned=false;
 await Promise.all([a.client.save(true),b.client.save(true)]);
 assert.equal(s.store.clips[0].name,'Renamed');assert.equal(s.store.clips[0].pinned,false);
 a.clips.push(clip('b'));b.clips.push(clip('c'));await Promise.all([a.client.save(true),b.client.save(true)]);
 assert.deepEqual(s.store.clips.map(c=>c.id).sort(),['a','b','c']);
});
test('a stale edit cannot resurrect a clip deleted by another tab',async()=>{
 const s=setup(),a=s.page(),b=s.page();a.clips.splice(0);b.clips[0].name='Stale edit';
 await Promise.all([a.client.save(true),b.client.save(true)]);assert.equal(s.store.clips.length,0);
});
test('failed writes remain retryable and preserve other tabs changes',async()=>{
 const s=setup(),a=s.page(),b=s.page();a.clips[0].name='Unsaved';s.failNext();
 assert.equal(await a.client.save(true),false);assert.equal(a.statuses.at(-1),'error');
 b.clips.push(clip('b'));await b.client.save(true);assert.equal(a.clips[0].name,'Unsaved');
 assert.equal(await a.client.flush(),true);assert.equal(s.store.clips[0].name,'Unsaved');assert.equal(s.store.clips.length,2);
});
test('rapid edits use one write and closing-page flush persists the last value',async()=>{
 const s=setup(),a=s.page();for(let i=0;i<50;i++){a.clips[0].name='Name '+i;a.client.save()}
 await a.client.flush();assert.equal(s.store.clips[0].name,'Name 49');assert.equal(s.writes,1);
});
test('small metadata edits do not send the full image library',async()=>{
 const s=setup([clip('a',{type:'image',content:'data:image/png;base64,'+'a'.repeat(100000)})]),p=s.page();
 const operations=s.context.WeavyClips.diff(p.clips,[{...p.clips[0],name:'Renamed'}]);
 assert.ok(JSON.stringify(operations).length<200);
});
test('imports reject unsafe ids, invalid types and malformed history before mutation',()=>{
 const {context}=setup(),A=context.WeavyClips;
 for(const bad of [clip('a" onclick="x'),clip('a',{type:'html'}),clip('a',{versions:[null]}),null])assert.throws(()=>A.validateBackup({clips:[bad]}));
 assert.throws(()=>A.validateBackup({schemaVersion:999,clips:[]}));
 assert.throws(()=>A.validateBackup({clips:[clip('same'),clip('same')]}));
 assert.equal(A.validateBackup({schemaVersion:3,clips:[clip('safe')]}).clips[0].content,'hello');
});
test('old storage events cannot roll back the current library',async()=>{
 const s=setup(),p=s.page();p.clips[0].name='New';await p.client.save(true);
 p.client.receive([clip('a')],0);assert.equal(p.clips[0].name,'New');
});
test('late acknowledgements retain a newer edit delivered by another tab',async()=>{
 const s=setup();let state=[clip('a')],ack;
 const client=new s.context.WeavyClips.Client({get:()=>state,set:v=>{state=v},send:()=>new Promise(r=>{ack=r})});
 client.reset(state);state[0].name='Mine';const saving=client.save(true);
 await new Promise(r=>setImmediate(r));
 client.receive([clip('a',{name:'Newer remote edit'})],2);
 ack({success:true,revision:1});await saving;
 assert.equal(state[0].name,'Newer remote edit');
});
test('remote refresh preserves clip references used by open editors and cached search',()=>{
 const s=setup(),p=s.page(),original=p.clips[0];
 p.client.receive([clip('a',{usageCount:4})],1);
 assert.equal(p.clips[0],original);assert.equal(original.usageCount,4);
});
test('synchronous transport errors do not lock the retry queue',async()=>{
 const s=setup();let state=[clip('a')],fail=true;
 const client=new s.context.WeavyClips.Client({get:()=>state,set:v=>{state=v},send:()=>{if(fail)throw Error('Transport closed');return Promise.resolve({success:true,revision:1})}});
 client.reset(state);state[0].name='Pending';assert.equal(await client.save(true),false);
 fail=false;assert.equal(await client.flush(),true);
});
