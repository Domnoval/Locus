const { chromium } = require(process.env.PLAYWRIGHT||'playwright');const path=require('path');
(async()=>{const b=await chromium.launch();const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.route(/fonts/,r=>r.abort());
await p.goto('file://'+path.resolve(__dirname,'../index.html'));
const r=await p.evaluate(async()=>{const pats=[...document.querySelectorAll('#pattern option')].map(o=>o.value);let n=0,labelMiss=[];
 const fire=(el,t)=>el.dispatchEvent(new Event(t,{bubbles:true}));
 for(const pat of pats){const s=document.querySelector('#pattern');s.value=pat;fire(s,'change');
  for(const m of ['plan','axon','perspective']){document.querySelector(`#viewMode [data-mode="${m}"]`).click();
   for(const pts of (m==='perspective'?[1,2,3]:[1])){document.querySelector(`#perspectiveMode [data-points="${pts}"]`).click();
    for(const tog of [[],['phi','dimensions','multiView','fruit','mirror']]){tog.forEach(t=>{const c=document.querySelector(`.chip[data-toggle="${t}"]`);if(!c.disabled&&!c.hidden)c.click()});
     // every step must show the label its own construction step carries (a step with no label of its own, or a label from somewhere else, is the miss this looks for)
     const st=document.querySelector('#step'),K=window.__k();for(let i=1;i<=+st.max;i++){st.value=i;fire(st,'input');n++;const own=K.steps[i-1]&&K.steps[i-1].label;if(!own||!own.trim()||document.querySelector('#phaseLabel').textContent!==`${own} · Step ${i}`)labelMiss.push(pat+i)}
     tog.forEach(t=>{const c=document.querySelector(`.chip[data-toggle="${t}"]`);if(!c.disabled&&!c.hidden)c.click()});}}}}
 return {renders:n,labelMiss:[...new Set(labelMiss)]}});
// undo/redo storm
for(let i=0;i<30;i++)await p.keyboard.press('Control+z');for(let i=0;i<30;i++)await p.keyboard.press('Control+y');
console.log(JSON.stringify({...r,errs}));await b.close();
// a sweep that finds something fails
if(errs.length||r.labelMiss.length||!r.renders){console.error(`FAIL  ${errs.length} script error(s), ${r.labelMiss.length} step label(s) missing or wrong, ${r.renders} renders`);process.exit(1)}})();
