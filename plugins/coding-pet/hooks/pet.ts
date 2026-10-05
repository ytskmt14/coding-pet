import type { CareKind, Counters, DiaryEntry, Pet, PetSave, Species, StageId } from '../types'

export const STAGES: { id: StageId; label: string; xp: number }[] = [
  { id: 'egg', label: '卵', xp: 0 },
  { id: 'hatchling', label: '赤ちゃん', xp: 30 },
  { id: 'child', label: '子ども', xp: 100 },
  { id: 'adult', label: '大人', xp: 250 },
  { id: 'final', label: '完全体', xp: 500 },
]

export const stageIndex = (xp: number) => STAGES.reduce((at, s, i) => (xp >= s.xp ? i : at), 0)
export const stageOf = (xp: number) => STAGES[stageIndex(xp)]!
// XP needed for the next stage, or null at the last one
export const nextStageXp = (xp: number) => STAGES[stageIndex(xp) + 1]?.xp ?? null

export type AbilityId = 'care' | 'face' | 'speech' | 'celebrate' | 'snack' | 'sound' | 'chatter'

export const ABILITIES: { id: AbilityId; stage: StageId; title: string; detail: string }[] = [
  { id: 'care', stage: 'egg', title: 'お世話', detail: 'ペインでなでたり、ごはんをあげたりできる' },
  { id: 'face', stage: 'hatchling', title: '表情', detail: '気分とお腹の具合が顔に出る' },
  { id: 'speech', stage: 'hatchling', title: 'おしゃべり（定型）', detail: '出来事に合わせてひとこと言う' },
  { id: 'celebrate', stage: 'child', title: 'お祝い', detail: '実績解除を一緒に喜ぶ' },
  { id: 'snack', stage: 'child', title: 'お菓子換算', detail: 'ステータスラインでコストをうまい棒に換算する' },
  { id: 'sound', stage: 'adult', title: '効果音', detail: '実績解除と進化で音が鳴る' },
  { id: 'chatter', stage: 'final', title: 'AIおしゃべり', detail: '小さなモデルが状況に合わせてひとこと考える' },
]

export const hasAbility = (save: PetSave, id: AbilityId) => {
  const ability = ABILITIES.find(a => a.id === id)!
  return stageIndex(save.pet.xp) >= STAGES.findIndex(s => s.id === ability.stage)
}

export type Mood = 'happy' | 'normal' | 'sad' | 'hungry'

export const SPECIES: Record<Species, { label: string; faces: Record<Mood, string> }> = {
  cat: { label: '猫', faces: { happy: '(=^･ω･^=)', normal: '(=･ω･=)', sad: '(=；ω；=)', hungry: '(=´-ω-`=)' } },
  bird: { label: '鳥', faces: { happy: '(・θ・)ﾉ', normal: '(・θ・)', sad: '(；θ；)', hungry: '(-θ-)' } },
  slime: { label: 'スライム', faces: { happy: '(◕ᴗ◕)', normal: '(・_・)', sad: '(；_；)', hungry: '(－_－)' } },
  dragon: { label: 'ドラゴン', faces: { happy: '<(ﾟ∀ﾟ)>', normal: '<(・Д・)>', sad: '<(；Д；)>', hungry: '<(－Д－)>' } },
  ghost: { label: 'おばけ', faces: { happy: 'ヽ(°ᗜ°)ﾉ', normal: '(°ᗜ°)', sad: '(；ᗜ；)', hungry: '(－ᗜ－)' } },
}

export const SPECIES_IDS = Object.keys(SPECIES) as Species[]

// Fullness drops by 1 every 10 minutes since the last meal. Kept unrounded, so short gaps
// between meals still add up; drawings round it.
const FULLNESS_DECAY_MS = 10 * 60 * 1000
export const currentFullness = (pet: Pet, now: number) =>
  Math.max(0, pet.fullness - Math.max(0, now - pet.lastFedAt) / FULLNESS_DECAY_MS)

export const moodOf = (pet: Pet, now: number): Mood => {
  if (currentFullness(pet, now) < HUNGRY) return 'hungry'
  if (pet.mood >= 70) return 'happy'
  if (pet.mood < 30) return 'sad'
  return 'normal'
}

