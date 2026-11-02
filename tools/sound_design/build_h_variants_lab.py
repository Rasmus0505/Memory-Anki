"""Render the original H and three variants into a single-file A/B page."""

from __future__ import annotations

import base64
import json
import subprocess
import time
from pathlib import Path

import dsp
import h_variants_lab
import jelly_lab

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent.parent
OUT = ROOT / "out" / "h-variants"
DELIVERY = PROJECT / "deliverables" / "memory-anki-sound-h-family.html"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    started = time.time()
    audio: dict[str, str] = {}
    catalog = []
    for feel in h_variants_lab.FEELS:
        row = {"id": feel.id, "name": feel.name, "tagline": feel.tagline,
               "bullets": list(feel.bullets), "cues": []}
        for cue in feel.cues:
            key = cue.id
            if feel.id == "h0":
                original = next(f for f in jelly_lab.FEELS if f.id == "h")
                original_cue = next(c for c in original.cues if c.id == key.replace("h0.", "h.", 1))
                x = jelly_lab.render(original, original_cue)
            else:
                x = h_variants_lab.render(feel, cue)
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
            row["cues"].append({"id": key, "name": cue.name, "duration": round(dur, 3), "format": fmt})
        catalog.append(row)

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
<title>Memory Anki · H 家族弹跳音效对比</title>
<style>
:root{
  --paper:#f7f2e8;--paper-2:#fffdf8;--ink:#241f1a;--muted:#7d7367;--line:#e4dac8;
  --line-2:#efe7d8;--accent:#c0562f;--peach:#f6e2d5;--green:#2f5d50;--mint:#e6f0ea;
  --shadow:0 1px 0 rgba(255,255,255,.75),0 14px 36px -22px rgba(70,40,15,.55);
}
*{box-sizing:border-box}html,body{margin:0}
body{background:radial-gradient(1000px 560px at 12% -10%,#fffdf9,transparent 60%),radial-gradient(800px 460px at 96% 0%,#f6e6d8,transparent 55%),var(--paper);
  color:var(--ink);font:15px/1.6 "PingFang SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:44px 24px 90px}
header{border-bottom:1px solid var(--line);padding-bottom:22px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;align-items:flex-end}
.kicker{font-size:11px;letter-spacing:.32em;color:var(--muted)}
h1{font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-weight:600;font-size:34px;margin:8px 0 10px;line-height:1.2}
h1 em{font-style:normal;color:var(--accent)}
.lede{margin:0;color:var(--muted);max-width:62ch;font-size:14px}
.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.vol{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--muted)}
input[type=range]{appearance:none;width:128px;height:2px;background:var(--line);border-radius:2px;outline:none}
input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border-radius:50%;background:var(--accent);border:2px solid var(--paper-2);box-shadow:0 0 0 1px var(--accent);cursor:pointer}
.ghost{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:6px 13px;font-size:12px;cursor:pointer}
.ghost:hover{color:var(--ink);border-color:var(--muted)}
.recipe{display:flex;gap:10px;flex-wrap:wrap;margin:22px 0 6px}
.recipe span{font-size:11.5px;color:var(--green);background:var(--mint);border-radius:999px;padding:4px 11px}
.phrase{margin:14px 0 8px;border:1px solid var(--line);background:var(--paper-2);border-radius:18px;padding:16px 18px;box-shadow:var(--shadow)}
.phrase-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.phrase h2{margin:0;font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-size:19px;font-weight:600}
.phrase p{margin:2px 0 0;font-size:12px;color:var(--muted)}
.phrase-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.pbtn{border:1px solid var(--line);background:#fffdf9;border-radius:12px;padding:9px 14px;font-size:13px;cursor:pointer;font-family:inherit;color:inherit;min-width:118px;text-align:left}
.pbtn:hover{border-color:var(--accent);color:var(--accent)}
.pbtn b{display:block;font-size:11px;color:var(--muted);font-weight:400;letter-spacing:.1em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px;margin-top:18px}
.card{border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,#fffdf9,var(--paper-2));padding:18px;box-shadow:var(--shadow)}
.card h3{font-family:"Source Han Serif SC","Songti SC",Georgia,serif;font-size:21px;margin:0 0 3px;font-weight:600}
.card .tag{font-size:12px;color:var(--accent);margin-bottom:10px}
.card ul{margin:0 0 12px;padding-left:16px;font-size:11.5px;color:var(--muted);line-height:1.65}
.acts{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.acts button{flex:1;min-width:92px;border:1px solid var(--line);background:#fffdf9;border-radius:10px;padding:7px 6px;font-size:11.5px;cursor:pointer;font-family:inherit;color:var(--ink)}
.acts button:hover{border-color:var(--green);color:var(--green)}
.acts button.juice{border-color:var(--green);background:var(--mint);color:var(--green)}
.row{display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--line-2);cursor:pointer;font-size:13px}
.row:hover{color:var(--accent)}
.row .dot{width:7px;height:7px;border-radius:50%;background:var(--line);flex:none;transition:transform .12s}
.row.playing .dot{background:var(--accent);transform:scale(1.5)}
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
      <div class="kicker">MEMORY ANKI · H FAMILY</div>
      <h1>H 家族 <em>四种弹跳</em></h1>
      <p class="lede">H0 是上一版的 H 原音，旁边三套沿着它的游戏感各自变化。试听相同动作，比较哪一种弹性、软度和奖励感最喜欢。先调低音量，再慢慢调整。</p>
    </div>
    <div class="controls">
      <label class="vol">音量 <input id="vol" type="range" min="0" max="100" value="64"></label>
      <label class="vol">弹性 <input id="elastic" type="range" min="0" max="100" value="35"></label>
      <label class="vol">亮度 <input id="bright" type="range" min="0" max="100" value="68"></label>
      <button class="ghost" id="mute">静音</button>
    </div>
  </header>

  <div class="recipe"><span>弯音</span><span>湿挤压</span><span>软低频</span><span>低通去刺</span><span>叠音上行</span></div>

  <div class="phrase">
    <div class="phrase-head">
      <div>
        <h2>同一句：点击 → 翻卡 → 评分 → 成功</h2>
        <p>四套依次过一遍，先听“弹不弹、糯不糯”。</p>
      </div>
      <button class="ghost" id="playAll">四套依次播</button>
    </div>
    <div class="phrase-row" id="phraseRow"></div>
  </div>

  <div class="grid" id="grid"></div>

  <footer>
    <span>素材：Freesound CC0（气泡爆、水滴、史莱姆挤压、卡通 boing、木琴、卡林巴）+ Kenney CC0（UI 合成音）。弯音与叠音在本地完成。</span>
    <span id="status">点任意一行开始</span>
  </footer>
</div>
<script>
const AUDIO=__AUDIO__, CATALOG=__CATALOG__;
const state={ctx:null,master:null,filter:null,buffers:{},muted:false,elastic:.35,bright:.68};
function ctxReady(){
  if(!state.ctx){
    const C=window.AudioContext||window.webkitAudioContext;
    state.ctx=new C(); state.master=state.ctx.createGain();
    state.filter=state.ctx.createBiquadFilter(); state.filter.type='lowpass'; state.filter.Q.value=0.4;
    const comp=state.ctx.createDynamicsCompressor();
    comp.threshold.value=-12; comp.knee.value=18; comp.ratio.value=2.5;
    comp.attack.value=0.004; comp.release.value=0.18;
    state.master.connect(state.filter).connect(comp).connect(state.ctx.destination);
    applyVolume(); applyTone();
  }
  if(state.ctx.state!=='running') state.ctx.resume();
  return state.ctx;
}
function applyVolume(){ if(!state.master)return; const v=state.muted?0:Number(document.getElementById('vol').value)/100; state.master.gain.value=v*2.0; }
function applyTone(){
  state.elastic=Number(document.getElementById('elastic').value)/100;
  state.bright=Number(document.getElementById('bright').value)/100;
  if(state.filter) state.filter.frequency.value=2200+12000*state.bright;
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
  const s=c.createBufferSource(); s.buffer=b;
  const baseRate=opt.rate||1;
  const now=c.currentTime+(opt.at||0);
  if(state.elastic>0.01){
    const start=baseRate*(1+0.22*state.elastic);
    s.playbackRate.setValueAtTime(start, now);
    s.playbackRate.linearRampToValueAtTime(baseRate, now+0.10);
  } else s.playbackRate.value=baseRate;
  const g=c.createGain(); g.gain.value=opt.gain==null?1:opt.gain;
  const p=c.createStereoPanner?c.createStereoPanner():null;
  if(p){p.pan.value=opt.pan||0;s.connect(g).connect(p).connect(state.master);} else s.connect(g).connect(state.master);
  s.start(now);
  flash(id,b.duration*1000/(opt.rate||1)+((opt.at||0)*1000));
}
function flash(id,ms){
  document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el=>{
    el.classList.add('playing'); clearTimeout(el._t);
    el._t=setTimeout(()=>el.classList.remove('playing'),Math.max(300,ms));
  });
}
function phrase(id,at=0){
  const seq=['click','reveal','grade','success'], times=[0,360,950,1550];
  seq.forEach((k,i)=>play(`${id}.${k}`,{at:at+times[i]/1000}));
}
function cascade(id){
  [0,1,2].forEach(i=>play(`${id}.reveal`,{at:i*0.085,rate:i===2?1.12:1.0,gain:1-i*0.07}));
}
function combo(id){
  const rates=[1.0,1.06,1.12,1.19,1.26];
  rates.forEach((r,i)=>play(`${id}.grade`,{at:i*0.085,rate:r,gain:0.9+i*0.03}));
}
function juicy(id){
  const g=`${id}.`;
  play(g+'click',{at:0});
  play(g+'reveal',{at:0.16});
  play(g+'reveal',{at:0.26,rate:1.06,gain:.9});
  [0,1,2].forEach(i=>play(g+'grade',{at:0.52+i*0.085,rate:[1,1.06,1.12][i],gain:.9+i*0.03}));
  play(g+'correct',{at:0.95});
  play(g+'success',{at:1.35});
  play(g+'unit',{at:1.95});
  play(g+'milestone',{at:2.55});
}
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function render(){
  const row=document.getElementById('phraseRow');
  CATALOG.forEach(st=>{
    const b=el('button','pbtn');
    b.innerHTML=`<b>${st.name.split('·')[0].trim()}</b>${st.name.split('·')[1].trim()}`;
    b.onclick=()=>{phrase(st.id);document.getElementById('status').textContent=st.name;};
    row.appendChild(b);
  });
  const grid=document.getElementById('grid');
  CATALOG.forEach(st=>{
    const card=el('div','card');
    card.append(el('h3','',st.name),el('div','tag',st.tagline));
    const ul=el('ul'); st.bullets.forEach(x=>ul.append(el('li','',x))); card.append(ul);
    const acts=el('div','acts');
    const b1=el('button','juice','▶ 整段多汁演示'); b1.onclick=()=>juicy(st.id);
    const b2=el('button','','连击 ×5'); b2.onclick=()=>combo(st.id);
    const b3=el('button','','翻卡 ×3'); b3.onclick=()=>cascade(st.id);
    acts.append(b1,b2,b3); card.append(acts);
    st.cues.forEach(c=>{
      const r=el('div','row'); r.dataset.id=c.id;
      r.append(el('span','dot'),el('span','n',c.name),el('span','d',c.duration.toFixed(2)+'s'));
      r.onclick=()=>{play(c.id);document.getElementById('status').textContent=st.name+' · '+c.name;};
      card.append(r);
    });
    grid.append(card);
  });
}
document.getElementById('vol').addEventListener('input',applyVolume);
document.getElementById('elastic').addEventListener('input',applyTone);
document.getElementById('bright').addEventListener('input',applyTone);
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
