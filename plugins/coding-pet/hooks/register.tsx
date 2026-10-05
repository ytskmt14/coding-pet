import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CareKind, PaneTab, PetSave } from '../types'
import { ACHIEVEMENTS, XP_PER_TURN } from './achievements'
import type { Achievement } from './achievements'
import {
  ABILITIES,
  addDiary,
  afterMeal,
  ageDays,
  CARE,
  careLeft,
  clamp,
  cleanName,
  currentFullness,
  describe,
  drawPet,
  giveCare,
  hasAbility,
  isReadable,
  HUNGRY,
  lineFor,
  loadSave,
  localDay,
  moodOf,
  nextStageXp,
  rollDay,
  snacks,
  SPECIES,
  SPECIES_IDS,
  stageIndex,
  stageOf,
  STAGES,
} from './pet'
import type { LineKind } from './pet'
import { award, isCommit, isTestRun, isThanks } from './rules'
import { compose, toCells } from './sprites'

const PANE = 'pet'
const STORE_KEY = 'save'
const SPEECH_MS = 60_000
const CHAT_GAP_MS = 60_000
// /pet preview may show the chatter sooner, but never more than once in this
const PREVIEW_CHAT_GAP_MS = 10_000
// the diary lines the home tab shows, always this many rows tall
const DIARY_ROWS = 5
// the home tab's rows besides the picture, and one spare so a wrapped line clips the diary, not the buttons
const HOME_ROWS = 13 + 1
// what the store is re-read for, so other sessions' progress shows: every this many ticks (1.5 s each)
const REFRESH_TICKS = 7

// `shape` names the save's form: a hot reload keeps atom values, so a value written by an
// older form of PetSave must not reach this code. Change the tag whenever PetSave changes.
const saveAtom = atom({ plugin: 'coding-pet', key: 'save' } as const, null, { shape: 'save-v3' })
const unreadable = atom({ plugin: 'coding-pet', key: 'unreadable' } as const, false)
const notice = atom({ plugin: 'coding-pet', key: 'notice' } as const, null)
const speech = atom({ plugin: 'coding-pet', key: 'speech' } as const, null)
const frame = atom({ plugin: 'coding-pet', key: 'frame' } as const, 0)
const sessionCounted = atom({ plugin: 'coding-pet', key: 'sessionCounted' } as const, false)
const lastChatAt = atom({ plugin: 'coding-pet', key: 'lastChatAt' } as const, 0)
const preview = atom({ plugin: 'coding-pet', key: 'preview' } as const, null)
const tab = atom({ plugin: 'coding-pet', key: 'tab' } as const, 'home' as PaneTab)
// whether the pet's pane is open: the animation and the store refresh run only then
const paneOpen = atom({ plugin: 'coding-pet', key: 'paneOpen' } as const, false)
const seenSessionUsd = atom({ plugin: 'coding-pet', key: 'seenSessionUsd' } as const, null)

const SUBAGENT_TOOLS = new Set(['Agent', 'Task'])

type Change = (save: PetSave, now: number) => PetSave

// Work a hook hands off, as data: run by runJob on the session's $.
type Job =
  | { kind: 'change'; change: Change; line?: LineKind; diary?: string }
  | { kind: 'care'; care: CareKind }
  | { kind: 'edit'; change: Change }
  | { kind: 'turn'; isCounted: boolean; isAborted: boolean; eaten: number; durationMs: number }

// Every write to the save goes through this one chain, so writes never land out of order.
let chain: Promise<void> = Promise.resolve()
let running = 0
let ticker: { cancel: () => void } | undefined
// Jobs waiting for the session's runner, and the runner's wake-up: set by session.start,
// whose $ the jobs run on (the $ of the dispatch that queued one ends with its hook).
const pending: Job[] = []
let wake: (() => void) | undefined

// A job that has not settled in this long lets the queue go on (a $ call that never settles
// must not stall every later job, nor the commands awaiting theirs).
const JOB_TIMEOUT_MS = 30_000

const serial = (job: Job, $: EngineInterface) => {
  const run = chain.then(() => withTimeout($, runJob($, job)))
  chain = run.catch(() => {})
  return run
}

async function withTimeout($: EngineInterface, work: Promise<void>) {
  let timer: { cancel: () => void } | undefined
  const expired = new Promise<void>((_, reject) => {
    timer = $.clock.after(JOB_TIMEOUT_MS, () => reject(new Error('the job took too long')))
  })
  try {
    await Promise.race([work, expired])
  } finally {
    timer?.cancel()
  }
}

// Work a hook hands off so it can return its result at once.
// At most this many jobs wait for the runner; past it the oldest go (a runner that never
// started must not let the queue grow for the module's whole life).
const PENDING_MAX = 500

