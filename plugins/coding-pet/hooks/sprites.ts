import type { Species, StageId } from '../types'
import type { Mood } from './pet'

// Pixel art drawn as the left half of each sprite, mirrored into the right half.
// '.' clear, 'o' outline, 'b' body, 'l' light (belly), 'a' accent, 'e' eye, 'm' mouth.
const mirror = (left: string[]) => left.map(row => row + [...row].reverse().join(''))

// `large` is the 16x16 the pane draws; `small` is the hatchling peeking out of its shell
type Sprite = { large: string[]; small: string[]; neck: number }

const SPRITES: Record<Species, Sprite> = {
  cat: {
    large: mirror([
      '........',
      '..oo....',
      '..oao...',
      '..oaao..',
      '..obbooo',
      '.obbbbbb',
      '.obbbbbb',
      '.obbebbb',
      '.obbebbb',
      '.obbbbbb',
      '.obbbbbm',
      '.obbbbbb',
      '..obblll',
      '..obllll',
      '..obbbbb',
      '...ooooo',
    ]),
    small: mirror(['.o..', '.oao', '.obb', 'obeb', 'obbm', 'obll', '.obb', '..oo']),
    neck: 11,
  },
  bird: {
    large: mirror([
      '........',
      '......oo',
      '....oobb',
      '...obbbb',
      '..obbbbb',
      '..obbebb',
      '..obbebb',
      '.obbbbba',
      '.obbbbbm',
      'obbbllll',
      'obbbllll',
      '.obbllll',
      '.obbblll',
      '..obbbbb',
      '...oaoo.',
      '........',
    ]),
    small: mirror(['..oo', '.obb', 'obeb', 'obba', 'obbm', 'obll', '.obl', '..oa']),
    neck: 9,
  },
  slime: {
    large: mirror([
      '........',
      '........',
      '.......o',
      '......ob',
      '.....obb',
      '....obbb',
      '...obbll',
      '..obbbbb',
      '..obebbb',
      '.obbebbb',
      '.obbbbbm',
      'obbbbbbb',
      'obbbbbbb',
      'obbbbbbb',
      '.obbbbbb',
      '..oooooo',
    ]),
    small: mirror(['...o', '..ob', '.obl', 'obeb', 'obbm', 'obbb', 'obbb', '.ooo']),
    neck: 11,
  },
  dragon: {
    large: mirror([
      '..a.....',
      '..ao....',
      '...ooooo',
      '..obbbbb',
      '..obbbbb',
      '..obebbb',
      '..obebbb',
      '..obbbbb',
      '..obbbmm',
      'a.obbbbb',
      'aaobllll',
      'aaobllll',
      '.aobllll',
      '..obbbbb',
      '..obo...',
      '..ooo...',
    ]),
    small: mirror(['a...', 'ao..', '.obb', 'obeb', 'abmm', 'aobl', '.obb', '.oo.']),
    neck: 9,
  },
  ghost: {
    large: mirror([
      '........',
      '....oooo',
      '...obbbb',
      '..obbbbb',
      '.obbbbbb',
      '.obbebbb',
      '.obbebbb',
      '.obbbbbb',
      '.obbbbbm',
      '.obbbbbm',
      'obbbbbbb',
      'obbbbbbb',
      '.obbbbbb',
      '.obbbbbb',
      '.obobbob',
      '.o.o..o.',
    ]),
    small: mirror(['..oo', '.obb', 'obeb', 'obbm', 'obbb', 'obbb', 'obob', 'o.o.']),
    neck: 10,
  },
}

const EGG = mirror([
  '........',
  '........',
  '......oo',
  '.....obb',
  '....obbb',
  '...obbab',
  '...obbbb',
  '..obabbb',
  '..obbbbb',
  '..obbbab',
  '..obbbbb',
  '..obbbbb',
  '...obabb',
  '...obbbb',
  '....oooo',
  '........',
])

// The bottom of the shell a baby sits in.
const SHELL = mirror(['..o.o.ob', '..obobbb', '..obbbbb', '...obbbb', '....oooo'])

const CROWN = mirror(['g.g', 'ggg'])

type Palette = { o: number; b: number; l: number; a: number }

const PALETTES: Record<Species | 'egg', Palette> = {
  cat: { o: 0x5a3418, b: 0xf0a040, l: 0xffe2b8, a: 0xff9eb5 },
  bird: { o: 0x1e4a70, b: 0x5ab4f0, l: 0xe8f6ff, a: 0xffb020 },
  slime: { o: 0x1f5a1f, b: 0x6cd36c, l: 0xd2f7d2, a: 0x3a9a3a },
  dragon: { o: 0x5a1a14, b: 0xe05a4a, l: 0xffd8a8, a: 0xf5c542 },
  ghost: { o: 0x6060a0, b: 0xe4e4f4, l: 0xffffff, a: 0xb8b8e0 },
  egg: { o: 0x6a5a40, b: 0xf5ecd0, l: 0xffffff, a: 0x8fc0e0 },
}

const EYE = 0x202020
const EYE_SLEEPY = 0x9a9a9a
const MOUTH_HAPPY = 0xff5070
const MOUTH = 0x6a3030
const TEAR = 0x60b0ff
const SCARF = 0xd03030
const GOLD = 0xffcc33
const SPARKLE = 0xfff6a0

