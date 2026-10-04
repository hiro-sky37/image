'use strict';
function createSaveDestination({browser,onChange=()=>{}}){
  let directory=null,dbPromise=null;
  const supported=!!browser.isSecureContext&&typeof browser.showDirectoryPicker==='function';
  function database(){
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
      const request=browser.indexedDB.open('kiri-preferences',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('settings');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    return dbPromise;
  }
  async function storedHandle(write,value){
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('settings',write?'readwrite':'readonly'),store=tx.objectStore('settings');
      const request=write?store.put(value,'save-directory'):store.get('save-directory');
      tx.oncomplete=()=>resolve(request.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Storage unavailable'));
    });
  }
  const ready=(async()=>{
    if(supported){try{directory=(await storedHandle(false))||null;}catch{/* Saving still works when browser storage is blocked. */}}
    onChange({supported,name:directory?.name||null});
  })();
  return {
    ready,
    async choose(){
      if(!supported)throw new Error('UNSUPPORTED');
      // Open the picker immediately, while the button's user gesture is active.
      const selected=await browser.showDirectoryPicker({id:'kiri-output',mode:'readwrite'});
      await ready;directory=selected;
      let remembered=true;try{await storedHandle(true,directory);}catch{remembered=false;}
      onChange({supported,name:directory.name});return {name:directory.name,remembered};
    },
    async prepare(){
      await ready;if(!directory)return null;
      const handle=directory;
      if(await handle.queryPermission({mode:'readwrite'})!=='granted'&&await handle.requestPermission({mode:'readwrite'})!=='granted')throw new Error('PERMISSION_DENIED');
      return handle;
    },
    async save(blob,name,handle){
      if(!handle){
        const url=browser.URL.createObjectURL(blob),link=browser.document.createElement('a');
        link.href=url;link.download=name;browser.document.body.append(link);link.click();link.remove();browser.setTimeout(()=>browser.URL.revokeObjectURL(url),10000);
        return {name,folder:null};
      }
      // Preserve existing images by choosing an unused filename.
      const stem=name.replace(/\.png$/i,'');let candidate=name;
      for(let counter=1;counter<=10000;counter++){
        let exists=true;
        try{await handle.getFileHandle(candidate);}catch(error){if(error.name==='NotFoundError')exists=false;else throw error;}
        if(!exists){
          const file=await handle.getFileHandle(candidate,{create:true}),stream=await file.createWritable();
          try{await stream.write(blob);await stream.close();}catch(error){try{await stream.abort();}catch{}throw error;}
          return {name:candidate,folder:handle.name};
        }
        candidate=`${stem} (${counter+1}).png`;
      }
      throw new Error('TOO_MANY_FILES');
    }
  };
}
if(typeof module!=='undefined')module.exports={createSaveDestination};
