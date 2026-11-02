"""Render every cue and build a single self-contained audition page.

Run:  python tools/sound_design/build_demo.py
Out:  deliverables/memory-anki-sound-demo.html  (+ out/*.wav and out/manifest.json)
"""

from __future__ import annotations

import base64
import json
import subprocess
import time
from pathlib import Path

import numpy as np

import dsp
import palette

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
OUT = ROOT / "out"
DELIVERY = PROJECT / "deliverables" / "memory-anki-sound-demo.html"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    started = time.time()
    audio: dict[str, str] = {}
    manifest = []
    for cue in palette.CUES:
        x = palette.render_cue(cue)
        x = dsp.fade_edges(x)
        pcm = dsp.to_pcm16(x)
        raw = dsp.wav_bytes(pcm)
        wav_path = OUT / f"{cue.id}.wav"
        wav_path.write_bytes(raw)
        duration = pcm.shape[1] / dsp.OUT_SR
        # Tiny clicks stay lossless; anything with a tail is compressed for the
        # single-file audition page. Masters stay as WAV in out/.
        if duration <= 0.40:
            payload, fmt = raw, "wav"
        else:
            mp3_path = OUT / f"{cue.id}.mp3"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav_path),
                            "-c:a", "libmp3lame", "-b:a", "160k", "-ar", str(dsp.OUT_SR),
                            str(mp3_path)], check=True)
            payload, fmt = mp3_path.read_bytes(), "mp3"
        audio[cue.id] = base64.b64encode(payload).decode("ascii")
        manifest.append({
            "id": cue.id,
            "section": cue.section,
            "name": cue.name,
            "desc": cue.desc,
            "category": cue.category,
            "duration": round(duration, 3),
            "format": fmt,
            "bytes": len(payload),
        })
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    data = json.dumps(audio, ensure_ascii=False, separators=(",", ":"))
    items = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
    html = TEMPLATE.replace("__AUDIO__", data).replace("__ITEMS__", items)
    DELIVERY.parent.mkdir(parents=True, exist_ok=True)
    DELIVERY.write_text(html, encoding="utf-8")

    total = sum(len(v) for v in audio.values())
    print(f"rendered {len(manifest)} cues in {time.time() - started:.1f}s")
    print(f"audio payload: {total / 1024:.0f} KiB base64  ->  {DELIVERY.stat().st_size / 1024:.0f} KiB html")
    print("wrote", DELIVERY)


TEMPLATE = r"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memory Anki · 音效重制示范</title>
<style>
:root{
  --paper:#f6f1e7; --paper-2:#fbf8f2; --ink:#241f1a; --muted:#7d7367;
  --line:#e3d9c7; --line-2:#efe7d8; --accent:#a8452a; --accent-soft:#f0ddd3;
  --green:#2f5d50; --gold:#b78a3d; --shadow:0 1px 0 rgba(255,255,255,.7), 0 10px 30px -18px rgba(60,40,20,.45);
}
*{box-sizing:border-box}
html,body{margin:0}
body{
  background:
    radial-gradient(1100px 600px at 15% -10%, #fffdf8 0%, transparent 60%),
    radial-gradient(900px 500px at 95% 0%, #f3ead9 0%, transparent 55%),
    var(--paper);
  color:var(--ink);
  font:15px/1.6 "PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;
  -webkit-font-smoothing:antialiased;
}
body::before{
  content:"";position:fixed;inset:0;pointer-events:none;opacity:.35;z-index:0;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3'/%3E%3CfeColorMatrix values='0 0 0 0 .55 0 0 0 0 .5 0 0 0 0 .42 0 0 0 .05 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
}
.wrap{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:44px 24px 90px}
header.top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;
  border-bottom:1px solid var(--line);padding-bottom:22px}
.kicker{font-size:11px;letter-spacing:.32em;color:var(--muted);text-transform:uppercase}
h1{font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-weight:600;font-size:34px;
  line-height:1.2;margin:8px 0 10px;letter-spacing:.01em}
h1 em{font-style:normal;color:var(--accent)}
.lede{color:var(--muted);max-width:52ch;margin:0;font-size:14px}
.controls{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding-bottom:4px}
.vol{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted);letter-spacing:.08em}
input[type=range]{appearance:none;width:132px;height:2px;background:var(--line);border-radius:2px;outline:none}
input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;
  background:var(--accent);border:2px solid var(--paper-2);box-shadow:0 0 0 1px var(--accent);cursor:pointer}
.ghost{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;
  padding:6px 14px;font-size:12px;cursor:pointer;letter-spacing:.06em}