export const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0)
const clampExact = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0)

export const HUNGRY = 25

// A turn is a meal of its output tokens. A pet that was hungry when it came sulks a little;
// eating cheers it up, more for a bigger meal.
export const afterMeal = (pet: Pet, now: number, eatenTokens: number): Pet => {
  const before = currentFullness(pet, now)
  const sulk = before < HUNGRY ? -3 : 0
  const cheer = Math.min(5, Math.floor(eatenTokens / 200))
  return {
    ...pet,
    // 100 tokens fill one point
    fullness: clampExact(before + eatenTokens / 100),
    lastFedAt: now,
    mood: clamp(pet.mood + sulk + cheer),
  }
}

// The pet as text, where no Raster can be drawn: an egg wobbles; a hatched pet bobs and dresses up as it grows.
export const drawPet = (pet: Pet, now: number, frame: number) => {
  const stage = stageOf(pet.xp).id
  if (stage === 'egg' || pet.species === null) return frame % 2 === 0 ? '(  )' : ' (  )'
  const face = SPECIES[pet.species].faces[moodOf(pet, now)]
  const bob = frame % 2 === 0 ? '' : ' '
  if (stage === 'hatchling') return `${bob}${face}`
  if (stage === 'child') return `${bob}${face}${frame % 2 === 0 ? '~' : ' '}`
  if (stage === 'adult') return `${bob}ฅ${face}ฅ`
  return frame % 2 === 0 ? `+${face}+` : `*${face}*`
}

export type LineKind = 'idle' | 'success' | 'error' | 'deny' | 'commit' | 'test' | 'thanks' | 'hungry' | 'hatch' | 'grow'

const LINES: Record<LineKind, string[]> = {
  idle: ['ふわぁ…', 'なにしてるの？', 'がんばってるね', 'ここにいるよ', 'ねむい…'],
  success: ['いいね！', 'うまくいった！', 'その調子！', 'さすが！'],
  error: ['あれれ…', 'どんまい！', 'もう一回いこう', 'だいじょうぶ？'],
  deny: ['止められちゃった', 'こわかった…', 'それはダメだって'],
  commit: ['コミットおめでとう！', '記録できたね！', 'えらい！'],
  test: ['テスト全部緑！', 'グリーン最高！', '通った通った！'],
  thanks: ['えへへ', 'どういたしまして！', 'うれしい！'],
  hungry: ['おなかすいた…', 'ごはんまだ？', 'トークン食べたい…'],
  hatch: ['うまれたよ！', 'はじめまして！', 'ここどこ？'],
  grow: ['大きくなったよ！', 'できること増えた！', 'みてみて！'],
}

export const lineFor = (kind: LineKind, pick: number) => {
  const list = LINES[kind]
  return list[Math.floor(pick * list.length) % list.length]!
}

export const freshCounters = (): Counters => ({
  turns: 0,
  aborted: 0,
  tools: {},
  errors: 0,
  denies: 0,
  recoveries: 0,
  failedTools: [],
  commits: 0,
  testPasses: 0,
  subagents: 0,
  thanks: 0,
  costUsd: 0,
  maxSessionCostUsd: 0,
  longestTurnMs: 0,
  maxParallel: 0,
  sessions: 0,
  lastSessionDay: null,
  streakDays: 0,
  nightOwl: false,
})

export const freshSave = (now: number): PetSave => ({
  version: 1,
  pet: {
    name: 'たま',
    species: null,
    xp: 0,
    bornAt: new Date(now).toISOString(),
    mood: 60,
    fullness: 80,
    lastFedAt: now,
    affection: 0,
  },
  unlocked: {},
  counters: freshCounters(),
  settings: { sound: true, chatter: true },
  diary: [],
  care: { day: localDay(now), feed: 0, pat: 0, play: 0 },
})

// A save read back from the store, checked field by field: a field missing or of the wrong
// kind (a hand edit, an older or newer version of this mod) falls back to its default
// alone, so one bad value never freezes or hides the pet.
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

// Whether a stored value is a save this version can read: nothing stored yet, or version 1.
// Anything else (a newer version, a broken file) must not be written over.
export const isReadable = (raw: unknown) => raw === undefined || obj(raw).version === 1

