const { chromium } = require(process.env.PLAYWRIGHT||'playwright');
const path=require('path');
(async()=>{
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1400,height:900}});
  const page=await ctx.newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)/,r=>r.abort());
  await page.goto('file://'+path.resolve(process.argv[2]));
  const out={};
  const setStep=async v=>page.$eval('#step',(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))},v);
  const go=async(p,mode='plan')=>{await page.selectOption('#pattern',p);await page.click(`#viewMode button[data-mode="${mode}"]`)};
  // parse path d -> points (plan view: screen = 450+x, 350+y)
  const paths=sel=>page.$$eval(sel,ps=>ps.map(p=>p.getAttribute('d').match(/-?\d+\.?\d*/g).map(Number)).map(a=>{const pts=[];for(let i=0;i<a.length;i+=2)pts.push([a[i]-450,a[i+1]-350]);return pts}));
  const fitCircle=pts=>{const cx=pts.reduce((s,p)=>s+p[0],0)/pts.length,cy=pts.reduce((s,p)=>s+p[1],0)/pts.length;return{cx,cy,r:Math.hypot(pts[0][0]-cx,pts[0][1]-cy)}};
  out.defaults=await page.$$eval('.chip[data-toggle]',bs=>Object.fromEntries(bs.map(b=>[b.dataset.toggle,b.getAttribute('aria-pressed')])));
  // Flower
  await go('flower');await setStep(20);
  const fl=(await paths('#shapeLayer path')).map(fitCircle);
  const d=Math.hypot(fl[1].cx-fl[0].cx,fl[1].cy-fl[0].cy);
  const bnd=fitCircle((await paths('#guideLayer path'))[0]);
  let throughNeighbours=0;fl.forEach(a=>fl.forEach(b=>{const dd=Math.hypot(a.cx-b.cx,a.cy-b.cy);if(Math.abs(dd-d)<.5&&Math.abs(a.r-dd)<.5)throughNeighbours++}));
  out.flower={circles:fl.length,radius:+fl[0].r.toFixed(2),spacing:+d.toFixed(2),boundary:+bnd.r.toFixed(2),maxReach:+Math.max(...fl.map(c=>Math.hypot(c.cx,c.cy)+c.r)).toFixed(2),circleThroughNeighbourCentre_pairs:throughNeighbours};
  await setStep(7);out.flower.step7=await page.textContent('#phaseLabel');
  const seed7=(await paths('#shapeLayer path')).map(fitCircle);
  out.flower.seed7_ring=seed7.slice(1).map(c=>+Math.hypot(c.cx,c.cy).toFixed(1)).join(',');
  // Metatron chords
  await go('metatron');await setStep(17);
  const segs=await paths('#shapeLayer path');out.metatron={segments:segs.length};
  const lens=segs.map(s=>Math.hypot(s[1][0]-s[0][0],s[1][1]-s[0][1])/92);
  out.metatron.sqrt3chords=lens.filter(l=>Math.abs(l-Math.sqrt(3))<.01).length;
  await page.click('#fruitChip');const fr=(await paths('#guideLayer path')).map(fitCircle);
  out.metatron.fruitRadius=+fr[0].r.toFixed(2);out.metatron.fruitVisibleElsewhere=null;
  await page.click('#fruitChip');
  // Vesica
  await go('vesica');await setStep(5);
  const shp=await paths('#shapeLayer path');const lensArcs=await page.$$eval('#shapeLayer path',ps=>ps.filter(p=>p.dataset.kind==='lens').length);
  const arcs=(await page.$$eval('#shapeLayer path[data-kind="lens"]',ps=>ps.map(p=>p.getAttribute('d'))));
  const ap=arcs.flatMap(dd=>{const a=dd.match(/-?\d+\.?\d*/g).map(Number);const r=[];for(let i=0;i<a.length;i+=2)r.push([a[i]-450,a[i+1]-350]);return r});
  const W=Math.max(...ap.map(p=>p[0]))-Math.min(...ap.map(p=>p[0])),H=Math.max(...ap.map(p=>p[1]))-Math.min(...ap.map(p=>p[1]));
  out.vesica={lensArcs,lensPointCount:ap.length,ratio:+(H/W).toFixed(4),label:await page.$$eval('#guideLayer text',t=>t.map(x=>x.textContent)),phase:await page.textContent('#phaseLabel')};
  // Yantra
  await go('yantra');await setStep(10);
  const tris=await paths('#shapeLayer path');
  const orient=tris.map(t=>{const ys=t.map(p=>p[1]);const apexIdx=0;return t[0][1]<t[1][1]?'up':'down'});
  out.yantra={up:orient.filter(o=>o==='up').length,down:orient.filter(o=>o==='down').length,innermost:orient[orient.length-1],phase:await page.textContent('#phaseLabel')};
  // Circumsphere
  for(const s of ['cube','dodecahedron','icosahedron']){await go(s);await setStep(8);
    const g=(await paths('#guideLayer path')).map(fitCircle);const verts=await paths('#shapeLayer path');
    const vr=Math.max(...verts.flat().map(p=>Math.hypot(p[0],p[1])));
    out['sphere_'+s]={sphere:+g[0].r.toFixed(1),maxVertexRadiusInPlan:+vr.toFixed(1),phase:await page.textContent('#phaseLabel')};
    await setStep(7);out['sphere_'+s].step7=await page.textContent('#phaseLabel');out['sphere_'+s].step7edges=(await paths('#shapeLayer path')).length;
  }
  // φ availability
  await go('flower');out.phiChipDisabledOnFlower=await page.$eval('#phiChip',b=>b.disabled);
  await go('dodecahedron');out.phiChipDisabledOnDodeca=await page.$eval('#phiChip',b=>b.disabled);
  // primitive reset
  await go('cube');const p1=await page.$eval('#primitiveMode .active',b=>b.dataset.primitive);await go('seed');const p2=await page.$eval('#primitiveMode .active',b=>b.dataset.primitive);
  out.primitive={afterCube:p1,afterSeed:p2};
  // tilt in 2pt / 3pt
  await go('cube','perspective');await page.click('#autoRotateBtn').catch(()=>{});
  for(const pts of [2,3]){await page.click(`#perspectiveMode button[data-points="${pts}"]`);
    const a=await page.$eval('#shapeLayer',g=>g.innerHTML.length+':'+[...g.querySelectorAll('path')].map(p=>p.getAttribute('d')).join('').slice(0,60));
    await page.$eval('#tilt',el=>{el.value=5;el.dispatchEvent(new Event('input',{bubbles:true}))});
    const b=await page.$eval('#shapeLayer',g=>[...g.querySelectorAll('path')].map(p=>p.getAttribute('d')).join('').slice(0,60));
    out['tilt'+pts+'pt_changesDrawing']=!a.endsWith(b);
    await page.$eval('#tilt',el=>{el.value=34;el.dispatchEvent(new Event('input',{bubbles:true}))});}
  // VP dots
  out.vpDots=await page.$$eval('#perspectiveLayer .vp-dot',x=>x.length);
  // isSpatial global
  out.isSpatialOnWindow='isSpatial' in await page.evaluate(()=>({...(('isSpatial' in window)?{isSpatial:1}:{})}));
  // aria-live mutations during auto-rotate for 1s
  await page.click('#perspectiveMode button[data-points="1"]');
  const ar=await page.$eval('#autoRotateBtn',b=>b.classList.contains('active'));if(!ar)await page.click('#autoRotateBtn');
  out.liveMutationsPerSec=await page.evaluate(()=>new Promise(res=>{let n=0;const mo=new MutationObserver(m=>n+=m.length);mo.observe(document.getElementById('statusLine'),{childList:true,subtree:true,characterData:true});const r0=document.getElementById('rotation').value;setTimeout(()=>{mo.disconnect();res({mutations:n,rotated:r0!==document.getElementById('rotation').value})},1000)}));
  // undo during flick
  await page.click('#autoRotateBtn');
  const box=await page.locator('#canvasWrap').boundingBox();
  await page.mouse.move(box.x+300,box.y+300);await page.mouse.down();for(let i=1;i<=6;i++){await page.mouse.move(box.x+300+i*60,box.y+300);await page.waitForTimeout(8)}await page.mouse.up();
  await page.click('#undoBtn');const r1=await page.$eval('#rotation',e=>+e.value);await page.waitForTimeout(800);const r2=await page.$eval('#rotation',e=>+e.value);
  out.undoDuringFlick={afterUndo:r1,after800ms:r2};
  out.errs=errs;
  console.log(JSON.stringify(out,null,1));await browser.close();
})();