.ghost:hover{color:var(--ink);border-color:var(--muted)}
nav.tabs{position:sticky;top:0;z-index:20;display:flex;gap:6px;overflow-x:auto;padding:14px 0 12px;
  background:linear-gradient(var(--paper) 70%,rgba(246,241,231,0));scrollbar-width:none}
nav.tabs::-webkit-scrollbar{display:none}
nav.tabs button{border:0;background:transparent;color:var(--muted);font-size:13px;padding:7px 13px;
  border-radius:999px;cursor:pointer;white-space:nowrap;letter-spacing:.04em;font-family:inherit}
nav.tabs button:hover{color:var(--ink)}
nav.tabs button.on{background:var(--ink);color:var(--paper-2)}
section.panel{display:none;animation:fade .25s ease}
section.panel.on{display:block}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:26px 0 14px}
.sec-head h2{font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-weight:600;font-size:21px;margin:0}
.sec-head p{margin:0;color:var(--muted);font-size:13px;flex:1}
.playall{border:1px solid var(--line);background:var(--paper-2);border-radius:999px;padding:6px 14px;
  font-size:12px;color:var(--green);cursor:pointer;white-space:nowrap;font-family:inherit}
.playall:hover{border-color:var(--green)}
.cues{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:10px}
.cue{position:relative;display:grid;grid-template-columns:34px 1fr auto;align-items:center;gap:12px;
  text-align:left;border:1px solid var(--line-2);background:var(--paper-2);border-radius:14px;
  padding:11px 14px;cursor:pointer;transition:transform .12s,border-color .18s,box-shadow .18s;
  font-family:inherit;color:inherit;box-shadow:var(--shadow)}
