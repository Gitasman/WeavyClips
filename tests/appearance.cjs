const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','appearance.js'),'utf8');
function fixture(metrics){
 let reads=0,canvasCount=0;
 const context={font:'',measureText(){reads++;return metrics}};
 const c=vm.createContext({document:{createElement(){canvasCount++;return {getContext:()=>context}}}});vm.runInContext(source,c);
 const glyph=text=>({textContent:text,style:{setProperty(key,value){this[key]=value}}});
 return {A:c.WeavyAppearance,glyph,context,reads:()=>reads,canvasCount:()=>canvasCount};
}
test('emoji centering compensates platform font metrics and caches repeated glyphs',()=>{
 const f=fixture({actualBoundingBoxAscent:13,actualBoundingBoxDescent:3,fontBoundingBoxAscent:18,fontBoundingBoxDescent:4});
 const save=f.glyph('💾'),gear=f.glyph('⚙️'),root={querySelectorAll:()=>[save,gear]};f.A.centerGlyphs(root);
 assert.equal(save.style['--wc-glyph-offset'],'-2px');assert.equal(gear.style['--wc-glyph-offset'],'-2px');
 f.A.centerGlyphs(root);assert.equal(f.reads(),2);assert.equal(f.canvasCount(),1);
 assert.match(f.context.font,/18px.*Apple Color Emoji/);
 // After shifting, the painted center equals the 20px line box's midpoint.
 const baseline=(20-18-4)/2+18;
 assert.equal(baseline+(3-13)/2+parseFloat(save.style['--wc-glyph-offset']),10);
});
test('unavailable or incomplete canvas metrics preserve usable native emoji',()=>{
 const f=fixture({actualBoundingBoxAscent:12,actualBoundingBoxDescent:2});const glyph=f.glyph('💾');
 assert.doesNotThrow(()=>f.A.centerGlyphs({querySelectorAll:()=>[glyph]}));
 assert.equal(glyph.style['--wc-glyph-offset'],undefined);
 const c=vm.createContext({document:{createElement:()=>({getContext:()=>null})}});vm.runInContext(source,c);
 assert.doesNotThrow(()=>c.WeavyAppearance.centerGlyphs({querySelectorAll:()=>[glyph]}));
});
