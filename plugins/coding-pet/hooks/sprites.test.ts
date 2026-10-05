import { expect, test } from 'claude-code/testing'

import { compose, LARGE, paint, SPRITE_SOURCES, toBase64, toCells } from './sprites'

const SPECIES = ['cat', 'bird', 'slime', 'dragon', 'ghost'] as const
const STAGES = ['egg', 'hatchling', 'child', 'adult', 'final'] as const
const MOODS = ['happy', 'normal', 'sad', 'hungry'] as const

test('every sprite is 16x16 or 8x8 and left-right symmetric', () => {
  for (const s of Object.values(SPRITE_SOURCES.SPRITES)) {
    expect(s.large.map(r => r.length)).toEqual(Array(16).fill(16))
    expect(s.small.map(r => r.length)).toEqual(Array(8).fill(8))
    for (const row of [...s.large, ...s.small]) expect([...row].reverse().join('')).toBe(row)
  }
})

test('every species, stage, mood and frame composes onto its canvas', () => {
  for (const sp of SPECIES)
    for (const st of STAGES)
      for (const mood of MOODS)
        for (const frame of [0, 1, 2, 3]) {
          const large = compose(sp, st, mood, frame)
          expect([large.length, large[0]!.length]).toEqual([LARGE.height, LARGE.width])
          expect(large.flat().some(c => c !== null)).toBe(true)
        }
})

test('the face follows the mood: tears when sad, sleepy grey eyes when hungry', () => {
  const cat = SPRITE_SOURCES.SPRITES.cat.large
  const palette = { o: 1, b: 2, l: 3, a: 4 }
  const colors = (mood: (typeof MOODS)[number]) => new Set(paint(cat, palette, mood, false).flat())
  expect(colors('sad').has(0x60b0ff)).toBe(true)
  expect(colors('normal').has(0x60b0ff)).toBe(false)
  expect(colors('hungry').has(0x9a9a9a)).toBe(true)
  expect(colors('happy').has(0xff5070)).toBe(true)
})

test('the final stage wears a crown, the adult a scarf', () => {
  const has = (grid: (number | null)[][], color: number) => grid.flat().includes(color)
  expect(has(compose('ghost', 'final', 'normal', 0), 0xffcc33)).toBe(true)
  expect(has(compose('ghost', 'adult', 'normal', 0), 0xd03030)).toBe(true)
  expect(has(compose('ghost', 'child', 'normal', 0), 0xd03030)).toBe(false)
})

test('cells pack two pixels per cell as little-endian [char, fg, bg]', () => {
  expect(toBase64(new Uint8Array([0x4d, 0x61, 0x6e]))).toBe('TWFu')
  expect(toBase64(new Uint8Array([0x4d, 0x61]))).toBe('TWE=')

  const { columns, rows, cells } = toCells([[0xff0000, null], [0x00ff00, 0x0000ff]])
  expect([columns, rows]).toEqual([2, 1])
  const expected = new Uint32Array([0x2580, 0xff0000, 0x00ff00, 0x2584, 0x0000ff, 0x01000000])
  expect(cells).toBe(toBase64(new Uint8Array(expected.buffer)))
})
