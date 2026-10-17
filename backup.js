// Shared import/export actions for settings and the on-page Library.
(() => {
  async function exportFile({before=async()=>true,report=()=>{}}={}){
    try{
      if(!await before())throw Error('Save pending changes before exporting');
      const data=await chrome.storage.local.get(['clips','settings','appearancePresets']);
      const blob=new Blob([JSON.stringify({schemaVersion:3,clips:data.clips||[],settings:data.settings||{},appearancePresets:data.appearancePresets||[],exportedAt:Date.now()},null,2)],{type:'application/json'});
      const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=`weavy-clips-v2-backup-${new Date().toISOString().slice(0,10)}.json`;a.hidden=true;a.addEventListener('click',event=>event.stopPropagation());document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);report('Backup exported');return true;
    }catch(error){report('Export failed: '+error.message);return false;}
  }
  async function importFile(file,{before=async()=>true,report=()=>{}}={}){
    try{
      if(!file)return false;
      if(file.size>64*1024*1024)throw Error('Backups must be 64 MB or smaller');
      const data=WeavyClips.validateBackup(JSON.parse(await file.text()));
      if(!await before())throw Error('Save pending changes before importing');
      const result=await chrome.runtime.sendMessage({action:'importBackup',data});
      if(!result?.success)throw Error(result?.error||'Could not import');
      report(`Imported ${result.added} clips · ${result.skipped} already present`);return true;
    }catch(error){report('Import failed: '+error.message);return false;}
  }
  function chooseFile(options){
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;document.body.appendChild(input);
    input.onchange=()=>{const file=input.files[0];input.remove();importFile(file,options);};
    input.addEventListener('click',event=>event.stopPropagation());
    input.addEventListener('cancel',()=>input.remove(),{once:true});input.click();
  }
  globalThis.WeavyBackup={exportFile,importFile,chooseFile};
})();