// A picture: a color per pixel, null where it is clear.
export type Grid = (number | null)[][]

const blank = (width: number, height: number): Grid => Array.from({ length: height }, () => Array<number | null>(width).fill(null))

// Paints a sprite's letters in its palette, the face as the mood and the blink say.
export const paint = (rows: string[], palette: Palette, mood: Mood, isBlinking: boolean): Grid => {
  const at = (x: number, y: number) => rows[y]?.[x] ?? '.'
  const grid = rows.map((row, y) =>
    [...row].map((ch, x): number | null => {
      if (ch === '.') return null
      if (ch === 'e') {
        const isTop = at(x, y + 1) === 'e'
        // a closed or squinting eye keeps only its lowest pixel
        if (isTop && (isBlinking || mood === 'happy')) return palette.b
        if (isBlinking) return palette.o
        return mood === 'hungry' ? EYE_SLEEPY : EYE
      }
      if (ch === 'm') return mood === 'happy' ? MOUTH_HAPPY : MOUTH
      return palette[ch as keyof Palette] ?? null
    }),
  )
  if (mood === 'sad' && !isBlinking) {
    // a tear under each eye, where the body is
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === 'e' && at(x, y + 1) !== 'e' && at(x, y + 1) === 'b') grid[y + 1]![x] = TEAR
      }),
    )
  }
  return grid
}

// Draws `src` onto `dst` at (x, y), clipping what falls outside.
const blit = (dst: Grid, src: Grid, x: number, y: number) =>
  src.forEach((row, sy) =>
    row.forEach((c, sx) => {
      if (c === null) return
      const line = dst[y + sy]
      if (line && x + sx >= 0 && x + sx < line.length) line[x + sx] = c
    }),
  )

const recolor = (grid: Grid, rowIndex: number, from: number[], to: number) =>
  grid[rowIndex]?.forEach((c, x) => {
    if (c !== null && from.includes(c)) grid[rowIndex]![x] = to
  })

export const LARGE = { width: 16, height: 18 }

// The pet as the pane's picture: the 16x16 sprite on a 16x18 canvas, with room to bob.
// Frames: odd frames bob (an egg wobbles), every fourth blinks.
export const compose = (species: Species | null, stage: StageId, mood: Mood, frame: number): Grid => {
  const canvas = blank(LARGE.width, LARGE.height)
  const isOdd = frame % 2 === 1
  const isBlinking = frame % 4 === 3

  if (stage === 'egg' || species === null) {
    // the egg wobbles one pixel sideways on odd frames
    blit(canvas, paint(EGG, PALETTES.egg, 'normal', false), isOdd ? 1 : 0, 1)
    return canvas
  }

  const palette = PALETTES[species]
  const sprite = SPRITES[species]
  const bob = isOdd ? 1 : 0
  if (stage === 'hatchling') {
    // the small sprite peeking out of the bottom of its shell
    blit(canvas, paint(sprite.small, palette, mood, isBlinking), 4, 6 + bob)
    blit(canvas, paint(SHELL, PALETTES.egg, 'normal', false), 0, 13)
    return canvas
  }

  const pic = paint(sprite.large, palette, mood, isBlinking)
  if (stage === 'adult' || stage === 'final') recolor(pic, sprite.neck, [palette.b, palette.l], SCARF)
  blit(canvas, pic, 0, 1 + bob)
  if (stage === 'final') {
    blit(canvas, CROWN.map(row => [...row].map(ch => (ch === 'g' ? GOLD : null))), 5, bob)
    const sparkles: [number, number][] = isOdd
      ? [
          [14, 3],
          [1, 10],
        ]
      : [
          [1, 4],
          [14, 11],
        ]
    for (const [x, y] of sparkles) canvas[y]![x] = SPARKLE
  }
  return canvas
}

const DEFAULT_COLOR = 0x01000000
const UPPER_HALF = 0x2580
const LOWER_HALF = 0x2584
const SPACE = 0x20

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export const toBase64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!
    out += b === undefined ? '=' : BASE64[(n >> 6) & 63]!
    out += c === undefined ? '=' : BASE64[n & 63]!
  }
  return out
}

// A picture as Raster cells: two pixels per cell, the upper half block's
// foreground the top pixel and its background the bottom one.
export const toCells = (grid: Grid) => {
  const height = Math.ceil(grid.length / 2)
  const width = grid[0]?.length ?? 0
  const words = new Uint32Array(width * height * 3)
  for (let row = 0; row < height; row++) {
    for (let x = 0; x < width; x++) {
      const top = grid[row * 2]?.[x] ?? null
      const bottom = grid[row * 2 + 1]?.[x] ?? null
      const cell =
        top === null && bottom === null
          ? [SPACE, DEFAULT_COLOR, DEFAULT_COLOR]
          : top === null
            ? [LOWER_HALF, bottom!, DEFAULT_COLOR]
            : [UPPER_HALF, top, bottom ?? DEFAULT_COLOR]
      words.set(cell, (row * width + x) * 3)
    }
  }
  // Raster cells are little-endian u32s
  const bytes = new Uint8Array(words.length * 4)
  const view = new DataView(bytes.buffer)
  words.forEach((w, i) => view.setUint32(i * 4, w, true))
  return { columns: width, rows: height, cells: toBase64(bytes) }
}

export const SPRITE_SOURCES = { SPRITES, EGG, SHELL }
