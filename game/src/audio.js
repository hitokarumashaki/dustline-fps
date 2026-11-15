// All sound is synthesized with WebAudio: no audio files, no network. A shared
// noise buffer plus oscillators make shots, clicks, beeps and explosions. The
// audio context is created on the first user gesture (the play button).
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 1;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
    }
    return !!ctx;
  }

  function noise(dur, filterFreq, type, gainVal, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(gain).connect(master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  function tone(freq, dur, type, gainVal, slideTo = 0, when = 0) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const SHOTS = {
    rifle: () => { noise(0.14, 1800, 'lowpass', 0.9); tone(160, 0.1, 'square', 0.25, 60); },
    smg: () => { noise(0.09, 2400, 'bandpass', 0.7); tone(210, 0.07, 'square', 0.2, 90); },
    pistol: () => { noise(0.1, 2200, 'bandpass', 0.7); tone(190, 0.08, 'square', 0.22, 80); },
    dmr: () => { noise(0.28, 1200, 'lowpass', 1.0); tone(110, 0.22, 'sawtooth', 0.3, 40); },
    shotgun: () => { noise(0.22, 900, 'lowpass', 1.0); tone(90, 0.18, 'sawtooth', 0.35, 35); },
    distant: () => { noise(0.12, 700, 'lowpass', 0.25); },
  };

  return {
    unlock() { ensure(); },
    shot(kind, distant = false) {
      if (!ctx) return;
      if (distant) SHOTS.distant();
      else (SHOTS[kind] || SHOTS.rifle)();
    },
    dry() { tone(1200, 0.03, 'square', 0.12); },
    reload() { tone(900, 0.04, 'square', 0.14); tone(600, 0.05, 'square', 0.14, 0, 0.18); tone(1100, 0.04, 'square', 0.16, 0, 0.55); },
    hit() { tone(2200, 0.05, 'sine', 0.25); },
    kill() { tone(880, 0.07, 'sine', 0.25); tone(1320, 0.1, 'sine', 0.25, 0, 0.07); },
    hurt() { noise(0.12, 500, 'lowpass', 0.5); tone(140, 0.15, 'sawtooth', 0.2, 70); },
    step() { noise(0.05, 400, 'lowpass', 0.07); },
    plantBeep() { tone(1400, 0.08, 'sine', 0.3); },
    spikeBeep(fast) { tone(fast ? 1800 : 1200, 0.07, 'sine', 0.28); },
    explode() {
      noise(0.9, 300, 'lowpass', 1.0);
      tone(70, 0.8, 'sine', 0.6, 28);
      noise(0.4, 3000, 'highpass', 0.4);
    },
    flash() { noise(0.3, 5000, 'highpass', 0.5); tone(2400, 0.25, 'sine', 0.2, 1200); },
    throwPin() { tone(1500, 0.03, 'square', 0.12); },
    buy() { tone(660, 0.05, 'sine', 0.2); tone(990, 0.07, 'sine', 0.2, 0, 0.06); },
    denied() { tone(220, 0.12, 'square', 0.2, 160); },
    roundWin() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, 'triangle', 0.25, 0, i * 0.12)); },
    roundLose() { [392, 330, 262].forEach((f, i) => tone(f, 0.18, 'triangle', 0.22, 0, i * 0.13)); },
    matchWin() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.25, 0, i * 0.13)); },
    click() { tone(800, 0.03, 'square', 0.1); },
  };
}