export const loadSave = (raw: unknown, now: number): PetSave => {
  const fresh = freshSave(now)
  const r = obj(raw)
  if (r.version !== 1) return fresh
  const p = obj(r.pet)
  const c = obj(r.counters)
  const st = obj(r.settings)
  const d = fresh.counters
  const species = SPECIES_IDS.find(id => id === p.species) ?? null
  const counts = (v: unknown) =>
    Object.fromEntries(Object.entries(obj(v)).filter((e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])))
  return {
    version: 1,
    pet: {
      name: str(p.name, fresh.pet.name),
      species,
      xp: Math.max(0, num(p.xp, 0)),
      bornAt: typeof p.bornAt === 'string' && Number.isFinite(Date.parse(p.bornAt)) ? p.bornAt : fresh.pet.bornAt,
      mood: clamp(num(p.mood, fresh.pet.mood)),
      fullness: clampExact(num(p.fullness, fresh.pet.fullness)),
      lastFedAt: num(p.lastFedAt, now),
      affection: clamp(num(p.affection, 0)),
    },
    unlocked: Object.fromEntries(Object.entries(obj(r.unlocked)).filter((e): e is [string, string] => typeof e[1] === 'string')),
    counters: {
      turns: num(c.turns, d.turns),
      aborted: num(c.aborted, d.aborted),
      tools: counts(c.tools),
      errors: num(c.errors, d.errors),
      denies: num(c.denies, d.denies),
      recoveries: num(c.recoveries, d.recoveries),
      failedTools: Array.isArray(c.failedTools) ? c.failedTools.filter((t): t is string => typeof t === 'string') : [],
      commits: num(c.commits, d.commits),
      testPasses: num(c.testPasses, d.testPasses),
      subagents: num(c.subagents, d.subagents),
      thanks: num(c.thanks, d.thanks),
      costUsd: num(c.costUsd, d.costUsd),
      // older saves kept the last session's spend under sessionCostUsd
      maxSessionCostUsd: num(c.maxSessionCostUsd, num(c.sessionCostUsd, d.maxSessionCostUsd)),
      longestTurnMs: num(c.longestTurnMs, d.longestTurnMs),
      maxParallel: num(c.maxParallel, d.maxParallel),
      sessions: num(c.sessions, d.sessions),
      lastSessionDay: typeof c.lastSessionDay === 'string' ? c.lastSessionDay : null,
      streakDays: num(c.streakDays, d.streakDays),
      nightOwl: bool(c.nightOwl, d.nightOwl),
    },
    settings: {
      sound: bool(st.sound, fresh.settings.sound),
      chatter: bool(st.chatter, fresh.settings.chatter),
    },
    diary: (Array.isArray(r.diary) ? r.diary : [])
      .map(obj)
      .filter(e => typeof e.at === 'number' && Number.isFinite(e.at) && typeof e.text === 'string')
      .map(e => ({ at: e.at as number, text: e.text as string }))
      .slice(-DIARY_KEEP),
    care: (() => {
      const c = obj(r.care)
      return { day: str(c.day, fresh.care.day), feed: num(c.feed, 0), pat: num(c.pat, 0), play: num(c.play, 0) }
    })(),
  }
}

// The diary keeps this many lines across days.
export const DIARY_KEEP = 40

export const addDiary = (save: PetSave, entries: DiaryEntry[]): PetSave =>
  entries.length === 0 ? save : { ...save, diary: [...save.diary, ...entries].slice(-DIARY_KEEP) }

// Care a person can give each day, and what it does. Care earns no XP: growth comes from work.
export const CARE: Record<CareKind, { label: string; perDay: number }> = {
  feed: { label: 'ごはん', perDay: 3 },
  pat: { label: 'なでる', perDay: 5 },
  play: { label: 'あそぶ', perDay: 3 },
}

// Care counts start over only when the day moves forward (YYYY-MM-DD compares as text): a
// clock set back, or a session in another time zone, keeps the counts already used.
const careToday = (save: PetSave, now: number) => {
  const today = localDay(now)
  return today > save.care.day ? { day: today, feed: 0, pat: 0, play: 0 } : save.care
}

