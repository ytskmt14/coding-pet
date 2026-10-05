// Writes the three sound cues: node scripts/gen-sounds.mjs plugins/coding-pet/sounds
// No dependencies, no randomness: the same wav files every run.
// Short chiptune-ish cues: square/triangle notes with a soft attack and exponential decay.
import { writeFileSync, mkdirSync } from 'node:fs'
const SR = 44100
const hz = n => 440 * 2 ** ((n - 69) / 12)
const osc = { square: p => (p % 1 < 0.5 ? 1 : -1), triangle: p => 4 * Math.abs((p % 1) - 0.5) - 1 }
function render(notes, wave, total) {
  const out = new Float64Array(Math.ceil(total * SR))
  for (const [t, midi, dur, vol] of notes) {
    const f = hz(midi), s0 = Math.floor(t * SR), len = Math.floor(dur * SR)
    for (let i = 0; i < len && s0 + i < out.length; i++) {
      const env = Math.min(1, i / (0.005 * SR)) * Math.exp(-3 * i / len) // no click at the start
      out[s0 + i] += osc[wave]((f * i) / SR) * env * vol
    }
  }
  const fade = Math.floor(0.02 * SR) // and none at the end
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade
  return out
}
function wav(samples, path) {
  const peak = Math.max(...samples.map(Math.abs)), gain = peak > 0 ? 0.7 / peak : 1
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((v, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), 44 + i * 2))
  writeFileSync(path, buf)
  return { path, seconds: (samples.length / SR).toFixed(2), peak: 0.7 }
}
const dir = process.argv[2]; mkdirSync(dir, { recursive: true })
// achievement: C-E-G-C arpeggio, then a held C
console.log(wav(render([[0, 72, 0.12, 0.5], [0.1, 76, 0.12, 0.5], [0.2, 79, 0.12, 0.5], [0.3, 84, 0.5, 0.6]], 'square', 0.85), `${dir}/fanfare.wav`))
// stage up: rising run over two octaves
console.log(wav(render([60, 64, 67, 72, 76, 79, 84].map((n, i) => [i * 0.07, n, 0.15, 0.45]).concat([[0.5, 84, 0.6, 0.5], [0.5, 88, 0.6, 0.4]]), 'square', 1.15), `${dir}/levelup.wav`))
// hatch: a crack (two quick high blips) and a soft chime
console.log(wav(render([[0, 96, 0.04, 0.4], [0.08, 98, 0.04, 0.4], [0.2, 79, 0.4, 0.5], [0.3, 84, 0.5, 0.5]], 'triangle', 0.85), `${dir}/hatch.wav`))
