// Pitch analysis for the voice coach bot. No dependencies, so it can be tested on its own (npm run selftest).

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const AP_MAX = 0.15;               // YIN threshold; aperiodicity above this counts as unvoiced

export function noteName(f) {
  const n = Math.round(12 * Math.log2(f / 440)) + 69;
  return `${NOTES[n % 12]}${Math.floor(n / 12) - 1}`;
}

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const clarityOf = ap => Math.round(Math.min(100, Math.max(0, 100 * (1 - ap / AP_MAX))));

// YIN pitch detection; returns { f, ap } or null (ap = aperiodicity, lower = clearer tone)
export function yin(buf, sr) {
  const W = Math.floor(buf.length / 2);
  const minTau = Math.floor(sr / 600), maxTau = Math.min(W - 1, Math.floor(sr / 60));
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const x = buf[i] - buf[i + tau]; s += x * x; }
    d[tau] = s;
  }
  let run = 0; d[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) { run += d[tau]; d[tau] = run ? d[tau] * tau / run : 1; }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (d[t] < AP_MAX) { while (t + 1 <= maxTau && d[t + 1] < d[t]) t++; tau = t; break; }
  }
  if (tau < 0) return null;
  const a = d[tau - 1] ?? d[tau], b = d[tau], c = d[tau + 1] ?? d[tau];
  const denom = a - 2 * b + c;
  const shift = denom ? (a - c) / (2 * denom) : 0;
  return { f: sr / (tau + shift), ap: b };
}

// Tracks one person's voice from a stream of 48 kHz mono samples. Keeps numbers only, never audio.
export class VoiceTracker {
  constructor(settings, now = () => Date.now()) {
    this.now = now;
    this.s = { ...settings };
    this.sr = 24000;                 // Discord audio is 48 kHz; every other sample is plenty for voice pitch
    this.win = 1024; this.hop = 480; // ~43 ms window, analysed every 20 ms
    this.buf = new Float32Array(this.win);
    this.pend = new Float32Array(this.hop); this.pi = 0; this.skip = false;
    this.frameMs = this.hop / this.sr * 1000;
    this.frames = [];                // recent voiced frames {t, f, ap}
    this.all = [];                   // pitch of every voiced frame (for the summary)
    this.apAll = [];
    this.zones = { masc: 0, andro: 0, fem: 0 };
    this.breaks = []; this.breakTotal = 0;
    this.recent = []; this.lastF = null; this.lastT = 0;
    this.waterMs = 0; this.cool = {};
    this.started = this.now();
  }
  setSettings(patch) { Object.assign(this.s, patch); }
  zoneOf(f) { return f < this.s.lowCut ? "masc" : f < this.s.highCut ? "andro" : "fem"; }

  pushPcm16(b) {                     // Buffer of signed 16-bit little-endian mono samples
    for (let i = 0; i + 1 < b.length; i += 2) this.pushSample(b.readInt16LE(i) / 32768);
  }
  pushSample(x) {
    this.skip = !this.skip;
    if (!this.skip) return;          // 48 kHz -> 24 kHz
    this.pend[this.pi++] = x;
    if (this.pi < this.hop) return;
    this.buf.copyWithin(0, this.hop);
    this.buf.set(this.pend, this.win - this.hop);
    this.pi = 0;
    this.analyze();
  }
  silence() { this.lastF = null; this.recent = []; }