export const careLeft = (save: PetSave, kind: CareKind, now: number) => {
  const used = careToday(save, now)[kind]
  return Math.max(0, CARE[kind].perDay - used)
}

// One act of care: the save after it and the diary's words, or why it cannot be given now.
export const giveCare = (save: PetSave, kind: CareKind, now: number): { save: PetSave; text: string } | { refused: string } => {
  const isEgg = stageIndex(save.pet.xp) === 0 || save.pet.species === null
  if (isEgg && kind !== 'pat') return { refused: 'まだ卵です。なでてあたためてあげよう' }
  if (careLeft(save, kind, now) === 0) return { refused: `きょうの${CARE[kind].label}はもうおしまい。また明日` }
  const pet = save.pet
  const full = currentFullness(pet, now)
  const care = careToday(save, now)
  const after = { ...save, care: { ...care, [kind]: care[kind] + 1 } }
  if (kind === 'feed') {
    if (full >= 95) return { refused: 'おなかいっぱいみたい' }
    return { save: { ...after, pet: { ...pet, fullness: clampExact(full + 30), lastFedAt: now, mood: clamp(pet.mood + 2) } }, text: 'ごはんをもらった' }
  }
  if (kind === 'pat') {
    return {
      save: { ...after, pet: { ...pet, mood: clamp(pet.mood + 5), affection: clamp(pet.affection + 2) } },
      text: isEgg ? '卵をあたためてもらった' : 'なでてもらった',
    }
  }
  return {
    save: {
      ...after,
      pet: { ...pet, fullness: clampExact(full - 5), lastFedAt: now, mood: clamp(pet.mood + 10), affection: clamp(pet.affection + 5) },
    },
    text: 'いっしょにあそんだ',
  }
}

// How the pet seems right now, for the pane's "いま" line.
export const describe = (save: PetSave, now: number) => {
  if (stageIndex(save.pet.xp) === 0 || save.pet.species === null) return 'ときどき卵が動いている…'
  const mood = moodOf(save.pet, now)
  if (mood === 'hungry') return 'おなかがすいているみたい'
  if (mood === 'sad') return 'しょんぼりしている'
  if (mood === 'happy') return 'ごきげん！'
  return 'のんびりしている'
}

// Days since the egg came, counting the first day as day 1.
export const ageDays = (save: PetSave, now: number) => {
  const born = new Date(save.pet.bornAt)
  const start = new Date(born.getFullYear(), born.getMonth(), born.getDate()).getTime()
  const today = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime()
  return Number.isFinite(start) ? Math.max(1, Math.round((today - start) / 86_400_000) + 1) : 1
}

// A name as typed: no control or format characters (zero-width spaces, direction marks, line
// separators), at most 12 characters as a person counts them (an emoji built of several code
// points stays whole). Empty when nothing visible is left.
const NAME_MAX = 12
export const cleanName = (typed: string) => {
  // the zero-width joiner stays: it holds emoji such as 👨‍👩‍👧 together
  const visible = typed.replace(/[\p{Cc}\u2028\u2029]|(?!\u200d)\p{Cf}/gu, '').trim()
  const chars =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? Array.from(new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(visible), part => part.segment)
      : Array.from(visible)
  // a joiner left on its own joins nothing and shows nothing
  return chars
    .filter(c => c.replace(/\u200d/g, '') !== '')
    .slice(0, NAME_MAX)
    .join('')
}

// うまい棒 at ¥15, a dollar at ¥150: a rough figure, for fun.
export const snacks = (usd: number) => Math.floor((usd * 150) / 15)

// The day before `day` (YYYY-MM-DD) by the calendar, right across daylight saving changes.
export const dayBefore = (now: number) => {
  const d = new Date(now)
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime())
}

// Counters as of `now`: a new local day moves the streak (+1 after yesterday, else back to 1).
export const rollDay = (c: Counters, now: number): Counters => {
  const today = localDay(now)
  if (c.lastSessionDay === today) return c
  const streakDays = c.lastSessionDay === dayBefore(now) ? c.streakDays + 1 : 1
  return { ...c, lastSessionDay: today, streakDays }
}

export const localDay = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
