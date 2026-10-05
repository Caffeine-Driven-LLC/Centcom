#!/usr/bin/env python3
"""Writes preview.html: a live style guide for the Cento theme (palette, type, components, mascot)."""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
T = json.load(open(f'{HERE}/tokens.json'))
mascot = open(f'{HERE}/../mascot/svg/idle_blink.svg').read() if os.path.exists(f'{HERE}/../mascot/svg/idle_blink.svg') else ''
mascot = re.sub(r'width="\d+" height="\d+"', 'width="96" height="96"', mascot, count=1)
verbs = [l.strip() for l in open(f'{HERE}/../The-Lines.txt') if l.strip()][:12]

page = '''<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cento Theme</title>
<link rel="stylesheet" href="theme.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Silkscreen:wght@400;700&display=swap">
<style>
*{box-sizing:border-box}body{margin:0;background:var(--bg-base);color:var(--text-primary);font:400 var(--text-base)/1 var(--font-sans);font-size:14px;line-height:22px}
.wrap{max-width:1100px;margin:0 auto;padding:var(--space-8) var(--space-4) 96px}
h1,h2,h3{margin:0;font-weight:600}h1{font:700 36px/44px var(--font-pixel);letter-spacing:.02em}h2{font:600 22px/30px var(--font-sans);margin:56px 0 12px;padding-top:24px;border-top:1px solid var(--border-subtle)}
h3{font:600 12px/18px var(--font-mono);color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin:24px 0 8px}
p{color:var(--text-secondary);margin:6px 0}.mono{font-family:var(--font-mono)}
header{display:flex;gap:24px;align-items:center;flex-wrap:wrap}header .sub{color:var(--text-secondary)}
.tog{margin-left:auto;background:var(--bg-raised);color:var(--text-primary);border:1px solid var(--border-default);border-radius:var(--radius-md);padding:8px 14px;font:inherit;cursor:pointer}
.tog:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid var(--focus-ring);outline-offset:2px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.sw{border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;background:var(--bg-surface)}
.sw i{display:block;height:56px}.sw b{display:block;padding:6px 8px 0;font:600 12px/16px var(--font-mono)}.sw span{display:block;padding:0 8px 8px;font:12px/16px var(--font-mono);color:var(--text-muted)}
.ramp{display:flex;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--border-subtle);margin:6px 0}.ramp div{flex:1;height:52px;display:flex;align-items:flex-end;padding:4px 6px;font:11px/14px var(--font-mono)}
.card{background:var(--bg-surface);border:1px solid var(--border-default);border-radius:var(--radius-lg);padding:16px;box-shadow:var(--shadow-pixel-md)}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.btn{border:1px solid transparent;border-radius:var(--radius-md);padding:8px 16px;font:600 14px/22px var(--font-sans);cursor:pointer;transition:background var(--dur-base) var(--ease-standard)}
.btn.primary{background:var(--accent-fill);color:var(--accent-on)}.btn.primary:hover{background:var(--accent-hover);color:#fff}
.btn.sec{background:var(--bg-raised);border-color:var(--border-default);color:var(--text-primary)}.btn.sec:hover{background:var(--bg-hover)}
.btn.ghost{background:transparent;color:var(--text-link)}.btn.danger{background:var(--status-danger-subtle);color:var(--status-danger);border-color:var(--status-danger)}
.chip{display:inline-flex;gap:6px;align-items:center;padding:2px 10px;border-radius:var(--radius-pill);font:500 12px/18px var(--font-mono);border:1px solid var(--border-default);background:var(--bg-raised)}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.banner{display:flex;gap:10px;padding:10px 14px;border-radius:var(--radius-md);border:1px solid;margin:8px 0;font-size:13px}
.b-success{background:var(--status-success-subtle);color:var(--status-success);border-color:var(--status-success)}
.b-warning{background:var(--status-warning-subtle);color:var(--status-warning);border-color:var(--status-warning)}
.b-danger{background:var(--status-danger-subtle);color:var(--status-danger);border-color:var(--status-danger)}
.b-info{background:var(--status-info-subtle);color:var(--status-info);border-color:var(--status-info)}
.term{background:var(--bg-sunken);border:1px solid var(--border-default);border-radius:var(--radius-lg);overflow:hidden;font:400 13px/20px var(--font-mono);box-shadow:var(--shadow-pixel-md)}
.term .bar{display:flex;gap:6px;padding:8px 12px;background:var(--bg-raised);border-bottom:1px solid var(--border-subtle);color:var(--text-muted);font-size:12px}
.term .bar i{width:10px;height:10px;border-radius:50%;background:var(--border-strong)}.term pre{margin:0;padding:14px 16px;white-space:pre-wrap}
.t-user{color:var(--accent-hover)}.t-dim{color:var(--text-muted)}.t-ok{color:var(--status-success)}.t-err{color:var(--status-danger)}.t-sig{color:var(--signal)}.t-warn{color:var(--status-warning)}.t-info{color:var(--status-info)}
.add{background:var(--status-success-subtle);color:var(--status-success)}.del{background:var(--status-danger-subtle);color:var(--status-danger)}
.spin{display:flex;gap:14px;align-items:center}.spin svg{image-rendering:pixelated;flex:none}
.pres{display:flex}.pres .av{width:32px;height:32px;border-radius:var(--radius-md);border:2px solid var(--bg-base);margin-left:-8px;display:grid;place-items:center;font:700 11px var(--font-pixel);color:#0b1026}
.pres .av:first-child{margin-left:0}
.type div{padding:6px 0;border-bottom:1px dashed var(--border-subtle);display:flex;gap:16px;align-items:baseline}.type small{width:90px;flex:none;color:var(--text-muted);font:12px var(--font-mono)}
.tabs{display:flex;border-bottom:1px solid var(--border-default)}.tabs a{padding:8px 14px;color:var(--text-secondary);text-decoration:none;border-bottom:2px solid transparent}.tabs a[aria-current]{color:var(--text-primary);border-color:var(--signal)}
input.in{background:var(--bg-sunken);border:1px solid var(--border-default);color:var(--text-primary);border-radius:var(--radius-md);padding:8px 12px;font:14px var(--font-mono);width:260px}
input.in::placeholder{color:var(--text-muted)}input.in:focus{outline:2px solid var(--focus-ring);outline-offset:1px}
</style></head><body><div class="wrap">
<header><div>__MASCOT__</div><div><h1>CENTO</h1><div class="sub">Abyss / Shallows: the Centcom theme. Live style guide.</div></div>
<button class="tog" id="tog">Toggle Abyss / Shallows</button></header>

<h2>Palette</h2><p>Four ramps plus a status set. Semantic tokens (below) are what components use, never raw ramp values.</p>
<div id="ramps"></div>
<h3>Semantic tokens (current theme)</h3><div class="grid" id="sem"></div>
<h3>Presence colours (the five Centos)</h3><div class="row"><div class="pres" id="pres"></div></div>

<h2>Typography</h2><div class="type" id="type"></div>

<h2>Terminal</h2>
<div class="term"><div class="bar"><i></i><i></i><i></i><span>cento &middot; ~/centcom &middot; main</span></div><pre>
<span class="t-sig">&#9679;</span> <span class="t-user">you</span>  add retry logic to the relay client

<span class="t-dim">__VERB__...  (12s &middot; 1.4k tokens &middot; esc to interrupt)</span>

<span class="t-sig">&#9679;</span> Read(<span class="t-info">src/relay/client.ts</span>)
  <span class="t-dim">&#9492; 214 lines</span>
<span class="t-sig">&#9679;</span> Update(<span class="t-info">src/relay/client.ts</span>)
<span class="del">- await socket.send(msg)</span>
<span class="add">+ await retry(() =&gt; socket.send(msg), { attempts: 5, backoff: 'exp' })</span>

<span class="t-warn">?</span> Allow Cento to run <span class="t-sig">npm test</span>?  <span class="t-dim">[y] yes  [n] no  [a] always</span>
<span class="t-ok">&#10003;</span> 42 passed   <span class="t-err">&#10007;</span> 1 failed   <span class="t-dim">relay/client.test.ts:88</span>
</pre></div>

<h2>Controls</h2>
<div class="row"><button class="btn primary">Start mission</button><button class="btn sec">Invite teammate</button><button class="btn ghost">Read the docs</button><button class="btn danger">Stop agent</button>
<input class="in" placeholder="message the fleet..."></div>
<h3>Chips</h3><div class="row"><span class="chip"><i class="dot" style="background:var(--status-success)"></i>online</span><span class="chip"><i class="dot" style="background:var(--status-warning)"></i>queued &middot; 2</span><span class="chip"><i class="dot" style="background:var(--status-danger)"></i>failed</span><span class="chip"><i class="dot" style="background:var(--signal)"></i>host</span><span class="chip">PRO</span></div>
<h3>Tabs</h3><div class="tabs"><a href="#" aria-current="page">Session</a><a href="#">Agents</a><a href="#">Branches</a><a href="#">Team</a></div>
<h3>Banners</h3>
<div class="banner b-success">&#10003; Merged into main. CI is green.</div><div class="banner b-warning">! Usage at 82% of this month's quota.</div>
<div class="banner b-danger">&#10007; Lost connection to the relay. Retrying in 4s.</div><div class="banner b-info">i Version 1.4 is ready. Restart to update.</div>

<h2>Cards</h2>
<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
<div class="card"><b>agent/feature-retry</b><p>Cento &middot; editing 3 files</p><div class="row"><span class="chip"><i class="dot" style="background:var(--presence-violet)"></i>you</span><span class="chip">worktree</span></div></div>
<div class="card"><b>agent/fix-flaky-test</b><p>Cento Green &middot; waiting for approval</p><div class="row"><span class="chip"><i class="dot" style="background:var(--presence-green)"></i>maya</span><span class="chip">needs you</span></div></div>
<div class="card"><b>agent/docs-pass</b><p>Cento Yellow &middot; done</p><div class="row"><span class="chip"><i class="dot" style="background:var(--presence-yellow)"></i>sam</span><span class="chip">ready to merge</span></div></div></div>
</div>
<script>
const T=__TOKENS__;
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
document.getElementById('tog').onclick=()=>{const r=document.documentElement;r.dataset.theme=r.dataset.theme==='dark'?'light':'dark';sem()};
const ramps=document.getElementById('ramps');
for(const [name,steps] of Object.entries(T.palette)){const h=document.createElement('div');h.innerHTML='<h3>'+name+'</h3>';const r=document.createElement('div');r.className='ramp';
  for(const [k,v] of Object.entries(steps)){const d=document.createElement('div');d.style.background=v;const l=parseInt(v.slice(1,3),16)*.3+parseInt(v.slice(3,5),16)*.59+parseInt(v.slice(5,7),16)*.11;d.style.color=l>140?'#0b1026':'#fff';d.textContent=k;d.title=v;r.appendChild(d)}
  h.appendChild(r);ramps.appendChild(h)}
function sem(){const g=document.getElementById('sem');g.innerHTML='';for(const k of Object.keys(T.semantic)){const n='--'+k.replace(/\\./g,'-');const s=document.createElement('div');s.className='sw';s.innerHTML='<i style="background:var('+n+')"></i><b>'+k+'</b><span>'+css(n)+'</span>';g.appendChild(s)}}
sem();
const cm={violet:'#7C5CFF',red:'#FF2D2D',yellow:'#FFD500',green:'#22C55E',brown:'#8B5A2B'};
document.getElementById('pres').innerHTML=Object.entries(cm).map(([k,v])=>'<div class="av" style="background:'+v+';color:'+(k==='brown'||k==='violet'?'#fff':'#0b1026')+'" title="'+k+'">'+k[0].toUpperCase()+'</div>').join('');
const ty=document.getElementById('type');for(const [k,v] of Object.entries(T.typography.scale)){const d=document.createElement('div');d.innerHTML='<small>'+k+' '+v.size+'/'+v.line+'</small><span style="font:'+v.weight+' '+v.size+'px/'+v.line+'px var(--font-sans)">The octopus has three hearts</span>';ty.appendChild(d)}
ty.innerHTML+='<div><small>mono</small><span class="mono" style="font-size:14px">const fleet = await cento.dispatch(agents);</span></div><div><small>pixel</small><span style="font:700 22px/30px var(--font-pixel)">LEVEL UP</span></div>';
</script></body></html>'''
page = page.replace('__MASCOT__', mascot).replace('__TOKENS__', json.dumps(T)).replace('__VERB__', verbs[0].rstrip('…'))
open(f'{HERE}/preview.html', 'w').write(page)
print('preview.html', len(page) // 1024, 'KB')
