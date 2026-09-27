const { chromium } = require(process.env.PLAYWRIGHT||'playwright');const path=require('path');
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1400,height:900}});const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.route(/fonts/,r=>r.abort());
await p.goto('file://'+path.resolve(__dirname,'../index.html'));await p.click('#studioBtn');
const r=await p.evaluate(()=>{const S=window.__studio,res=[];const pats=[...document.querySelectorAll('#pattern option')].map(o=>o.value);
 for(const pat of pats)for(const m of ['plan','axon','perspective'])for(const prim of ['flat','solid']){const sel=document.querySelector('#pattern');sel.value=pat;sel.dispatchEvent(new Event('change'));document.querySelector(`#viewMode [data-mode="${m}"]`).click();document.querySelector(`#primitiveMode [data-primitive="${prim}"]`).click();
  const st=document.querySelector('#step');st.value=st.max;st.dispatchEvent(new Event('input'));Object.keys(S.ST.layers).forEach(k=>S.ST.layers[k].on=true);
  const t0=performance.now();const g=S.geometry(0.1),pl=S.plotterPlan(g),sh=S.stencilSheets(S.geometry(0.35));const ms=performance.now()-t0;
  const bad=g.strokes.some(s=>s.pts.some(q=>q.some(v=>!isFinite(v))))||sh.some(s=>s.slots.some(poly=>poly.some(q=>q.some(v=>!isFinite(v)))));
  res.push({k:pat+'/'+m+'/'+prim,ms:Math.round(ms),bad})}
 return {n:res.length,worst:res.sort((a,b)=>b.ms-a.ms).slice(0,3),bad:res.filter(x=>x.bad).map(x=>x.k)}});
console.log(JSON.stringify({...r,errs}));await b.close()})();
