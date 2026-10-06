const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/sound-showcase.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert(script && !script.includes('</script>'));
const sandbox = {
  window: {},
  console,
  document: {
    addEventListener() {},
    getElementById: () => ({ checked: true, value: '70' })
  }
};
vm.createContext(sandbox);
vm.runInContext(script, sandbox);
const lab = sandbox.window.SoundLab;
assert(lab, 'SoundLab missing');
const count = lab.assertCatalog();
assert(count >= 90, 'expected broad coverage, got ' + count);
const groups = new Set(lab.SCENES.map(s => s.group));
for (const name of ['学习', '评分', '庆典', '导图', '题库', '微交互', '文件']) assert(groups.has(name), name);
const fileScenes = lab.SCENES.filter(s => s.family === 'file');
assert(fileScenes.length >= 30, 'file voice too thin');
assert(lab.SCENES.some(s => s.id === 'hover'));
assert(lab.VOICES.crystal.motif !== lab.VOICES.wood.motif);
assert(lab.VOICES.wood.motif !== lab.VOICES.celesta.motif);

const live = new Set();
let nodes = 0;
const param = () => ({
  setValueAtTime(value, time) { assert(Number.isFinite(value) && value > 0 || value === 0 || Object.is(value, -0) || value < 0); assert(time >= 0); },
  exponentialRampToValueAtTime(value, time) { assert(value > 0 && Number.isFinite(value)); assert(time >= 0); },
  setTargetAtTime(value, time) { assert(Number.isFinite(value)); assert(time >= 0); },
  value: 1
});
function node() {
  nodes += 1;
  const self = {
    type: '',
    frequency: param(),
    gain: param(),
    pan: param(),
    Q: param(),
    buffer: null,
    connect() { return self; },
    disconnect() {},
    start(time) { assert(time >= 0); live.add(self); },
    stop(time) { assert(time >= 0); live.delete(self); },
    set onended(fn) { self._ended = fn; }
  };
  return self;
}
const ctx = {
  sampleRate: 44100,
  currentTime: 0,
  createOscillator: node,
  createGain: node,
  createBiquadFilter: node,
  createStereoPanner: node,
  createBufferSource: node,
  createBuffer(_ch, length) {
    assert(length > 0);
    return { getChannelData: () => new Float32Array(length) };
  }
};
const dest = {};
const human = { color: 0, pitch: 1, gain: 1, decay: 1, pan: 0.1, cents: 0 };
for (const voice of Object.values(lab.VOICES)) {
  for (const scene of lab.SCENES) {
    const events = lab.expand(scene.score, voice, scene.family);
    assert(events.length, scene.id);
    for (const ev of events) lab.renderEvent(ctx, voice, dest, 0.03 + ev.t, ev, human, scene);
  }
}
assert(nodes > 800, 'synth did not schedule, nodes=' + nodes);
assert.equal(live.size, 0);
console.log('PASS showcase: ' + count + ' scenes, file ' + fileScenes.length + ', oscillators/buffers ' + nodes);