const later = (job: Job) => {
  pending.push(job)
  if (pending.length > PENDING_MAX) pending.splice(0, pending.length - PENDING_MAX)
  wake?.()
}

// For tests: resolves once the queued jobs have run.
export const settled = () => chain

// The store is the one source of truth, since every session writes it: read it, apply the
// change, write it back, then mirror it for drawing. A save this version cannot read is never
// written over, and a failed write throws: the view and the reactions follow only what was saved.
const commit = async ($: EngineInterface, change: (save: PetSave, now: number) => PetSave) => {
  const now = await $.clock.now()
  const raw = await $.store.get(STORE_KEY)
  if (!isReadable(raw)) {
    await update($, unreadable, () => true)
    throw new Error('the stored save is of a form this version cannot read')
  }
  const before = loadSave(raw, now)
  const after = change(before, now)
  await $.store.set(STORE_KEY, after)
  await update($, saveAtom, () => after)
  return { before, after, now }
}

// Reads the store again into the mirror, so the pane shows other sessions' progress too.
const refresh = async ($: EngineInterface) => {
  const now = await $.clock.now()
  const raw = await $.store.get(STORE_KEY)
  await update($, unreadable, () => !isReadable(raw))
  const loaded = loadSave(raw, now)
  await update($, saveAtom, () => loaded)
  return loaded
}

// What the pane draws: the save, or the save seen at the previewed stage.
const shownSave = async ($: EngineInterface) => {
  const held = await read($, saveAtom)
  // checked on every read, so no value of an unexpected form ever reaches a drawing
  const save = held === null ? null : loadSave(held, await $.clock.now())
  const p = await read($, preview)
  return save && p ? { ...save, pet: { ...save.pet, xp: p.xp, species: p.species } } : save
}

const say = async ($: EngineInterface, text: string) => {
  const at = await $.clock.now()
  await update($, speech, () => ({ text, at }))
}

// The mod's own message (a refusal, a hint), shown without the pet's quotes.
const tell = async ($: EngineInterface, text: string) => {
  const at = await $.clock.now()
  await update($, notice, () => ({ text, at }))
}

// Not awaited: a sound plays out on its own (audio.play resolves once played).
const play = ($: EngineInterface, save: PetSave, asset: string) => {
  if (hasAbility(save, 'sound') && save.settings.sound) void $.audio.play({ asset }).catch(() => {})
}

// The snack line counts this session's own spend, never another session's.
const showStatus = async ($: EngineInterface, save: PetSave, isPreview = false) => {
  const spent = (await read($, seenSessionUsd)) ?? 0
  $.ui.status(hasAbility(save, 'snack') ? `🍫 うまい棒${snacks(spent)}本分${isPreview ? '（プレビュー）' : ''}` : undefined)
}

// The pet's reaction to a committed change: toasts for achievements and growth, a line, a sound.
const react = async ($: EngineInterface, before: PetSave, after: PetSave, earned: Achievement[], line?: LineKind) => {
  for (const a of earned) $.ui.toast(`🏆 実績解除: ${a.title} (+${a.xp} XP)`)
  if (stageIndex(after.pet.xp) > stageIndex(before.pet.xp)) {
    // out of the egg stage, whether the species was picked at random or chosen beforehand
    const hatched = stageIndex(before.pet.xp) === 0
    $.ui.toast(
      hatched
        ? `🐣 卵がかえった！ ${SPECIES[after.pet.species!].label}の${after.pet.name}が生まれた`
        : `✨ ${after.pet.name}が${stageOf(after.pet.xp).label}に成長した！ /pet でできることを見てね`,
    )
    await say($, lineFor(hatched ? 'hatch' : 'grow', Math.random()))
    play($, after, hatched ? 'sounds/hatch.wav' : 'sounds/levelup.wav')
  } else if (earned.length > 0) {
    if (hasAbility(after, 'celebrate')) await say($, `「${earned[0]!.title}」おめでとう！`)
    play($, after, 'sounds/fanfare.wav')
  } else if (line && hasAbility(after, 'speech')) {
    await say($, lineFor(line, Math.random()))
  }
  if ((await read($, preview)) === null) await showStatus($, after)
}

// A change that can earn something: commit, award, write the diary, react.
async function runChange($: EngineInterface, change: Change, line?: LineKind, diary?: string) {
  let earned: Achievement[] = []
  const pick = Math.random()
  const done = await commit($, (s, now) => {
    const r = award(change(s, now), new Date(now).toISOString(), pick)
    earned = r.earned
    const grew = stageIndex(r.save.pet.xp) > stageIndex(s.pet.xp)
    return addDiary(r.save, [
      ...(diary ? [{ at: now, text: diary }] : []),
      ...r.earned.map(a => ({ at: now, text: `実績「${a.title}」を解除した` })),
      ...(grew
        ? [{ at: now, text: stageIndex(s.pet.xp) === 0 ? `卵がかえって${SPECIES[r.save.pet.species!].label}が生まれた` : `${stageOf(r.save.pet.xp).label}に成長した` }]
        : []),
    ])
  })
  await react($, done.before, done.after, earned, line)
  return done
}

