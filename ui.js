// Shared, dependency-free UI helpers; no clipboard data leaves the extension.
(() => {
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function virtualRange(total,scrollTop,viewport,rowHeight,overscan=3) {
    const top=Math.max(0,Math.min(scrollTop,Math.max(0,total*rowHeight-viewport)));
    const start=Math.max(0,Math.floor(top/rowHeight)-overscan);
    return {start,end:Math.min(total,Math.ceil((top+viewport)/rowHeight)+overscan),top};
  }
  function lazyImages(root,resolve) {
    root._wcImageObserver?.disconnect();
    const fill=img=>{const url=resolve(img.dataset.clipImage);if(typeof url==='string' && /^data:image\/(png|jpe?g|webp|gif|avif|bmp);base64,/i.test(url))img.src=url;};
    const images=[...root.querySelectorAll('img[data-clip-image]')];
    if(!('IntersectionObserver' in globalThis)){images.forEach(fill);return;}
    const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){fill(entry.target);observer.unobserve(entry.target);}});},{root,rootMargin:'100px'});
    root._wcImageObserver=observer;
    images.forEach(img=>observer.observe(img));
  }
  class VirtualList {
    constructor(root,{rowHeight=148,render,bind=()=>{},image=()=>null,empty='No matching clips.'}) {
      Object.assign(this,{root,rowHeight,render,bind,image,empty,items:[],signature:'',frame:0});
      root.classList.add('wc-virtual-list');
      this.onScroll=()=>{if(!this.frame)this.frame=requestAnimationFrame(()=>{this.frame=0;this.draw();});};
      root.addEventListener('scroll',this.onScroll,{passive:true});
      this.onFocusOut=()=>queueMicrotask(()=>this.draw());root.addEventListener('focusout',this.onFocusOut);
      this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(root);
    }
    set(items,{reset=false}={}) {this.items=items;if(reset)this.root.scrollTop=0;this.signature='';this.draw(true);}
    draw(force=false) {
      if(!force && this.root.contains(document.activeElement) && document.activeElement.matches('input,textarea,select'))return;
      if(this.root.querySelector('.wc-dragging'))return;
      const height=typeof this.rowHeight==='function'?this.rowHeight():this.rowHeight;
      const {start,end,top}=virtualRange(this.items.length,this.root.scrollTop||0,this.root.clientHeight||480,height);
      const signature=start+':'+end+':'+height;
      if(!force&&signature===this.signature)return;
      this.signature=signature;
      const rows=this.items.slice(start,end).map((item,i)=>`<div class="wc-virtual-row" style="height:${height}px" data-virtual-index="${start+i}">${this.render(item,start+i)}</div>`).join('');
      this.root.innerHTML=this.items.length ? `<div aria-hidden="true" style="height:${start*height}px"></div>${rows}<div aria-hidden="true" style="height:${(this.items.length-end)*height}px"></div>` : `<div class="empty-state">${escape(this.empty)}</div>`;
      this.root.scrollTop=top;this.bind(this.root);lazyImages(this.root,this.image);
    }
    scrollToIndex(index) {const h=typeof this.rowHeight==='function'?this.rowHeight():this.rowHeight;this.root.scrollTop=Math.max(0,index*h);this.draw(true);}
    destroy(){this.observer.disconnect();this.root._wcImageObserver?.disconnect();this.root.removeEventListener('scroll',this.onScroll);this.root.removeEventListener('focusout',this.onFocusOut);if(this.frame)cancelAnimationFrame(this.frame);}
  }
  function positions(root,selector='[data-clip-id]') {
    const result=new Map();root?.querySelectorAll(selector).forEach(el=>{if(!result.has(el.dataset.clipId))result.set(el.dataset.clipId,el.getBoundingClientRect());});return result;
  }
  function animatePositions(root,before,selector='[data-clip-id]') {
    if(reducedMotion())return;
    root?.querySelectorAll(selector).forEach(el=>{const old=before.get(el.dataset.clipId);if(!old)return;const next=el.getBoundingClientRect();const x=old.left-next.left,y=old.top-next.top;if((x||y)&&el.animate)el.animate([{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],{duration:150,easing:'ease-out'});});
  }
  function palette({clips,onChoose}) {
    document.getElementById('wc-command-palette')?.remove();
    const previous=document.activeElement;
    const dialog=document.createElement('dialog');dialog.id='wc-command-palette';dialog.setAttribute('aria-label','Quick clip search');
    dialog.innerHTML='<div class="wc-palette-head"><input id="wc-command-query" type="search" autocomplete="off" aria-label="Search clips" placeholder="Search clips…"><button type="button" aria-label="Close search">×</button></div><div class="wc-palette-results" role="listbox" aria-label="Matching clips"></div><div class="wc-palette-help">↑ ↓ choose · Enter use · Esc close</div>';
    document.body.appendChild(dialog);const input=dialog.querySelector('input'),results=dialog.querySelector('.wc-palette-results');
    let matches=[],selected=0;
    function close(){dialog.close();dialog.remove();previous?.focus({preventScroll:true});}
    function choose(index){const item=matches[index];if(!item)return;close();onChoose(item);}
    function render(){const q=input.value.trim().toLowerCase();matches=clips().filter(c=>[c.name,c.group,c.type,c.type==='image'?'':String(c.content).slice(0,300)].join(' ').toLowerCase().includes(q)).slice(0,60);selected=Math.min(selected,Math.max(0,matches.length-1));
      results.innerHTML=matches.map((c,i)=>`<button type="button" role="option" aria-selected="${i===selected}" data-index="${i}"><span class="wc-glyph">${escape(c.icon||'📦')}</span><span>${escape(c.name)}<small>${escape(c.group||c.type)}</small></span></button>`).join('')||'<p>No matching clips.</p>';
      results.querySelectorAll('button').forEach(b=>b.onclick=()=>choose(Number(b.dataset.index)));
      results.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
    }
    input.oninput=()=>{selected=0;render()};
    dialog.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();selected=Math.max(0,Math.min(matches.length-1,selected+(e.key==='ArrowDown'?1:-1)));render()}else if(e.key==='Enter'){e.preventDefault();choose(selected)}});
    dialog.addEventListener('cancel',e=>{e.preventDefault();close()});dialog.querySelector('.wc-palette-head button').onclick=close;
    dialog.addEventListener('click',e=>{if(e.target===dialog)close()});dialog.showModal();render();input.focus();return dialog;
  }
  globalThis.WeavyUI={VirtualList,virtualRange,lazyImages,positions,animatePositions,palette,escape};
})();
