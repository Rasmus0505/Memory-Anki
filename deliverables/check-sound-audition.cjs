const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/sound-audition.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, { checked: true, value: '50', children: [], classList: { add() {}, remove() {}, toggle() {} }, appendChild(child) { this.children.push(child); }, setAttribute() {}, addEventListener() {} });
  return elements.get(id);
}
const sandbox = { document: { getElementById: element, createElement: () => element('new-' + Math.random()), querySelectorAll: () => [] }, window: { addEventListener() {} }, localStorage: { getItem: () => null }, setTimeout, clearTimeout, console, Blob, URL };
vm.createContext(sandbox);
vm.runInContext(script, sandbox);
vm.runInContext(`
const all = { action: true, objects: true, result: true };
for (const id of Object.keys(presets)) {
  for (const key of Object.keys(sceneNames)) {
    const data = plan(id, key, all);
    if (!data.events.length) throw Error(id + ' ' + key + ' silent');
    for (const e of data.events) {
      if (!Number.isFinite(e.t) || e.t < 0 || !Number.isFinite(e.scale) || e.scale <= 0) throw Error('bad event');
      if (e.kind !== 'reference' && (!Number.isFinite(e.f) || e.f < 20 || e.f > 20000)) throw Error('bad pitch');
    }
    if (plan(id, key, {action:false,objects:false,result:false}).events.length) throw Error('mute failed');
  }
  for (const [key, count] of [['single',1],['four',4],['twelve',12],['fold',4]]) {
    if (plan(id,key,{action:false,objects:true,result:false}).events.length !== count) throw Error('object count failed');
  }
  const deletion = plan(id,'delete',all);
  const lastPop = deletion.events.filter(e=>e.kind==='note').at(-1);
  const result = deletion.events.find(e=>e.kind==='reference');
  if (result.t < lastPop.t + presets[id].decay * .7 + .17) throw Error('result overlaps onset');
}
`, sandbox);
// Exercise the real synth with an AudioContext-shaped stub, checking all automation times.
const live = new Set();
let nodes = 0;
const parameter = () => ({ setValueAtTime(value,time) { assert(Number.isFinite(value)); assert(time >= 0); }, exponentialRampToValueAtTime(value,time) { assert(value > 0 && Number.isFinite(value)); assert(time >= 0); } });
const ctx = { createOscillator() { nodes++; const osc = { type: '', frequency: parameter(), connect() {}, disconnect() {}, start(time) { assert(time >= 0); live.add(osc); }, stop(time) { assert(time >= 0); live.delete(osc); } }; return osc; }, createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; } };
sandbox.testContext = ctx;
sandbox.testDestination = {};
vm.runInContext(`for (const id of Object.keys(presets)) for (const key of [...Object.keys(sceneNames),'reference']) schedule(testContext,testDestination,id,plan(id,key,{action:true,objects:true,result:true}),.03);`, sandbox);
assert(nodes > 300);
assert.equal(live.size, 0);
console.log('PASS: HTML script parses; 4 presets × 9 scenes; layer mute; 1/4/12 object counts; result separation; ' + nodes + ' oscillator schedules.');