// Care from the pane's buttons: given, written in the diary, or refused with the reason.
async function runCare($: EngineInterface, kind: CareKind) {
  let refused = ''
  const done = await commit($, (s, now) => {
    const r = giveCare(s, kind, now)
    if ('refused' in r) {
      refused = r.refused
      return s
    }
    return addDiary(r.save, [{ at: now, text: r.text }])
  })
  if (refused !== '') await tell($, refused)
  else if (hasAbility(done.after, 'speech')) await say($, lineFor(kind === 'feed' ? 'success' : 'thanks', Math.random()))
}

// A finished turn: the meal, the XP, the day, and the spend /cost totals (its growth since
// last seen is new spend; a resumed session's earlier spend was counted when it was spent).
async function runTurn($: EngineInterface, job: Extract<Job, { kind: 'turn' }>) {
  const spent = (await $.session.usage()).cost?.usd
  const seen = await read($, seenSessionUsd)
  const added = spent !== undefined && seen !== null ? Math.max(0, spent - seen) : 0
  const done = await runChange($, (s, now) => {
    const c = rollDay(s.counters, now)
    return {
      ...s,
      // an interrupted or empty turn earns nothing (but is still counted as interrupted)
      pet: job.isCounted ? { ...afterMeal(s.pet, now, job.eaten), xp: s.pet.xp + XP_PER_TURN } : s.pet,
      counters: {
        ...c,
        turns: c.turns + (job.isCounted ? 1 : 0),
        aborted: c.aborted + (job.isAborted ? 1 : 0),
        longestTurnMs: job.isCounted ? Math.max(c.longestTurnMs, job.durationMs) : c.longestTurnMs,
        costUsd: c.costUsd + added,
        maxSessionCostUsd: Math.max(c.maxSessionCostUsd, spent ?? 0),
      },
    }
  })
  // only once saved, so a failed write does not lose the spend
  if (spent !== undefined) await update($, seenSessionUsd, () => spent)
  if (currentFullness(done.after.pet, done.now) < HUNGRY && hasAbility(done.after, 'speech')) await say($, lineFor('hungry', Math.random()))
  // the model call runs beside the queue, not in it
  void chat($, done.after)
}

async function runJob($: EngineInterface, job: Job) {
  if (job.kind === 'change') await runChange($, job.change, job.line, job.diary)
  else if (job.kind === 'care') await runCare($, job.care)
  else if (job.kind === 'edit') await commit($, job.change)
  else await runTurn($, job)
}

// Settings, the name, the species: saved as is, no achievements. Commands await it.
const edit = ($: EngineInterface, change: (save: PetSave) => PetSave) => serial({ kind: 'edit', change: s => change(s) }, $)

// The save for a command or a drawing: this session's mirror, read from the store the first time.
const load = async ($: EngineInterface) => {
  const held = await read($, saveAtom)
  if (held) return loadSave(held, await $.clock.now())
  return refresh($)
}

// The pet's own words from a small model, once the pet can chat; a set line when it cannot answer.
// Only the pet's species and the name the person gave it, its mood and counts go to the model:
// never code, paths, commands or the person's prompts.
const chat = async ($: EngineInterface, save: PetSave, gapMs = CHAT_GAP_MS) => {
  try {
    if (!hasAbility(save, 'chatter') || !save.settings.chatter || save.pet.species === null) return
    const now = await $.clock.now()
    if (now - (await read($, lastChatAt)) < gapMs) return
    await update($, lastChatAt, () => now)
    const c = save.counters
    const prompt = [
      `あなたは${SPECIES[save.pet.species].label}のペット「${save.pet.name}」です。`,
      '飼い主はいまAIと一緒にプログラミングをしています。',
      `いまの気分: ${moodOf(save.pet, now)}。これまで: ${c.turns}ターン、エラー${c.errors}回、コミット${c.commits}回、実績${Object.keys(save.unlocked).length}個。`,
      '飼い主にかけるひとことを、ペットらしい口調で20文字以内で1つだけ書いてください。かぎかっこは付けないでください。',
    ].join('\n')
    const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 60, effort: 'low', timeoutMs: 8000 })
    const text = r.isAnswered
      ? Array.from(r.text.replace(/\s+/g, ' ').trim().replace(/^「|」$/g, ''))
          .slice(0, 30)
          .join('')
      : ''
    await say($, text || lineFor('idle', Math.random()))
  } catch {
    try {
      await say($, lineFor('idle', Math.random()))
    } catch {}
  }
}