  analyze() {
    let rms = 0;
    for (let i = 0; i < this.win; i++) rms += this.buf[i] * this.buf[i];
    rms = Math.sqrt(rms / this.win);
    if (rms < 0.01) { this.silence(); return; }
    const y = yin(this.buf, this.sr);
    if (!y || y.f < 60 || y.f > 600) { this.silence(); return; }
    const t = this.now();
    if (this.lastF && t - this.lastT < 120 && Math.abs(12 * Math.log2(y.f / this.lastF)) > 5) {
      this.breaks.push(t); this.breakTotal++;
    }
    this.lastF = y.f; this.lastT = t;
    this.recent.push(y.f); if (this.recent.length > 5) this.recent.shift();
    const f = [...this.recent].sort((a, b) => a - b)[Math.floor(this.recent.length / 2)];
    this.frames.push({ t, f, ap: y.ap });
    while (this.frames.length && this.frames[0].t < t - 60000) this.frames.shift();
    this.all.push(f); this.apAll.push(y.ap);
    this.zones[this.zoneOf(f)]++;
    this.waterMs += this.frameMs;
  }

  ready(key, ms) {
    const t = this.now();
    if (this.cool[key] && t - this.cool[key] < ms) return false;
    this.cool[key] = t; return true;
  }

  // Returns a list of messages to send right now (each kind has its own cooldown)
  alerts() {
    const t = this.now(), out = [], s = this.s;
    this.breaks = this.breaks.filter(b => b > t - 30000);
    const recent = this.frames.filter(x => x.t > t - 20000);
    if (recent.length * this.frameMs >= 8000) {
      const fs = recent.map(x => x.f), avg = Math.round(mean(fs));
      const low = fs.filter(f => f < s.lowCut).length / fs.length;
      const high = fs.filter(f => f > s.ceiling).length / fs.length;
      if (low >= 0.6 && this.ready("low", 180000))
        out.push(`📉 Your pitch has mostly been under ${s.lowCut} Hz lately (about ${avg} Hz, ${noteName(avg)}). When you're ready, lift back toward ${s.target} Hz (${noteName(s.target)}). A quiet hum on that note helps.`);
      if (high >= 0.6 && this.ready("high", 180000))
        out.push(`⚠️ Your pitch has been above your comfort ceiling (${s.ceiling} Hz). Ease down a little and keep your throat loose. Resonance can do more of the work.`);
      if (this.apAll.length > 500) {
        const base = clarityOf(mean(this.apAll.slice(0, 500))), now = clarityOf(mean(recent.map(x => x.ap)));
        if (now < 60 && now < base - 15 && this.ready("dry", 300000))
          out.push(`💧 Your voice sounds rougher or breathier than at the start (clarity ${base} → ${now}). That can mean a dry throat or fatigue. Sip some water and take a short break.`);
      }
    }
    if (this.breaks.length >= 5 && this.ready("breaks", 180000))
      out.push(`🎚️ ${this.breaks.length} voice breaks in the last 30 seconds. Your voice may be tired or pushed. Try a gentle lip trill or rest for a minute.`);
    if (s.waterMin > 0 && this.waterMs >= s.waterMin * 60000) {
      this.waterMs = 0;
      out.push(`💧 You've been talking for about ${s.waterMin} minutes. Time for a sip of water.`);
    }
    return out;
  }

  summary() {
    const n = this.all.length;
    if (!n) return null;
    const sorted = [...this.all].sort((a, b) => a - b);
    const q = p => Math.round(sorted[Math.min(n - 1, Math.floor(p * n))]);
    const third = Math.max(1, Math.floor(this.apAll.length / 3));
    const voicedMin = n * this.frameMs / 60000;
    const pct = k => Math.round(this.zones[k] / n * 100);
    const avg = Math.round(mean(this.all));
    return {
      minutes: Math.round((this.now() - this.started) / 60000),
      voicedMin: Math.round(voicedMin * 10) / 10,
      avg, note: noteName(avg), p10: q(0.1), p90: q(0.9),
      fem: pct("fem"), andro: pct("andro"), masc: pct("masc"),
      clarityStart: clarityOf(mean(this.apAll.slice(0, third))), clarityEnd: clarityOf(mean(this.apAll.slice(-third))),
      breaksPerMin: Math.round(this.breakTotal / Math.max(voicedMin, 0.25) * 10) / 10
    };
  }
}
