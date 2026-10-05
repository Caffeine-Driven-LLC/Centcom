#!/usr/bin/env python3
"""Writes gallery.html: a self-contained page that plays every animation from animations.json."""
import json
data = json.load(open('animations.json'))
page = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cento Animations</title>
<style>
:root{--bg:#13111f;--card:#1c1930;--line:#2e2850;--ink:#e9e5ff;--dim:#8e88a8;--acc:#7c5cff;--mint:#3df2c8}
@media (prefers-color-scheme:light){:root:not([data-theme=dark]){--bg:#f4f1ff;--card:#fff;--line:#ddd6ff;--ink:#1b1530;--dim:#6b6490}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
header{padding:24px 16px 8px;max-width:1280px;margin:auto}h1{font-size:22px;margin:0 0 4px}p.sub{margin:0;color:var(--dim)}
.bar{position:sticky;top:0;background:var(--bg);padding:12px 16px;border-bottom:1px solid var(--line);z-index:2}
.bar>div{max-width:1280px;margin:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input[type=search],select{background:var(--card);border:1px solid var(--line);color:var(--ink);padding:6px 10px;border-radius:8px;font:inherit}
input[type=search]{width:180px}
button.chip{background:var(--card);border:1px solid var(--line);color:var(--dim);padding:5px 10px;border-radius:999px;font:inherit;cursor:pointer}
button.chip[aria-pressed=true]{background:var(--acc);border-color:var(--acc);color:#fff}
label.opt{color:var(--dim);display:flex;gap:6px;align-items:center}
main{max-width:1280px;margin:16px auto;padding:0 16px 48px;display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px;cursor:pointer}
.card:hover{border-color:var(--acc)}.stage{height:150px;display:flex;align-items:center;justify-content:center;background:#13111f;border-radius:8px;overflow:hidden}
canvas{image-rendering:pixelated;max-width:100%;max-height:100%}.name{font-weight:600}.meta{color:var(--dim);font-size:12px}
dialog{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:16px;max-width:94vw}
dialog::backdrop{background:#000a}dialog canvas{display:block;margin:8px auto}.count{color:var(--mint)}
</style></head><body>
<header><h1>Cento <span class="count" id="count"></span></h1><p class="sub">Every animation, live. Pick a colour and a crowd size; click a card to enlarge.</p></header>
<div class="bar"><div><input type="search" id="q" placeholder="search…"><span id="chips"></span>
<label class="opt">colour <select id="col"></select></label>
<label class="opt">crowd <select id="crowd"><option value="1">solo</option><option value="2">duo</option><option value="3">trio</option><option value="4">squad</option><option value="6">group</option></select></label>
<label class="opt">speed <input type="range" id="spd" min="0.25" max="2" step="0.25" value="1"></label></div></div>
<main id="grid"></main>
<dialog id="dlg"><div id="dname" class="name"></div><div id="ddesc" class="meta"></div><canvas id="dc"></canvas><form method="dialog"><button class="chip">close</button></form></dialog>
<script>
const DATA=__DATA__;
const pal=DATA.palette,anims=DATA.animations,COLORS=DATA.colors,PM=DATA.palmap;
const MIX=[0,3,1,2,4,2];            // colour order used for crowds: violet, green, red, yellow, brown, yellow
let speed=1,cat='all',q='',colIdx=0,crowd=1;
function charMap(k){const m={},me=PM[COLORS[k]],fr=PM[COLORS[(k+1)%COLORS.length]];
  ['B','D','H','S'].forEach(c=>m[c]=me[c]);m['1']=fr.B;m['2']=fr.D;m['3']=fr.H;m['9']=null;return m}
function colourFor(ch,map){return map[ch]!==undefined&&map[ch]!==null?pal[map[ch]]:pal[ch]}
function player(cv,a,scale,k,n){
  const cols=n<=1?1:n<=3?n:(n===4?2:3),rows=Math.ceil(n/cols),gap=2;
  cv.width=(cols*(a.w+gap)-gap)*scale;cv.height=(rows*(a.h+gap)-gap)*scale;
  const c=cv.getContext('2d'),T=a.frames.reduce((s,f)=>s+f.d,0),starts=[];let acc=0;a.frames.forEach(f=>{starts.push(acc);acc+=f.d});
  const maps=[...Array(n)].map((_,j)=>charMap(n===1?k:MIX[j%MIX.length]));let raf,t0=performance.now();
  function frameAt(t){let i=starts.length-1;while(i>0&&starts[i]>t)i--;return a.frames[i]}
  function draw(now){const el=(now-t0)*speed;c.clearRect(0,0,cv.width,cv.height);
    for(let j=0;j<n;j++){const t=(el+j*T/(2*n))%T,f=frameAt(t),ox=(j%cols)*(a.w+gap),oy=Math.floor(j/cols)*(a.h+gap);
      f.rows.forEach((row,y)=>{for(let x=0;x<row.length;x++){const ch=row[x];if(ch!=='.'){c.fillStyle=colourFor(ch,maps[j]);c.fillRect((ox+x)*scale,(oy+y)*scale,scale,scale)}}})}
    raf=requestAnimationFrame(draw)}
  raf=requestAnimationFrame(draw);return()=>cancelAnimationFrame(raf)}
const grid=document.getElementById('grid'),stops=[];
function render(){stops.splice(0).forEach(s=>s());grid.innerHTML='';let n=0;
  anims.filter(a=>(cat==='all'||a.cat===cat)&&a.name.includes(q)).forEach(a=>{n++;
    const d=document.createElement('div');d.className='card';const total=a.frames.reduce((s,f)=>s+f.d,0);
    d.innerHTML=`<div class="stage"><canvas></canvas></div><div class="name">${a.name}</div><div class="meta">${a.cat} · ${a.frames.length} frames · ${(total/1000).toFixed(1)}s</div>`;
    grid.appendChild(d);const cv=d.querySelector('canvas'),cw=crowd<=1?1:crowd<=3?crowd:(crowd===4?2:3),rw=Math.ceil(crowd/cw);
    stops.push(player(cv,a,Math.max(1,Math.min(Math.floor(190/(cw*(a.w+2))),Math.floor(138/(rw*(a.h+2))),6)),colIdx,crowd));
    d.onclick=()=>{const dl=document.getElementById('dlg');document.getElementById('dname').textContent=a.name;document.getElementById('ddesc').textContent=a.desc;
      const stop=player(document.getElementById('dc'),a,Math.max(3,Math.min(Math.floor(innerWidth*.8/(cw*(a.w+2))),Math.floor(innerHeight*.6/(rw*(a.h+2))),14)),colIdx,crowd);dl.onclose=stop;dl.showModal()}});
  document.getElementById('count').textContent=n+' animations'}
const cats=['all',...new Set(anims.map(a=>a.cat))],chips=document.getElementById('chips');
cats.forEach(c=>{const b=document.createElement('button');b.className='chip';b.textContent=c;b.setAttribute('aria-pressed',c==='all');
  b.onclick=()=>{cat=c;chips.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));render()};chips.appendChild(b)});
const sel=document.getElementById('col');COLORS.forEach((c,i)=>{const o=document.createElement('option');o.value=i;o.textContent=c;sel.appendChild(o)});
sel.onchange=e=>{colIdx=+e.target.value;render()};
document.getElementById('crowd').onchange=e=>{crowd=+e.target.value;render()};
document.getElementById('q').oninput=e=>{q=e.target.value.toLowerCase();render()};
document.getElementById('spd').oninput=e=>{speed=+e.target.value};
render();
</script></body></html>'''
open('gallery.html', 'w').write(page.replace('__DATA__', json.dumps(data, separators=(',', ':'))))
print('gallery.html', len(page) // 1024, 'KB template')