// Opens the pane tall enough for the whole screen (tabs, border, name row, content) and
// focused, so the number keys work at once.
const openPane = async ($: EngineInterface) => {
  const isPreview = (await read($, preview)) !== null
  await update($, paneOpen, () => true)
  return $.ui.open({ id: PANE, title: 'Pet', focus: true, rows: contentRows('terminal') + 4 + (isPreview ? 1 : 0) })
}

// Every tab gets the height of the tallest, so switching never makes the screen jump:
// home is the picture (9 rows on the terminal, the 4 info rows elsewhere) + HOME_ROWS;
// the achievements tab is one row each and a title.
const contentRows = (surface: string) => Math.max((surface === 'terminal' ? 9 : 4) + HOME_ROWS, ACHIEVEMENTS.length + 1)

const parseSpecies = (word: string | undefined) => SPECIES_IDS.find(id => id === word || SPECIES[id].label === word)
const parseStage = (word: string | undefined) => STAGES.find(st => st.id === word || st.label === word)
const SPECIES_LIST = SPECIES_IDS.map(id => `${id}(${SPECIES[id].label})`).join(' ')
// /pet help: built from the stage and ability tables, so it follows them. Achievement
// conditions stay hidden: finding them is the game.
export const helpText = () =>
  [
    'ペットの育て方',
    '',
    'コマンド',
    '  /pet                      ペインを開く（お世話・ようす・日記・実績・できること・せってい）',
    '  /pet name <名前>          名前を変える（12文字まで）',
    '  /pet sound on|off         効果音を切り替える',
    '  /pet chatter on|off       AIおしゃべりを切り替える',
    '  /pet switch <種族>        種族を切り替える（成長・実績・名前はそのまま。卵なら生まれる種族を決める）',
    '  /pet preview <段階> <種族> 見た目だけ試す（どちらか片方でもよい。保存データは変わらない）',
    '  /pet preview off          プレビューを終える',
    '  /pet help                 このヘルプ',
    `  段階: ${STAGES.map(st => `${st.id}(${st.label})`).join(' ')}`,
    `  種族: ${SPECIES_LIST}`,
    '',
    '育ち方',
    `  実績を解除するとXPが入る。1ターン終えるごとにも${XP_PER_TURN}XP。卵は${STAGES[1]!.xp}XPで孵化し、種族はそのときランダムに決まる（/pet switch で決めておくこともできる）。`,
    ...STAGES.map(st => {
      const opened = ABILITIES.filter(ab => ab.stage === st.id).map(ab => ab.title)
      return `  ${st.label.padEnd(5, '　')} ${String(st.xp).padStart(3)}XP〜  ${opened.length > 0 ? `${opened.join('、')}が使えるようになる` : ''}`
    }),
    '',
    'お世話（ペインのボタン。XPは入らない）',
    ...(Object.keys(CARE) as CareKind[]).map(k => `  ${CARE[k].label}: 1日${CARE[k].perDay}回まで`),
    '  ごはん: おなか+30、きげん少し上がる（おなかいっぱいのときは食べない）',
    '  なでる: きげんとなかよし度が上がる。卵のうちはこれだけ（あたためる）',
    '  あそぶ: きげんとなかよし度が大きく上がり、おなかが少し減る',
    '  ペインにフォーカスがあるとき、数字キー 1〜3 でお世話、4〜7 でタブを切り替えられる。',
    '',
    '気分とおなか',
    '  気分: ツールが成功すると上がり、エラーや拒否で下がる。実績解除、「ありがとう」、お世話で上がる。',
    '  おなか: 時間とともに減り、Claudeの出力（トークン）を食べて回復する。',
    `  おなかが${HUNGRY}未満のままターンを迎えると拗ねて気分が下がる。たくさん食べると機嫌が直る。`,
    '  いなくなることはない。',
    '',
    '実績',
    `  全${ACHIEVEMENTS.length}個。名前は /pet で見られるが、解除の条件は解除するまで秘密。名前から推理してみよう。`,
  ].join('\n')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // the runner for queued jobs: a timer on this session's $, so the jobs outlive the hooks that
    // queue them. Set before anything that can fail, so queued work is never stranded.
    wake = () =>
      void $.clock.after(0, () => {
        for (const job of pending.splice(0)) void serial(job, $).catch(() => {})
      })
    const result = await next(e)
    wake()
    try {
      await $.command.register({ name: 'pet', description: 'Your pet (/pet help for everything it does)' })
    } catch {}
    try {
      await load($)
    } catch {}
    try {
      // a hot reload fires session.start again: count the session once, and only one a person sits at
      // a resumed session's earlier spend was counted when it was spent
      if ((await read($, seenSessionUsd)) === null) {
        const usd = (await $.session.usage()).cost?.usd ?? 0
        await update($, seenSessionUsd, () => usd)
      }
      if (e.isInteractive && !(await read($, sessionCounted))) {
        await update($, sessionCounted, () => true)
        later({
          kind: 'change',
          diary: 'あいにきてくれた',
          change: (s, now) => ({
            ...s,
            counters: {
              ...rollDay(s.counters, now),
              sessions: s.counters.sessions + 1,
              nightOwl: s.counters.nightOwl || new Date(now).getHours() < 4,
            },
          }),
        })
      }
    } catch {}
    try {
      ticker?.cancel()
      ticker = e.isInteractive
        ? $.clock.every(1500, () => {
            void (async () => {
              if (!(await read($, paneOpen))) return
              const f = await update($, frame, n => (n + 1) % (4 * REFRESH_TICKS))
              if (f % REFRESH_TICKS === 0) await refresh($)
            })().catch(() => {})
          })
        : undefined
    } catch {}

    return result
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const value = rest.join(' ')
    const toggle = (v: string) => (v === 'on' ? true : v === 'off' ? false : null)

    if (verb === 'help') return { text: helpText() }
    if (verb === '') {
      // read again, so the pane opens on what every session has done
      await refresh($)
      await openPane($)
      return { text: 'ペットのペインを開きました。数字キーでお世話とタブの切り替えができます。' }
    }
    if (verb === 'name') {
      const name = cleanName(value)
      if (name === '') return { text: '使い方: /pet name <名前>（12文字まで）' }
      await edit($, s => ({ ...s, pet: { ...s.pet, name } }))
      if (hasAbility(await load($), 'speech')) await say($, `${name}…いい名前！`)
      return { text: `ペットの名前を「${name}」にしました。` }
    }
    if (verb === 'sound' || verb === 'chatter') {
      const isOn = toggle(value)
      if (isOn === null) return { text: `使い方: /pet ${verb} on|off` }
      await edit($, s => ({ ...s, settings: { ...s.settings, [verb]: isOn } }))
      return { text: `${verb === 'sound' ? '効果音' : 'AIおしゃべり'}を${isOn ? 'オン' : 'オフ'}にしました。` }
    }
    if (verb === 'switch') {
      const species = parseSpecies(value)
      if (!species) return { text: `使い方: /pet switch <種族>。種族: ${SPECIES_LIST}` }
      // the store's save, not this session's mirror: another session may have moved on
      const save = await refresh($)
      if (save.pet.species === species) return { text: `${save.pet.name}はもう${SPECIES[species].label}です。` }
      // only the species changes: XP, stage, achievements, mood and name stay
      await edit($, s => ({ ...s, pet: { ...s.pet, species } }))
      // a preview would hide the change
      await update($, preview, () => null)
      const isEgg = stageIndex(save.pet.xp) === 0
      if (!isEgg && hasAbility(save, 'speech')) await say($, lineFor('grow', Math.random()))
      return {
        text: isEgg
          ? `卵がかえると${SPECIES[species].label}が生まれます。`
          : `${save.pet.name}が${SPECIES[species].label}になりました（${stageOf(save.pet.xp).label}・XP ${save.pet.xp}のまま）。`,
      }
    }
    if (verb === 'preview') {
      if (value === 'off') {
        await update($, preview, () => null)
        await showStatus($, await load($))
        return { text: 'プレビューを終えました。' }
      }
      // a stage, a species, or both, in either order: `adult dragon`, `ドラゴン`, `完全体 猫`
      const stageWord = rest.find(w => parseStage(w))
      const speciesWord = rest.find(w => parseSpecies(w))
      if (rest.length === 0 || rest.length > 2 || rest.some(w => w !== stageWord && w !== speciesWord)) {
        return { text: `使い方: /pet preview <段階> <種族> か /pet preview off。段階: ${STAGES.map(st => st.id).join('|')}、種族: ${SPECIES_IDS.join('|')}` }
      }
      const save = await load($)
      const current = await read($, preview)
      const species = parseSpecies(speciesWord) ?? current?.species ?? save.pet.species ?? 'cat'
      // a species alone keeps the stage in view, hatched at least so it shows
      const stage = parseStage(stageWord) ?? STAGES[Math.max(1, stageIndex(current?.xp ?? save.pet.xp))]!
      await update($, preview, () => ({ xp: stage.xp, species }))
      const shown = (await shownSave($))!
      // show each ability the stage has, once
      if (stage.id !== 'egg') await say($, lineFor('grow', Math.random()))
      if (hasAbility(shown, 'snack')) await showStatus($, shown, true)
      else await showStatus($, save)
      play($, shown, 'sounds/levelup.wav')
      void chat($, shown, PREVIEW_CHAT_GAP_MS)
      await openPane($)
      const abilities = ABILITIES.filter(ab => hasAbility(shown, ab.id)).map(ab => ab.title)
      return { text: `${SPECIES[species].label}の${stage.label}をプレビュー中（保存データは変わりません）。できること: ${abilities.join('、')}。/pet preview off で戻ります。` }
    }
    return { text: `「${verb}」は知らないコマンドです。/pet help で使い方を見られます。` }
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) await update($, paneOpen, () => false)
    return result
  })

  // The hooks below observe only: each passes the event on unchanged, hands its
  // bookkeeping to a job, and returns the result without waiting for it.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    try {
      // the prompt's text is only tested here, never kept
      if (isThanks(e.origin.kind, e.text)) {
        later({
          kind: 'change',
          change: s => ({ ...s, pet: { ...s.pet, mood: clamp(s.pet.mood + 10) }, counters: { ...s.counters, thanks: s.counters.thanks + 1 } }),
          line: 'thanks',
          diary: 'ありがとうと言われてうれしかった',
        })
      }
    } catch {}

    return result
  })

  on('tool.call', async ($, e, next) => {
    // parallel calls of the main thread only: a subagent's tools run inside its Agent call
    const isMain = e.agentId === undefined
    if (isMain) running += 1
    const peak = isMain ? running : 0
    let result
    try {
      result = await next(e)
    } finally {
      if (isMain) running -= 1
    }
    try {
      const isDenied = 'deny' in result && result.deny !== undefined
      const isError = isDenied || result.isError === true
      const command = e.tool === 'Bash' && typeof e.command === 'string' ? e.command : ''
      const isCommitted = !isError && isCommit(command)
      const isTested = !isError && isTestRun(command)
      const roll = Math.random()
      const line: LineKind | undefined = isDenied
        ? 'deny'
        : isError
          ? roll < 0.5
            ? 'error'
            : undefined
          : isCommitted
            ? 'commit'
            : isTested
              ? 'test'
              : roll < 0.15
                ? 'success'
                : undefined
      const tool = e.tool
      // canned words only: never the command or the file
      const diary = isDenied
        ? 'ツールを止められてびっくりした'
        : isCommitted
          ? 'コミットしてよろこんだ'
          : isTested
            ? 'テストが通ってよろこんだ'
            : isError
              ? 'エラーでしょんぼりした'
              : undefined
      later({
        kind: 'change',
        line,
        diary,
        change: s => {
          const c = s.counters
          const hadFailed = c.failedTools.includes(tool)
          return {
            ...s,
            pet: { ...s.pet, mood: clamp(s.pet.mood + (isDenied ? -3 : isError ? -5 : 1)) },
            counters: {
              ...c,
              // only calls that ran count toward the tool achievements
              tools: isError ? c.tools : { ...c.tools, [tool]: (c.tools[tool] ?? 0) + 1 },
              errors: c.errors + (isError && !isDenied ? 1 : 0),
              denies: c.denies + (isDenied ? 1 : 0),
              // a recovery is the same tool succeeding after its own failure
              recoveries: c.recoveries + (!isError && hadFailed ? 1 : 0),
              failedTools:
                isError && !isDenied ? [...new Set([...c.failedTools, tool])] : !isError ? c.failedTools.filter(t => t !== tool) : c.failedTools,
              commits: c.commits + (isCommitted ? 1 : 0),
              testPasses: c.testPasses + (isTested ? 1 : 0),
              subagents: c.subagents + (!isError && SUBAGENT_TOOLS.has(tool) ? 1 : 0),
              maxParallel: Math.max(c.maxParallel, peak),
            },
          }
        },
      })
    } catch {}

    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // a subagent's turn is part of the main turn
    if (e.agentId !== undefined) return result
    try {
      const usage = e.usage ?? result.usage
      // an interrupted or empty turn earns nothing (but is still counted as interrupted)
      const isCounted = !e.isAborted && usage !== undefined
      const eaten = usage?.output_tokens ?? 0
      later({ kind: 'turn', isCounted, isAborted: e.isAborted, eaten, durationMs: e.durationMs })
    } catch {}

    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // a pane already open when the module reloaded is open too: drawing it says so
    if (!(await read($, paneOpen))) void update($, paneOpen, () => true).catch(() => {})
    const save = await shownSave($)
    if (save === null) return <Text dimColor>Loading…</Text>
    const now = await $.clock.now()
    const { pet, settings } = save
    const stage = stageIndex(pet.xp)
    const goal = nextStageXp(pet.xp)
    const from = STAGES[stage]!.xp
    const isPreview = (await read($, preview)) !== null
    const tick = await read($, frame)
    const shown = await read($, tab)
    const said = await read($, speech)
    const told = await read($, notice)
    const isUnreadable = await read($, unreadable)
    const width = Math.max(20, e.props.bodyColumns - 4)
    const rule = <Text dimColor>{'─'.repeat(width)}</Text>
    const gauge = (value: number, cells = 5) => {
      const full = Math.round((clamp(value) / 100) * cells)
      return '■'.repeat(full) + '□'.repeat(cells - full)
    }
    const growth = goal === null ? 100 : ((pet.xp - from) / (goal - from)) * 100
    const born = new Date(pet.bornAt)

    const picture =
      e.surface === 'terminal'
        ? (() => {
            const { Raster } = $.ui.resolve(e)
            return <Raster key="pet-pane" {...toCells(compose(pet.species, stageOf(pet.xp).id, moodOf(pet, now), tick))} />
          })()
        : <Text bold color="yellow">{drawPet(pet, now, tick)}</Text>

    const stat = (label: string, value: number, color: string, tail = '') => (
      <Box flexDirection="row" gap={1} width={Math.floor(width / 2)}>
        <Box flexShrink={0} width={8}>
          <Text dimColor>{label}</Text>
        </Box>
        <Box flexShrink={0}>
          <Text color={color}>{gauge(value)}</Text>
        </Box>
        {tail !== '' && (
          <Box flexShrink={1} minWidth={0}>
            <Text dimColor wrap="truncate-end">
              {tail}
            </Text>
          </Box>
        )}
      </Box>
    )
    const isEgg = stage === 0 || pet.species === null
    // the newer of the pet's words and the mod's own message; neither, how the pet seems
    const fresh = (m: { at: number } | null) => m !== null && now - m.at < SPEECH_MS
    const nowLine =
      fresh(told) && (!fresh(said) || told!.at >= said!.at)
        ? told!.text
        : fresh(said)
          ? `「${said!.text}」`
          : describe(save, now)

    const today = localDay(now)
    const diary = save.diary.filter(d => localDay(d.at) === today).slice(-DIARY_ROWS).reverse()

    const home = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          <Box flexShrink={0}>{picture}</Box>
          <Box flexDirection="column">
            <Text>{`年齢   ${ageDays(save, now)}日目`}</Text>
            <Text>{`誕生日 ${born.getMonth() + 1}/${born.getDate()}`}</Text>
            <Text>{goal === null ? `XP     ${pet.xp}` : `XP     ${pet.xp} / ${goal}`}</Text>
            <Text dimColor>{`実績   ${Object.keys(save.unlocked).length}/${ACHIEVEMENTS.length}`}</Text>
          </Box>
        </Box>
        {rule}
        <Box flexDirection="row">
          {stat('おなか', currentFullness(pet, now), 'yellow')}
          {stat('きげん', pet.mood, 'red')}
        </Box>
        <Box flexDirection="row">
          {stat('なかよし', pet.affection, 'magenta')}
          {stat('成長', growth, 'green', goal === null ? 'MAX' : `→${STAGES[stage + 1]!.label}`)}
        </Box>
        <Box flexDirection="row" columnGap={1}>
          {(Object.keys(CARE) as CareKind[]).map((kind, i) => {
            const left = careLeft(save, kind, now)
            const isOpen = !isPreview && !(isEgg && kind !== 'pat') && left > 0
            return (
              <Button
                key={`care-${kind}`}
                hotkey={String(i + 1)}
                dimColor={!isOpen}
                onPress={() => {
                  if (isPreview) void tell($, 'プレビュー中はお世話できません（/pet preview off で戻る）').catch(() => {})
                  else void serial({ kind: 'care', care: kind }, $).catch(() => {})
                }}
              >
                {isEgg && kind !== 'pat' ? `${CARE[kind].label} -` : `${CARE[kind].label} ${left}/${CARE[kind].perDay}`}
              </Button>
            )
          })}
        </Box>
        {rule}
        <Text wrap="truncate-end">{`いま: ${nowLine}`}</Text>
        <Text dimColor>きょうのできごと</Text>
        {diary.length === 0 && <Text dimColor>{'  まだなにもない'}</Text>}
        {diary.map((d, i) => (
          <Box key={`diary-${i}`} flexDirection="row" gap={1}>
            <Box flexShrink={0} width={7}>
              <Text dimColor>{`  ${new Date(d.at).toTimeString().slice(0, 5)}`}</Text>
            </Box>
            <Text wrap="truncate-end">{d.text}</Text>
          </Box>
        ))}
        {Array.from({ length: Math.max(0, DIARY_ROWS - Math.max(1, diary.length)) }, (_, i) => (
          <Box key={`diary-pad-${i}`}>
            <Text>{' '}</Text>
          </Box>
        ))}
      </Box>
    )

    const achievements = (
      <Box flexDirection="column">
        <Text bold>{`実績 ${Object.keys(save.unlocked).length}/${ACHIEVEMENTS.length}`}</Text>
        {ACHIEVEMENTS.map(a => {
          const when = save.unlocked[a.id]
          return (
            <Box key={`ach-${a.id}`} flexDirection="row" gap={1}>
              <Box flexShrink={0} width={2}>
                <Text color={when ? 'green' : undefined} dimColor={!when}>
                  {when ? '✓' : '－'}
                </Text>
              </Box>
              <Box flexShrink={0} width={18}>
                <Text bold={!!when} dimColor={!when} wrap="truncate-end">
                  {a.title}
                </Text>
              </Box>
              <Box flexShrink={0} width={7} justifyContent="flex-end">
                <Text dimColor>{`+${a.xp}XP`}</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text dimColor wrap="truncate-end">
                  {when ? `${a.hint}（${new Date(when).toLocaleDateString()}）` : '？？？'}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    const abilities = (
      <Box flexDirection="column">
        <Text bold>できること</Text>
        {ABILITIES.map(ab => {
          const isOpen = hasAbility(save, ab.id)
          const needs = STAGES.find(st => st.id === ab.stage)!
          return (
            <Box key={`ability-${ab.id}`} flexDirection="row" gap={1}>
              <Box flexShrink={0} width={2}>
                <Text color={isOpen ? 'green' : undefined} dimColor={!isOpen}>
                  {isOpen ? '✓' : '－'}
                </Text>
              </Box>
              <Box flexShrink={0} width={18}>
                <Text bold={isOpen} dimColor={!isOpen} wrap="truncate-end">
                  {ab.title}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Text dimColor wrap="truncate-end">
                  {isOpen ? ab.detail : `${needs.label}になると解禁`}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    const c = save.counters
    const toolTotal = Object.values(c.tools).reduce((a, b) => a + b, 0)
    const settingsTab = (
      <Box flexDirection="column">
        <Text bold>せってい</Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button
            key="toggle-sound"
            hotkey="s"
            dimColor={!settings.sound}
            onPress={() => void edit($, s => ({ ...s, settings: { ...s.settings, sound: !s.settings.sound } })).catch(() => {})}
          >
            {`効果音 ${settings.sound ? 'ON' : 'OFF'}`}
          </Button>
          <Button
            key="toggle-chatter"
            hotkey="a"
            dimColor={!settings.chatter}
            onPress={() => void edit($, s => ({ ...s, settings: { ...s.settings, chatter: !s.settings.chatter } })).catch(() => {})}
          >
            {`AIおしゃべり ${settings.chatter ? 'ON' : 'OFF'}`}
          </Button>
        </Box>
        <Text dimColor>{'名前を変える: /pet name <名前>  種族を変える: /pet switch <種族>'}</Text>
        <Text dimColor>{'くわしくは /pet help'}</Text>
        <Box marginTop={1}>
          <Text dimColor wrap="wrap">
            {`きろく: ${c.turns}ターン ・ ツール${toolTotal}回 ・ コミット${c.commits}回 ・ 累計$${c.costUsd.toFixed(2)} ・ ${c.streakDays}日連続`}
          </Text>
        </Box>
      </Box>
    )

    const TABS: { id: PaneTab; label: string }[] = [
      { id: 'home', label: 'ホーム' },
      { id: 'achievements', label: '実績' },
      { id: 'abilities', label: 'できること' },
      { id: 'settings', label: 'せってい' },
    ]


    return (
      <Box flexDirection="column">
        {isPreview && <Text color="magenta">{'[プレビュー中] /pet preview off で戻る'}</Text>}
        {isUnreadable && <Text color="red">{'[保存データを読めないため、変更を保存していません。新しいバージョンのペットで保存された可能性があります]'}</Text>}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {TABS.map((t, i) => (
            <Button
              key={`tab-${t.id}`}
              hotkey={String(i + 4)}
              variant={shown === t.id ? 'primary' : undefined}
              dimColor={shown !== t.id}
              onPress={() => void update($, tab, () => t.id)}
            >
              {t.label}
            </Button>
          ))}
        </Box>
        <Box key="screen" flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{pet.name}</Text>
            <Text dimColor>{`${pet.species === null ? '？？？' : SPECIES[pet.species].label}・${STAGES[stage]!.label}`}</Text>
          </Box>
          <Box key="content" flexDirection="column" height={contentRows(e.surface)} overflow="hidden">
            {shown === 'home' && home}
            {shown === 'achievements' && achievements}
            {shown === 'abilities' && abilities}
            {shown === 'settings' && settingsTab}
          </Box>
        </Box>
      </Box>
    )
  })
}
