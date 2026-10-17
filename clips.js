// Shared clip model. Preserve the existing storage format and send only edits.
(() => {
  const fields=['name','type','content','icon','pinned','locked','group','createdAt','updatedAt','usageCount','versions','sortOrder'];
  const safeId=id=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id);
  const same=(a,b)=>a===b||(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>v===b[i]));
  const snapshot=clips=>clips.map(c=>({...c,versions:[...(c.versions||[])]}));
  function diff(before,after){
    const old=new Map(before.map(c=>[c.id,c])),next=new Set(after.map(c=>c.id)),ops=[];
    for(const c of after){const previous=old.get(c.id);if(!previous){ops.push({kind:'add',clip:{...c}});continue;}
      const changes=Object.fromEntries(fields.filter(k=>!same(c[k],previous[k])).map(k=>[k,c[k]]));
      if(Object.keys(changes).length)ops.push({kind:'edit',id:c.id,changes});
    }
    for(const c of before)if(!next.has(c.id))ops.push({kind:'delete',id:c.id});
    return ops;
  }
  function apply(clips,ops){
    const map=new Map(clips.map(c=>[c.id,c]));
    for(const op of ops){
      if(op.kind==='add'){if(!safeId(op.clip?.id))throw Error('Invalid clip ID');if(!map.has(op.clip.id))map.set(op.clip.id,{...op.clip});}
      else if(op.kind==='delete'){if(!safeId(op.id))throw Error('Invalid clip ID');map.delete(op.id);}
      else if(op.kind==='edit'){
        const current=map.get(op.id);if(!current)continue;
        const changes=Object.fromEntries(fields.filter(k=>Object.hasOwn(op.changes||{},k)).map(k=>[k,op.changes[k]]));
        map.set(op.id,{...current,...changes});
      }else throw Error('Unknown clip operation');
    }
    return [...map.values()];
  }
  function validateBackup(data){
    if(!data||!Array.isArray(data.clips)||data.clips.length>50000)throw Error('Invalid clip backup');
    if(data.schemaVersion!=null&&(!Number.isInteger(data.schemaVersion)||data.schemaVersion<1||data.schemaVersion>3))throw Error('Unsupported backup version');
    const ids=new Set();
    const content=c=>{
      if(!c||!['text','json','image'].includes(c.type)||typeof c.content!=='string')throw Error('Invalid clip content');
      if(c.type==='image'&&!/^data:image\/(png|jpe?g|webp|gif|avif|bmp);base64,[A-Za-z0-9+/=\r\n]*$/i.test(c.content))throw Error('Invalid image clip');
    };
    const clips=data.clips.map(c=>{
      content(c);if(!safeId(c.id)||ids.has(c.id))throw Error('Invalid or duplicate clip ID');ids.add(c.id);
      if(c.name!=null&&typeof c.name!=='string')throw Error('Invalid clip name');
      if(c.versions!=null&&!Array.isArray(c.versions))throw Error('Invalid clip history');
      const versions=(c.versions||[]).map(v=>{content(v);if(!safeId(v.id))throw Error('Invalid version ID');return {id:v.id,type:v.type,content:v.content,savedAt:Number(v.savedAt)||0};});
      return {id:c.id,name:(c.name||'Untitled clip').slice(0,300),type:c.type,content:c.content,icon:typeof c.icon==='string'?c.icon.slice(0,32):'📦',group:typeof c.group==='string'?c.group.slice(0,300):'',pinned:c.pinned!==false,locked:!!c.locked,createdAt:Number(c.createdAt)||0,updatedAt:Number(c.updatedAt)||0,usageCount:Math.max(0,Number(c.usageCount)||0),sortOrder:Number(c.sortOrder)||0,versions};
    });
    if(data.settings!=null&&(typeof data.settings!=='object'||Array.isArray(data.settings)))throw Error('Invalid settings');
    return {...data,clips};
  }
  class Client {
    constructor({get,set,send=msg=>chrome.runtime.sendMessage(msg),status=()=>{}}){Object.assign(this,{get,set,send,status,base:[],pending:[],revision:0,timer:null,active:null});}
    reset(clips,revision=0){this.base=snapshot(clips);this.server=snapshot(clips);this.serverRevision=this.revision=Number(revision)||0;}
    commit(clips){
      const current=new Map(this.get().map(c=>[c.id,c]));
      const next=clips.map(c=>current.has(c.id)?Object.assign(current.get(c.id),c):c);
      this.set(next);this.base=snapshot(next);
    }
    save(immediate=false){
      const current=this.get(),ops=diff(this.base,current);this.base=snapshot(current);
      if(ops.length)this.pending.push(ops);
      clearTimeout(this.timer);
      if(immediate)return this.flush();
      if(this.pending.length)this.timer=setTimeout(()=>this.flush(),120);
      return Promise.resolve(true);
    }
    receive(clips,revision=0){
      if(Number(revision)<this.revision)return;
      this.revision=Number(revision)||0;
      this.server=snapshot(Array.isArray(clips)?clips:[]);this.serverRevision=this.revision;
      const local=diff(this.base,this.get());
      const merged=apply(snapshot(this.server),[...this.pending.flat(),...local]);
      this.commit(merged);
      if(local.length)this.pending.push(local);
    }
    flush(){
      clearTimeout(this.timer);
      if(this.active)return this.active;
      if(!this.pending.length)return Promise.resolve(true);
      this.status('saving');
      this.active=Promise.resolve().then(async()=>{
        try{
          while(this.pending.length){
            const count=this.pending.length,operations=this.pending.slice(0,count).flat();
            const result=await this.send({action:'patchClips',operations});
            if(!result?.success)throw Error(result?.error||'Could not save clips');
            this.revision=Math.max(this.revision,Number(result.revision)||0);
            this.pending.splice(0,count);
            if(this.serverRevision>=Number(result.revision)){
              const local=diff(this.base,this.get());
              const merged=apply(snapshot(this.server),[...this.pending.flat(),...local]);
              this.commit(merged);
              if(local.length)this.pending.push(local);
            }
          }
          this.status('saved');return true;
        }catch(error){this.status('error',error);return false;}
      }).finally(()=>{this.active=null;});
      return this.active;
    }
  }
  globalThis.WeavyClips={Client,diff,apply,validateBackup};
})();
