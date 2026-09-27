const { chromium } = require(process.env.PLAYWRIGHT||'playwright');const path=require('path');
(async()=>{const b=await chromium.launch();const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.route(/fonts/,r=>r.abort());
await p.goto('file://'+path.resolve(__dirname,'../index.html'));
const r=await p.evaluate(async()=>{const pats=[...document.querySelectorAll('#pattern option')].map(o=>o.value);let n=0,labelMiss=[];
 const fire=(el,t)=>el.dispatchEvent(new Event(t,{bubbles:true}));
 for(const pat of pats){const s=document.querySelector('#pattern');s.value=pat;fire(s,'change');
  for(const m of ['plan','axon','perspective']){document.querySelector(`#viewMode [data-mode="${m}"]`).click();
   for(const pts of (m==='perspective'?[1,2,3]:[1])){document.querySelector(`#perspectiveMode [data-points="${pts}"]`).click();
    for(const tog of [[],['phi','dimensions','multiView','fruit','mirror']]){tog.forEach(t=>{const c=document.querySelector(`.chip[data-toggle="${t}"]`);if(!c.disabled&&!c.hidden)c.click()});
     const st=document.querySelector('#step');for(let i=1;i<=+st.max;i++){st.value=i;fire(st,'input');n++;if(/Completion/.test(document.querySelector('#phaseLabel').textContent)&&pat!=='seed')labelMiss.push(pat+i)}
     tog.forEach(t=>{const c=document.querySelector(`.chip[data-toggle="${t}"]`);if(!c.disabled&&!c.hidden)c.click()});}}}}
 return {renders:n,labelMiss:[...new Set(labelMiss)]}});
// undo/redo storm
for(let i=0;i<30;i++)await p.keyboard.press('Control+z');for(let i=0;i<30;i++)await p.keyboard.press('Control+y');
console.log(JSON.stringify({...r,errs}));await b.close()})();
