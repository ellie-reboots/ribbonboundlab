// Checks the pitch analysis with synthetic voices. Needs no Discord account and no npm install.
import { VoiceTracker, yin, noteName } from "./pitch.js";

let failed = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failed++; };

// A voice-like tone: fundamental plus a few harmonics, as 16-bit PCM at 48 kHz
function voice(freq, seconds, amp = 0.3) {
  const sr = 48000, n = Math.floor(sr * seconds), b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = amp * (Math.sin(2 * Math.PI * freq * t) + 0.5 * Math.sin(4 * Math.PI * freq * t) + 0.25 * Math.sin(6 * Math.PI * freq * t)) / 1.75;
    b.writeInt16LE(Math.round(x * 32767), i * 2);
  }
  return b;
}

// 1. Raw detector accuracy
for (const f of [110, 145, 180, 220, 260]) {
  const sr = 24000, buf = new Float32Array(1024);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.sin(2 * Math.PI * f * i / sr) + 0.4 * Math.sin(4 * Math.PI * f * i / sr);
  const y = yin(buf, sr);
  check(y && Math.abs(y.f - f) < 2, `detects ${f} Hz (${noteName(f)}) -> ${y ? y.f.toFixed(1) : "none"} Hz`);
}

// 2. Tracker with a fake clock: feminine speech, then a long masculine stretch
let clock = 0;
const settings = { target: 190, lowCut: 145, highCut: 175, ceiling: 240, waterMin: 0.5 };
const tr = new VoiceTracker(settings, () => clock);
function feed(buf) {
  for (let off = 0; off < buf.length; off += 1920) {      // 20 ms chunks, like Discord packets
    tr.pushPcm16(buf.subarray(off, off + 1920)); clock += 20;
  }
}
feed(voice(190, 10));
let s = tr.summary();
check(Math.abs(s.avg - 190) <= 3 && s.fem > 90, `10 s at 190 Hz -> average ${s.avg} Hz, ${s.fem}% feminine`);
check(tr.alerts().length === 0, "no alerts while speaking comfortably");

feed(voice(120, 22));
const a1 = tr.alerts();
check(a1.some(m => m.includes("under 145 Hz")), "low-pitch alert after 20 s around 120 Hz");
check(a1.some(m => m.includes("sip of water")), "water reminder after 30 s of talking (test setting)");
check(tr.alerts().length === 0, "alerts respect their cooldowns");

feed(voice(260, 22));
check(tr.alerts().some(m => m.includes("comfort ceiling")), "high-pitch strain alert above 240 Hz");

s = tr.summary();
console.log("\nSummary:", s);
console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