.cue:hover{border-color:#d3c5ad;transform:translateY(-1px)}
.cue:active{transform:translateY(0) scale(.995)}
.cue.playing{border-color:var(--accent);background:#fff8f3}
.cue .idx{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;letter-spacing:.04em}
.cue .name{font-size:14px;font-weight:600;letter-spacing:.01em}
.cue .desc{font-size:11.5px;color:var(--muted);margin-top:1px;line-height:1.35}
.cue canvas{width:96px;height:30px;display:block;opacity:.55}
.cue.playing canvas{opacity:1}
.cue .meta{position:absolute;right:12px;bottom:6px;font-size:9.5px;color:#b3a894;font-variant-numeric:tabular-nums}
.scenarios{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:6px}
.scn{border:1px solid var(--line);background:linear-gradient(180deg,#fffdf8,var(--paper-2));border-radius:16px;
  padding:16px 16px 14px;cursor:pointer;text-align:left;font-family:inherit;color:inherit;box-shadow:var(--shadow);
  transition:transform .15s,border-color .2s}
.scn:hover{transform:translateY(-2px);border-color:#d3c5ad}
.scn .num{font-family:Georgia,serif;font-size:12px;color:var(--accent);letter-spacing:.2em}
.scn h3{font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-size:17px;margin:4px 0 6px;font-weight:600}
.scn p{margin:0;font-size:12px;color:var(--muted);line-height:1.5}
.scn .chips{display:flex;gap:5px;margin-top:10px;flex-wrap:wrap}
.chip{font-size:10px;color:var(--green);background:#e9f0ec;border-radius:999px;padding:2px 8px}
.compare{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:8px}
.direction{border:1px solid var(--line);border-radius:16px;padding:16px;background:var(--paper-2);box-shadow:var(--shadow)}
.direction h3{font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-size:18px;margin:0 0 2px;font-weight:600}
.direction .tone{font-size:11px;color:var(--accent);letter-spacing:.12em;margin-bottom:12px}
.direction .row{display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line-2);font-size:13px;cursor:pointer}
.direction .row:hover{color:var(--accent)}
.direction .row span:first-child{flex:1}
.direction .row .dot{width:6px;height:6px;border-radius:50%;background:var(--line)}
.direction .row.playing .dot{background:var(--accent)}
.direction ul{margin:0;padding-left:16px;font-size:11.5px;color:var(--muted);line-height:1.7}
footer{margin-top:44px;border-top:1px solid var(--line);padding-top:16px;font-size:11.5px;color:var(--muted);
  display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.meter{width:52px;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.meter i{display:block;height:100%;width:0%;background:linear-gradient(90deg,var(--green),var(--accent))}
.note{font-size:11px;color:#9b9082}
@media (max-width:760px){
  .wrap{padding:26px 16px 70px} h1{font-size:26px}
  .cues{grid-template-columns:1fr}
  .compare{grid-template-columns:1fr}
  .cue canvas{width:70px}
  .controls{width:100%}
}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <div class="kicker">Memory Anki · Sound System</div>
      <h1>声音重制 <em>试听示范</em></h1>
      <p class="lede">六种材质、一个调性（D 宫五声）。木块、卡林巴、玻璃叮、颂钵、床垫闷击、气流、铜片与真实纸张——取自公开音效库，经变调、剪裁与统一混响，长成同一件乐器家族。先听，再告诉我哪几处不对味。</p>
    </div>
    <div class="controls">
      <label class="vol">音量 <input id="vol" type="range" min="0" max="100" value="68"></label>
      <div class="meter"><i id="meter"></i></div>
      <button class="ghost" id="panic">静音</button>
    </div>
  </header>

  <nav class="tabs" id="tabs"></nav>
  <main id="main"></main>

  <footer>
    <span>音色来自 Freesound 音效库（CC0；翻页声为 CC BY 4.0 / flag2），本地变调、剪裁并统一混响与响度。素材清单见 tools/sound_design/SOURCES.md。</span>
    <span class="note" id="status">点任意一行开始试听</span>
  </footer>
</div>

<script>
const AUDIO = __AUDIO__;
const ITEMS = __ITEMS__;
const SECTIONS = [
  ['scenario','场景演示','真实操作顺序里连着听'],
  ['ui','界面微交互','每一次点击都有的那一声'],
  ['cards','翻卡与卡片','一次动作 = 一记，带动几张就几声'],
  ['grade','评分与连击','四档音高，耳朵能数出来'],
  ['quiz','答题','选中、提交、对错、看答案'],
  ['progress','进度与会话','25/50/75、翻页、单元与整轮'],
  ['edit','编辑与保存','脑图节点、拖拽、导入导出'],
  ['milestone','里程碑','分支清空、全清、整轮庆典'],
  ['error','错误与提醒','不刺耳，但一定听得见'],
  ['compare','音色方向','A/B/C 三种人格，选一个做全量'],
];

const SCENARIOS = [
  {title:'复习一张卡', desc:'翻卡 → 评「良好」→ 落点进进度条', steps:[['card.reveal',0],['grade.good',620],['grade.landing',1240]]},
  {title:'三张卡连翻', desc:'一次动作带动三张，音高逐张上行', cascade:{id:'card.reveal', count:3, gap:95, pattern:[0,0,2]}},
  {title:'答对一题', desc:'选中 → 提交 → 答对', steps:[['quiz.select',0],['quiz.submit',420],['quiz.correct',780]]},
  {title:'完成一个单元', desc:'评分 → 收尾钟 → 连击 → 单元完成', steps:[['grade.easy',0],['card.close',720],['grade.combo',1520],['unit.complete',2150]]},
  {title:'一轮结束', desc:'低鼓 + 铜片 + 五音琶音', steps:[['round.complete',0]]},
  {title:'编辑脑图', desc:'新建 → 拖拽 → 落定 → 保存', steps:[['node.create',0],['drag.start',520],['drag.drop',900],['save.success',1280]]},
];

const state = {ctx:null, master:null, buffers:{}, muted:false, playing:new Set()};

function ctxReady(){
  if(!state.ctx){
    const C = window.AudioContext || window.webkitAudioContext;
    state.ctx = new C();
    state.master = state.ctx.createGain();
    const comp = state.ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 18; comp.ratio.value = 2.5;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    state.master.connect(comp).connect(state.ctx.destination);
    applyVolume();
  }
  if(state.ctx.state !== 'running') state.ctx.resume();
  return state.ctx;
}
function applyVolume(){
  if(!state.master) return;
  const v = state.muted ? 0 : Number(document.getElementById('vol').value)/100;
  // The rendered one-shots are deliberately conservative; the audition adds
  // make-up gain so they sit at a normal listening level.
  state.master.gain.value = v * 2.0;
}
function b64(buf){
  const s = atob(buf); const a = new Uint8Array(s.length);
  for(let i=0;i<s.length;i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}
async function loadAll(){
  const ids = Object.keys(AUDIO);
  for(const id of ids){
    const decoded = await new Promise((res,rej)=>{
      state.ctx.decodeAudioData(b64(AUDIO[id]).slice(0), res, rej);
    });
    // MP3 encoders prepend a few ms; find the first audible sample and trim it
    // so every cue starts on the beat.
    const d = decoded.getChannelData(0);
    let lead = 0;
    while(lead < d.length && Math.abs(d[lead]) < 0.0008) lead++;
    if(lead > 0 && lead < decoded.length * 0.4){
      const trimmed = state.ctx.createBuffer(decoded.numberOfChannels, decoded.length - lead, decoded.sampleRate);
      for(let c=0;c<decoded.numberOfChannels;c++){
        trimmed.copyToChannel(decoded.getChannelData(c).slice(lead), c);
      }
      state.buffers[id] = trimmed;
    } else state.buffers[id] = decoded;
  }
}
function play(id, opt={}){
  const c = ctxReady();
  const b = state.buffers[id];
  if(!b) return;
  const src = c.createBufferSource(); src.buffer = b;
  src.playbackRate.value = opt.rate || 1;
  const g = c.createGain(); g.gain.value = opt.gain == null ? 1 : opt.gain;
  const p = c.createStereoPanner ? c.createStereoPanner() : null;
  if(p){ p.pan.value = opt.pan || 0; src.connect(g).connect(p).connect(state.master); }
  else src.connect(g).connect(state.master);
  src.start(c.currentTime + (opt.at || 0));
  flash(id, b.duration * 1000 + (opt.at || 0) * 1000);
  return src;
}
function drawVisible(){
  document.querySelectorAll('section.panel.on .cue').forEach(cue=>{
    const cv = cue._canvas || cue.querySelector('canvas');
    const id = cue.dataset.id;
    if(cv && state.buffers[id] && cv.clientWidth > 0) drawWave(cv, state.buffers[id]);
  });
}
function flash(id, ms){
  document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el=>{
    el.classList.add('playing');
    clearTimeout(el._t);
    el._t = setTimeout(()=>el.classList.remove('playing'), Math.max(360, ms));
  });
}
function cascade(id, count, gap, pattern){
  const p = pattern || [0,0,2,0,4];
  for(let i=0;i<count;i++){
    play(id, {at:(i*gap)/1000, rate: Math.pow(2, (p[i%p.length]||0)/12), gain: Math.max(.25, 1 - i*.08)});
  }
}
async function playScenario(scn){
  ctxReady();
  if(scn.cascade){ cascade(scn.cascade.id, scn.cascade.count, scn.cascade.gap, scn.cascade.pattern); return; }
  for(const [id, at] of scn.steps) play(id, {at: at/1000});
}
function drawWave(canvas, buf){
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w*dpr; canvas.height = h*dpr;
  const g = canvas.getContext('2d'); g.scale(dpr,dpr);
  const data = buf.getChannelData(0);
  let peak = 0;
  for(let i=0;i<data.length;i++){ const v=Math.abs(data[i]); if(v>peak) peak=v; }
  const norm = peak > 1e-6 ? 1/peak : 0;
  const step = Math.max(1, Math.floor(data.length/w));
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink');
  g.globalAlpha = .85; g.lineWidth = 1; g.beginPath();
  const mid = h/2;
  for(let x=0;x<w;x++){
    let min=1,max=-1;
    for(let j=0;j<step;j++){ const v=(data[x*step+j]||0)*norm; if(v<min)min=v; if(v>max)max=v; }
    g.moveTo(x+.5, mid - max*mid*.88);
    g.lineTo(x+.5, mid - min*mid*.88);
  }
  g.stroke();
  g.globalAlpha=.25; g.beginPath(); g.moveTo(0,mid+.5); g.lineTo(w,mid+.5); g.stroke();
}
function el(tag, cls, text){ const e=document.createElement(tag); if(cls)e.className=cls; if(text!=null)e.textContent=text; return e; }

function render(){
  const tabs = document.getElementById('tabs');
  const main = document.getElementById('main');
  SECTIONS.forEach(([id,title], i)=>{
    const b = el('button', i===0?'on':'', title);
    b.onclick = ()=>{ document.querySelectorAll('#tabs button').forEach(x=>x.classList.remove('on'));
      document.querySelectorAll('.panel').forEach(x=>x.classList.remove('on'));
      b.classList.add('on'); document.getElementById('panel-'+id).classList.add('on');
      drawVisible(); };
    tabs.appendChild(b);
    const panel = el('section','panel'+(i===0?' on':''));
    panel.id = 'panel-'+id;
    main.appendChild(panel);
    const head = el('div','sec-head');
    const h2 = el('h2','',title); const p = el('p','',SECTIONS[i][2]);
    head.append(h2,p); panel.appendChild(head);
    if(id==='scenario'){ renderScenarios(panel); return; }
    if(id==='compare'){ renderCompare(panel, head); return; }
    const list = ITEMS.filter(x=>x.section===id);
    const all = el('button','playall','▶ 连播本组');
    all.onclick = ()=>{ let t=0; for(const item of list){ setTimeout(()=>play(item.id), t); t += Math.min(900, item.duration*1000+260); } };
    head.appendChild(all);
    const grid = el('div','cues');
    list.forEach((item, i)=>{
      const btn = el('button','cue');
      btn.dataset.id = item.id;
      const idx = el('div','idx',String(i+1).padStart(2,'0'));
      const txt = el('div','');
      txt.append(el('div','name',item.name), el('div','desc',item.desc));
      const cv = el('canvas');
      const meta = el('div','meta',item.duration.toFixed(2)+'s');
      btn.append(idx,txt,cv,meta);
      btn.onclick = ()=>{ play(item.id); document.getElementById('status').textContent = item.name; };
      grid.appendChild(btn);
      btn._canvas = cv;
    });
    panel.appendChild(grid);
  });
}
function renderScenarios(panel){
  const grid = el('div','scenarios');
  SCENARIOS.forEach((s,i)=>{
    const b = el('button','scn');
    b.append(el('div','num',String(i+1).padStart(2,'0')));
    b.append(el('h3','',s.title));
    b.append(el('p','',s.desc));
    const chips = el('div','chips');
    const names = s.cascade ? [s.cascade.id] : s.steps.map(x=>x[0]);
    names.forEach(n=>{ const it = ITEMS.find(x=>x.id===n); chips.append(el('span','chip', it?it.name:n)); });
    b.append(chips);
    b.onclick = ()=>playScenario(s);
    grid.appendChild(b);
  });
  panel.appendChild(grid);
}
function renderCompare(panel, head){
  head.querySelector('p').textContent = '同一组四个声音，三种性格。选一个方向，我把全套按它重做。';
  const wrap = el('div','compare');
  const groups = [
    {title:'A · 纸墨书房', tone:'木质 / 毛毡 / 玻璃 · 当前全套', ids:['cmp.click','cmp.reveal','cmp.grade','cmp.success'], bullets:['最贴身，像在书桌上','长时间复习不疲劳','与现有视觉最搭']},
    {title:'B · 琉璃夜色', tone:'玻璃 / 长尾 / 宽混响', ids:['cmp2.click','cmp2.reveal','cmp2.grade','cmp2.success'], bullets:['更亮更空灵','揭示与成就有仪式感','密集操作时尾音容易叠']},
    {title:'C · 电子极简', tone:'短 / 干 / 无尾音', ids:['cmp3.click','cmp3.reveal','cmp3.grade','cmp3.success'], bullets:['最不打扰','适合极快刷题','情绪表达最弱']},
  ];
  for(const g of groups){
    const d = el('div','direction');
    d.append(el('h3','',g.title), el('div','tone',g.tone));
    for(const id of g.ids){
      const item = ITEMS.find(x=>x.id===id);
      const row = el('div','row'); row.dataset.id = id;
      row.append(el('span','',item.name.split('·')[1]||item.name), el('span','dot'));
      row.onclick = ()=>play(id);
      d.appendChild(row);
    }
    const ul = el('ul'); g.bullets.forEach(x=>ul.append(el('li','',x))); d.append(ul);
    wrap.appendChild(d);
  }
  panel.appendChild(wrap);
}

// meter
function startMeter(){
  const c = state.ctx; if(!c) return;
  const an = c.createAnalyser(); an.fftSize = 512;
  state.master.connect(an);
  const buf = new Uint8Array(an.frequencyBinCount);
  const bar = document.getElementById('meter');
  (function loop(){
    an.getByteTimeDomainData(buf);
    let sum=0; for(const v of buf){ const x=(v-128)/128; sum+=x*x; }
    const rms = Math.sqrt(sum/buf.length);
    bar.style.width = Math.min(100, rms*380) + '%';
    requestAnimationFrame(loop);
  })();
}

document.getElementById('vol').addEventListener('input', applyVolume);
document.getElementById('panic').addEventListener('click', (e)=>{
  state.muted = !state.muted;
  e.currentTarget.textContent = state.muted ? '开' : '静音';
  applyVolume();
});

async function boot(){
  const c = ctxReady();
  document.getElementById('status').textContent = '正在解码 ' + Object.keys(AUDIO).length + ' 个声音…';
  await loadAll();
  startMeter();
  document.getElementById('status').textContent = '点任意一行开始试听';
  drawVisible();
}
render();
document.body.addEventListener('pointerdown', function once(){ ctxReady(); }, {once:true});
boot();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    main()
