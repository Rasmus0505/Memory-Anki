"""Render the five style directions and build a single-file A/B page."""

from __future__ import annotations

import base64
import json
import subprocess
import time
from pathlib import Path

import dsp
import style_lab

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
OUT = ROOT / "out" / "styles"
DELIVERY = PROJECT / "deliverables" / "memory-anki-sound-styles.html"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    started = time.time()
    audio: dict[str, str] = {}
    catalog = []
    for st in style_lab.STYLES:
        style_rows = {"id": st.id, "name": st.name, "tagline": st.tagline,
                      "bullets": list(st.bullets), "cues": []}
        for cue in st.cues:
            key = f"{st.id}.{cue.id}"
            x = style_lab.render(st, cue)
            x = dsp.fade_edges(x)
            pcm = dsp.to_pcm16(x)
            raw = dsp.wav_bytes(pcm)
            wav = OUT / f"{key}.wav"
            wav.write_bytes(raw)
            dur = pcm.shape[1] / dsp.OUT_SR
            if dur <= 0.40:
                payload, fmt = raw, "wav"
            else:
                mp3 = OUT / f"{key}.mp3"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav),
                                "-c:a", "libmp3lame", "-b:a", "160k", "-ar", str(dsp.OUT_SR),
                                str(mp3)], check=True)
                payload, fmt = mp3.read_bytes(), "mp3"
            audio[key] = base64.b64encode(payload).decode("ascii")
            style_rows["cues"].append({
                "id": key, "name": cue.name, "duration": round(dur, 3), "format": fmt,
            })
        catalog.append(style_rows)

    html = TEMPLATE.replace("__AUDIO__", json.dumps(audio, ensure_ascii=False, separators=(",", ":")))
    html = html.replace("__CATALOG__", json.dumps(catalog, ensure_ascii=False, separators=(",", ":")))
    DELIVERY.parent.mkdir(parents=True, exist_ok=True)
    DELIVERY.write_text(html, encoding="utf-8")
    total = sum(len(v) for v in audio.values())
    print(f"rendered {len(audio)} cues in {time.time()-started:.1f}s")
    print(f"payload {total/1024:.0f} KiB base64 -> {DELIVERY.stat().st_size/1024:.0f} KiB")
    print("wrote", DELIVERY)


TEMPLATE = r"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memory Anki · 五套音色方向</title>
<style>
:root{
  --paper:#f6f1e7;--paper-2:#fbf8f2;--ink:#241f1a;--muted:#7d7367;--line:#e3d9c7;
  --line-2:#efe7d8;--accent:#a8452a;--green:#2f5d50;--shadow:0 1px 0 rgba(255,255,255,.7),0 12px 32px -20px rgba(60,40,20,.5);
}
*{box-sizing:border-box}html,body{margin:0}
body{background:radial-gradient(1100px 600px at 12% -10%,#fffdf8,transparent 60%),radial-gradient(900px 500px at 95% 0%,#f3ead9,transparent 55%),var(--paper);
  color:var(--ink);font:15px/1.6 "PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1120px;margin:0 auto;padding:44px 24px 90px}
header{border-bottom:1px solid var(--line);padding-bottom:22px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;align-items:flex-end}
.kicker{font-size:11px;letter-spacing:.32em;color:var(--muted)}
h1{font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-weight:600;font-size:34px;margin:8px 0 10px;line-height:1.2}
h1 em{font-style:normal;color:var(--accent)}
.lede{margin:0;color:var(--muted);max-width:60ch;font-size:14px}
.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.vol{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--muted)}
input[type=range]{appearance:none;width:128px;height:2px;background:var(--line);border-radius:2px;outline:none}
input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;background:var(--accent);border:2px solid var(--paper-2);box-shadow:0 0 0 1px var(--accent);cursor:pointer}
.ghost{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:6px 13px;font-size:12px;cursor:pointer}
.ghost:hover{color:var(--ink);border-color:var(--muted)}
.phrase{margin:26px 0 8px;border:1px solid var(--line);background:var(--paper-2);border-radius:18px;padding:16px 18px;box-shadow:var(--shadow)}
.phrase-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.phrase h2{margin:0;font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-size:19px;font-weight:600}
.phrase p{margin:2px 0 0;font-size:12px;color:var(--muted)}
.phrase-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.pbtn{border:1px solid var(--line);background:#fffdf9;border-radius:10px;padding:8px 13px;font-size:13px;cursor:pointer;font-family:inherit;color:inherit;min-width:96px;text-align:left}
.pbtn:hover{border-color:var(--accent);color:var(--accent)}
.pbtn b{display:block;font-size:11px;color:var(--muted);font-weight:400;letter-spacing:.1em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px;margin-top:18px}
.card{border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,#fffdf8,var(--paper-2));padding:18px;box-shadow:var(--shadow)}
.card h3{font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-size:21px;margin:0 0 3px;font-weight:600}
.card .tag{font-size:12px;color:var(--accent);margin-bottom:10px}
.card ul{margin:0 0 12px;padding-left:16px;font-size:11.5px;color:var(--muted);line-height:1.65}
.card .all{width:100%;border:1px solid var(--green);color:var(--green);background:#f3f7f4;border-radius:10px;padding:7px;font-size:12px;cursor:pointer;font-family:inherit;margin-bottom:10px}
.row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line-2);cursor:pointer;font-size:13px}
.row:hover{color:var(--accent)}
.row .dot{width:6px;height:6px;border-radius:50%;background:var(--line);flex:none}
.row.playing .dot{background:var(--accent)}
.row .n{flex:1}
.row .d{font-size:10px;color:#b3a894;font-variant-numeric:tabular-nums}
footer{margin-top:40px;border-top:1px solid var(--line);padding-top:16px;font-size:11.5px;color:var(--muted);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
@media(max-width:720px){.wrap{padding:26px 16px 70px}h1{font-size:26px}.grid{grid-template-columns:1fr}.controls{width:100%}}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div>
      <div class="kicker">MEMORY ANKI · SOUND DIRECTIONS</div>
      <h1>五套音色 <em>盲听挑选</em></h1>
      <p class="lede">同一套操作，五种性格。每套只放 8 个关键声音；先听整体气质，选定一套，我再把 72 条按它展开。所有音色都来自音效库录音，没有现场合成的电子音（C 套除外，它本来就是合成器 UI 音）。</p>
    </div>
    <div class="controls">
      <label class="vol">音量 <input id="vol" type="range" min="0" max="100" value="66"></label>
      <button class="ghost" id="mute">静音</button>
    </div>
  </header>

  <div class="phrase">
    <div class="phrase-head">
      <div>
        <h2>同一句：点击 → 翻卡 → 评分 → 成功</h2>
        <p>五套依次播同一句，最能听出差别。也可以单独点某一套。</p>
      </div>
      <button class="ghost" id="playAll">五套依次播</button>
    </div>
    <div class="phrase-row" id="phraseRow"></div>
  </div>

  <div class="grid" id="grid"></div>

  <footer>
    <span>素材：Kenney Interface / UI Audio / Digital Audio（CC0）；Freesound CC0 录音（红酒杯、八音盒、颂钵、铜锣、纸张）。</span>
    <span id="status">点任意一行开始</span>
  </footer>
</div>
<script>
const AUDIO = __AUDIO__;
const CATALOG = __CATALOG__;
const state = {ctx:null,master:null,buffers:{},muted:false};
function ctxReady(){
  if(!state.ctx){
    const C=window.AudioContext||window.webkitAudioContext;
    state.ctx=new C(); state.master=state.ctx.createGain();
    const comp=state.ctx.createDynamicsCompressor();
    comp.threshold.value=-12; comp.knee.value=18; comp.ratio.value=2.5;
    comp.attack.value=0.004; comp.release.value=0.18;
    state.master.connect(comp).connect(state.ctx.destination);
    applyVolume();
  }
  if(state.ctx.state!=='running') state.ctx.resume();
  return state.ctx;
}
function applyVolume(){
  if(!state.master) return;
  const v=state.muted?0:Number(document.getElementById('vol').value)/100;
  state.master.gain.value=v*2.0;
}
function b64(s){const a=atob(s),u=new Uint8Array(a.length);for(let i=0;i<a.length;i++)u[i]=a.charCodeAt(i);return u.buffer;}
async function loadAll(){
  for(const id of Object.keys(AUDIO)){
    const buf=await new Promise((res,rej)=>state.ctx.decodeAudioData(b64(AUDIO[id]).slice(0),res,rej));
    const d=buf.getChannelData(0); let lead=0;
    while(lead<d.length && Math.abs(d[lead])<0.0008) lead++;
    if(lead>0 && lead<buf.length*0.4){
      const t=state.ctx.createBuffer(buf.numberOfChannels,buf.length-lead,buf.sampleRate);
      for(let c=0;c<buf.numberOfChannels;c++) t.copyToChannel(buf.getChannelData(c).slice(lead),c);
      state.buffers[id]=t;
    } else state.buffers[id]=buf;
  }
}
function play(id,opt={}){
  const c=ctxReady(),b=state.buffers[id]; if(!b)return;
  const s=c.createBufferSource(); s.buffer=b; s.playbackRate.value=opt.rate||1;
  const g=c.createGain(); g.gain.value=opt.gain==null?1:opt.gain;
  const p=c.createStereoPanner?c.createStereoPanner():null;
  if(p){p.pan.value=opt.pan||0;s.connect(g).connect(p).connect(state.master);} else s.connect(g).connect(state.master);
  s.start(c.currentTime+(opt.at||0));
  flash(id,b.duration*1000+((opt.at||0)*1000));
}
function flash(id,ms){
  document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el=>{
    el.classList.add('playing'); clearTimeout(el._t);
    el._t=setTimeout(()=>el.classList.remove('playing'),Math.max(320,ms));
  });
}
function phrase(styleId, at=0){
  const seq=['click','reveal','grade','success']; const times=[0,380,980,1600];
  seq.forEach((k,i)=>play(`${styleId}.${k}`,{at:at+times[i]/1000}));
}
function playStyle(card){
  let t=0; card.cues.forEach(c=>{setTimeout(()=>play(c.id),t); t+=Math.min(1400,c.duration*1000+220);});
}
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}

function render(){
  const row=document.getElementById('phraseRow');
  CATALOG.forEach(st=>{
    const b=el('button','pbtn'); b.innerHTML=`<b>${st.name.split('·')[0].trim()}</b>${st.name.split('·')[1].trim()}`;
    b.onclick=()=>{phrase(st.id);document.getElementById('status').textContent=st.name;};
    row.appendChild(b);
  });
  const grid=document.getElementById('grid');
  CATALOG.forEach(st=>{
    const card=el('div','card');
    card.append(el('h3','',st.name), el('div','tag',st.tagline));
    const ul=el('ul'); st.bullets.forEach(x=>ul.append(el('li','',x))); card.append(ul);
    const all=el('button','all','▶ 整段：点击→翻卡→评分→成功→单元→里程碑');
    all.onclick=()=>{let t=0; const order=['click','reveal','grade','success','unit','milestone'];
      order.forEach(k=>{const c=st.cues.find(x=>x.id.endsWith('.'+k)); if(c){setTimeout(()=>play(c.id),t); t+=Math.min(1800,c.duration*1000+260);}});};
    card.append(all);
    st.cues.forEach(c=>{
      const r=el('div','row'); r.dataset.id=c.id;
      r.append(el('span','dot'), el('span','n',c.name), el('span','d',c.duration.toFixed(2)+'s'));
      r.onclick=()=>{play(c.id);document.getElementById('status').textContent=st.name+' · '+c.name;};
      card.append(r);
    });
    grid.append(card);
  });
}
document.getElementById('vol').addEventListener('input',applyVolume);
document.getElementById('mute').addEventListener('click',e=>{state.muted=!state.muted;e.currentTarget.textContent=state.muted?'开':'静音';applyVolume();});
document.getElementById('playAll').addEventListener('click',()=>{CATALOG.forEach((st,i)=>setTimeout(()=>phrase(st.id),i*2200));});
render();
document.body.addEventListener('pointerdown',()=>ctxReady(),{once:true});
(async()=>{ctxReady();document.getElementById('status').textContent='正在解码 '+(Object.keys(AUDIO).length)+' 个声音…';await loadAll();document.getElementById('status').textContent='点任意一行开始';})();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
