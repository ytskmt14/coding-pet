import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { freshSave } from './pet'

const PANE_PROPS = {
  title: 'Pet',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

// The world beneath the plugin: what it says, plays and asks the model, recorded.
// The world of the running test, so the helpers can let its queued jobs run.
let current: { settle: () => Promise<void> } = { settle: async () => {} }
// Runs what the hooks queued: their jobs wait on a timer of the mocked clock.
const settle = () => current.settle()

const world = (on: On, store: Record<string, unknown> = {}, now = new Date(2026, 9, 5, 12, 0, 0).getTime()) => {
  const seen = { toasts: [] as string[], sounds: [] as string[], prompts: [] as string[], store: { ...store }, usd: 0, statuses: [] as (string | null)[], opens: [] as { rows?: number; focus?: true }[], failSets: 0 }
  on('session.usage', () => ({ value: { cost: { usd: seen.usd } } as never }))
  on('store.get', ($, e) => ({ value: seen.store[e.key] }))
  on('store.set', ($, e) => {
    if (seen.failSets > 0) {
      seen.failSets -= 1
      throw new Error('disk full')
    }
    seen.store[e.key] = JSON.parse(JSON.stringify(e.value))
    return { value: undefined }
  })
  // noon, local time by default: no night-owl unlock from the hour the tests happen to run
  const clock = mock.clock(on, { now })
  current = { settle: () => clock.settle() }
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', () => ({ cwd: '/' }))
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    seen.statuses.push(e.text ?? null)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    seen.opens.push({ rows: e.rows, focus: e.focus })
    return { value: { isPlaced: true } }
  })
  on('audio.play', ($, e) => {
    seen.sounds.push(e.clip.asset ?? '?')
    return { value: undefined }
  })
  on('model.complete', ($, e) => {
    seen.prompts.push(e.prompt)
    return { value: { isAnswered: true, text: 'がんばれ〜', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('turn.complete', () => ({ text: 'done' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  // Write is denied; reading /bad fails; everything else works
  on('tool.call', ($, e) =>
    e.tool === 'Write' ? { deny: 'no' } : e.tool === 'Read' && e.file_path === '/bad' ? { result: {} as never, isError: true } : { result: {} as never },
  )
  return seen
}

const start = async ($: Engine) => {
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle()
}

const turn = async ($: Engine, turnId: string, outputTokens = 500) => {
  await $.turn.complete({
    turnId,
    answer: 'ok',
    durationMs: 1000,
    isAborted: false,
    reason: 'answer',
    usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  })
  await settle()
}

const mountPane = ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({ plugin: 'coding-pet', surface, component: 'Pane', requestId: 'pet', props: PANE_PROPS })

// The pane's texts, read from a mount that is let go again (one mount per pane at a time).
const paneTexts = async ($: Engine, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await mountPane($, surface)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  await ui.unmount()
  return texts
}

// the mocked clock's time (noon, local): saves made for a test start from it, not the wall clock
const NOON = new Date(2026, 9, 5, 12, 0, 0).getTime()

const savedOf = (store: unknown) => store as ReturnType<typeof freshSave>

test('an egg shows in the pane and the first turn unlocks an achievement', async ($, on) => {
  const seen = world(on)
  await start($)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(texts).toEqual(expect.arrayContaining(['たま', '？？？・卵', 'XP     0 / 30', '年齢   1日目']))
    // the terminal draws the 16x16 sprite; other surfaces the face as text
    if (surface === 'terminal') expect((await ui.find({ type: 'Raster' }))?.props).toEqual(expect.objectContaining({ columns: 16, rows: 9 }))
    else expect(texts.some(t => t.includes('(  )'))).toBe(true)
    await ui.unmount()
  }

  await turn($, 't1')
  expect(seen.toasts).toContain('🏆 実績解除: 初めの一歩 (+10 XP)')
  // an egg has no sound yet
  expect(seen.sounds).toEqual([])
  expect(await paneTexts($)).toEqual(expect.arrayContaining(['XP     11 / 30', '実績「初めの一歩」を解除した']))
})

test('enough XP hatches the egg into a species and plays nothing until adult', async ($, on) => {
  const save = freshSave(NOON)
  const seen = world(on, { save: { ...save, pet: { ...save.pet, xp: 25 } } })
  await start($)

  // a commit (+20) crosses 30
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' } as never)
  await settle()
  expect(seen.toasts).toEqual(expect.arrayContaining(['🏆 実績解除: 初コミット (+20 XP)', expect.stringMatching(/^🐣 卵がかえった！ .+のたまが生まれた$/)]))
  expect(seen.sounds).toEqual([])

  const texts = await paneTexts($)
  expect(texts).toEqual(expect.arrayContaining([expect.stringMatching(/・赤ちゃん$/), expect.stringMatching(/^卵がかえって.+が生まれた$/)]))
})

test('an adult pet plays the fanfare; a denied tool and an error are counted', async ($, on) => {
  const save = freshSave(NOON)
  const seen = world(on, { save: { ...save, pet: { ...save.pet, xp: 260, species: 'slime' } } })
  await start($)

  await $.tool.call({ tool: 'Write', file_path: '/x', content: '' } as never)
  await settle()
  expect(seen.toasts).toContain('🏆 実績解除: 叱られた (+10 XP)')
  expect(seen.sounds).toEqual(['sounds/fanfare.wav'])

  await $.tool.call({ tool: 'Read', file_path: '/bad' } as never)
  await settle()
  const c = savedOf(seen.store.save).counters
  expect([c.denies, c.errors]).toEqual([1, 1])
})

test('a final-stage pet chats through the model with counts only, at most once a minute', async ($, on) => {
  const save = freshSave(NOON)
  const seen = world(on, { save: { ...save, pet: { ...save.pet, xp: 600, species: 'dragon', name: 'ポチ' } } })
  await start($)

  await turn($, 't1')
  await turn($, 't2')
  expect(seen.prompts).toHaveLength(1)
  expect(seen.prompts[0]).toMatch(/ドラゴンのペット「ポチ」/)
  expect(seen.prompts[0]).not.toMatch(/git|\/x|commit -m/)

  expect(await paneTexts($)).toContain('いま: 「がんばれ〜」')
})

test('/pet commands rename, toggle settings and open the pane', async ($, on) => {
  world(on)
  await start($)

  const run = (args: string) => $.command.run({ command: 'pet', args, origin: 'user' } as never)
  expect(await run('name ミケ')).toEqual(expect.objectContaining({ text: 'ペットの名前を「ミケ」にしました。' }))
  expect(await run('sound off')).toEqual(expect.objectContaining({ text: '効果音をオフにしました。' }))
  expect(await run('hide')).toEqual(expect.objectContaining({ text: '「hide」は知らないコマンドです。/pet help で使い方を見られます。' }))
  expect(await run('???')).toEqual(expect.objectContaining({ text: '「???」は知らないコマンドです。/pet help で使い方を見られます。' }))

  const pane = await mountPane($)
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(expect.arrayContaining(['ミケ', '？？？・卵', '実績   0/17']))

  await pane.press({ key: 'tab-settings' })
  expect((await pane.find({ key: 'toggle-sound' }))?.text).toBe('効果音 OFF')
  await pane.press({ key: 'toggle-sound' })
  expect((await pane.find({ key: 'toggle-sound' }))?.text).toBe('効果音 ON')
})

test('thanks in a prompt lifts the mood without keeping the text', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.prompt.submit({ text: 'いつもありがとう', wait: false, origin: { kind: 'composer' } } as never)
  await settle()
  const saved = savedOf(seen.store.save)
  expect(saved.counters.thanks).toBe(1)
  expect(saved.pet.mood).toBe(70)
  expect(JSON.stringify(saved)).not.toContain('いつも')
})

test('a locked achievement shows its title but hides how to earn it', async ($, on) => {
  world(on)
  await start($)
  await turn($, 't1')

  const pane = await mountPane($)
  await pane.press({ key: 'tab-achievements' })
  const unlocked = (await pane.find({ key: 'ach-first-step' }))?.text ?? ''
  const locked = (await pane.find({ key: 'ach-night-owl' }))?.text ?? ''
  expect(unlocked).toMatch(/✓初めの一歩\+10XP1ターン終える（.+）/)
  expect(locked).toMatch(/－夜更かし\+15XP？？？/)
  expect(locked).not.toContain('深夜')
})

test('/pet preview shows a stage and its abilities without touching the save', async ($, on) => {
  const seen = world(on)
  await start($)
  const run = (args: string) => $.command.run({ command: 'pet', args, origin: 'user' } as never)
  const savedXp = () => savedOf(seen.store.save).pet.xp

  const xpBefore = savedXp()
  const reply = await run('preview final')
  await settle()
  expect(reply).toEqual(expect.objectContaining({ text: expect.stringMatching(/^猫の完全体をプレビュー中.*AIおしゃべり/) }))
  expect(seen.sounds).toEqual(['sounds/levelup.wav'])
  expect(seen.prompts).toHaveLength(1)

  const pane = await $.ui.mount({ plugin: 'coding-pet', surface: 'terminal', component: 'Pane', requestId: 'pet', props: PANE_PROPS })
  const texts = (await pane.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(expect.arrayContaining(['[プレビュー中] /pet preview off で戻る', '猫・完全体']))
  expect((await pane.find({ type: 'Raster' }))?.props).toEqual(expect.objectContaining({ columns: 16, rows: 9 }))
  expect(savedXp()).toBe(xpBefore)
  await pane.unmount()

  // a child has no sound yet
  await run('preview child')
  expect(seen.sounds).toHaveLength(1)

  await run('preview off')
  expect(await paneTexts($)).toContain('？？？・卵')
  expect(await run('preview nope')).toEqual(expect.objectContaining({ text: expect.stringMatching(/^使い方: \/pet preview/) }))
})

test('/pet preview takes a species too, in either order, or alone', async ($, on) => {
  world(on)
  await start($)
  const run = (args: string) => $.command.run({ command: 'pet', args, origin: 'user' } as never)
  const pane = async () => {
    const ui = await $.ui.mount({ plugin: 'coding-pet', surface: 'terminal', component: 'Pane', requestId: 'pet', props: PANE_PROPS })
    return (await ui.findAll({ type: 'Text' })).map(t => t.text)
  }

  expect(await run('preview adult dragon')).toEqual(expect.objectContaining({ text: expect.stringMatching(/^ドラゴンの大人をプレビュー中/) }))
  expect(await pane()).toContain('ドラゴン・大人')

  expect(await run('preview スライム 完全体')).toEqual(expect.objectContaining({ text: expect.stringMatching(/^スライムの完全体/) }))
  // a species alone keeps the stage
  expect(await run('preview ghost')).toEqual(expect.objectContaining({ text: expect.stringMatching(/^おばけの完全体/) }))
  // a stage alone keeps the species
  expect(await run('preview child')).toEqual(expect.objectContaining({ text: expect.stringMatching(/^おばけの子ども/) }))

  await run('preview off')
  // from an egg, a species alone shows the hatched baby
  expect(await run('preview bird')).toEqual(expect.objectContaining({ text: expect.stringMatching(/^鳥の赤ちゃん/) }))
  expect(await run('preview adult unicorn')).toEqual(expect.objectContaining({ text: expect.stringMatching(/^使い方/) }))
})

test('/pet help lists the commands, stages and abilities, and keeps the achievement conditions secret', async ($, on) => {
  world(on)
  await start($)
  const reply = (await $.command.run({ command: 'pet', args: 'help', origin: 'user' } as never)) as { text: string }

  for (const command of ['/pet name', '/pet sound', '/pet chatter', '/pet switch', '/pet preview', '/pet help']) expect(reply.text).toContain(command)
  expect(reply.text).not.toContain('/pet hide')
  expect(reply.text).toMatch(/ごはん: 1日3回まで/)
  expect(reply.text).toMatch(/大人.*250XP〜.*効果音が使えるようになる/)
  expect(reply.text).toMatch(/完全体.*500XP〜.*AIおしゃべりが使えるようになる/)
  expect(reply.text).toContain('全17個')
  // no condition of any achievement appears
  for (const hint of ['深夜0〜4時に起動する', 'ツールを止められる', '3日続けて使う']) expect(reply.text).not.toContain(hint)
})

test('a session started between 0 and 4 o\'clock unlocks the night owl', async ($, on) => {
  const seen = world(on, {}, new Date(2026, 9, 6, 2, 30, 0).getTime())
  await start($)
  expect(seen.toasts).toContain('🏆 実績解除: 夜更かし (+15 XP)')
})

test('/pet switch changes only the species; an egg hatches as the one chosen', async ($, on) => {
  const save = freshSave(NOON)
  const grown = { ...save, pet: { ...save.pet, xp: 260, species: 'cat' as const, name: 'ミケ', mood: 80 }, unlocked: { 'first-step': 'x' } }
  const seen = world(on, { save: grown })
  await start($)
  const run = (args: string) => $.command.run({ command: 'pet', args, origin: 'user' } as never)

  await run('preview final bird')
  expect(await run('switch dragon')).toEqual(expect.objectContaining({ text: 'ミケがドラゴンになりました（大人・XP 260のまま）。' }))
  const after = savedOf(seen.store.save)
  expect(after.pet).toEqual(expect.objectContaining({ species: 'dragon', xp: 260, name: 'ミケ', mood: 80 }))
  expect(after.unlocked).toEqual(grown.unlocked)

  // the preview ended, so the pane shows the switched pet as it is
  const texts = await paneTexts($)
  expect(texts).toContain('ドラゴン・大人')
  expect(texts).not.toContain('[プレビュー中] /pet preview off で戻る')

  expect(await run('switch ドラゴン')).toEqual(expect.objectContaining({ text: 'ミケはもうドラゴンです。' }))
  expect(await run('switch unicorn')).toEqual(expect.objectContaining({ text: expect.stringMatching(/^使い方: \/pet switch/) }))
})

test('an egg told its species hatches as that species', async ($, on) => {
  const save = freshSave(NOON)
  const seen = world(on, { save: { ...save, pet: { ...save.pet, xp: 25 } } })
  await start($)
  const run = (args: string) => $.command.run({ command: 'pet', args, origin: 'user' } as never)

  expect(await run('switch おばけ')).toEqual(expect.objectContaining({ text: '卵がかえるとおばけが生まれます。' }))
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' } as never)
  await settle()
  expect(seen.toasts).toContain('🐣 卵がかえった！ おばけのたまが生まれた')
})

test('a tool call returns before the pet reacts to it', async ($, on) => {
  const seen = world(on)
  await start($)
  await turn($, 't0')
  seen.toasts.length = 0

  await $.tool.call({ tool: 'Bash', command: 'git commit -m "x"' } as never)
  // the result is back; the reaction waits for the session's runner
  expect(seen.toasts).toEqual([])
  await settle()
  expect(seen.toasts).toContain('🏆 実績解除: 初コミット (+20 XP)')
})

test('a save another session wrote in between is kept, not overwritten', async ($, on) => {
  const seen = world(on)
  await start($)
  // another session earns 40 XP and an achievement meanwhile
  const other = savedOf(seen.store.save)
  seen.store.save = { ...other, pet: { ...other.pet, xp: 40 }, unlocked: { ...other.unlocked, 'night-owl': 'x' } }

  await turn($, 't1')
  const saved = savedOf(seen.store.save)
  expect(saved.unlocked['night-owl']).toBe('x')
  // its 40, the first step's 10, the turn's 1
  expect(saved.pet.xp).toBe(51)
})

test('only calls that ran count; a recovery is the same tool working after its own failure', async ($, on) => {
  const seen = world(on)
  await start($)

  await $.tool.call({ tool: 'Write', file_path: '/x', content: '' } as never)
  await settle()
  await $.tool.call({ tool: 'Read', file_path: '/bad' } as never)
  await settle()
  // another tool working is no recovery
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await settle()
  let c = savedOf(seen.store.save).counters
  expect(c.tools).toEqual({ Bash: 1 })
  expect([c.denies, c.errors, c.recoveries]).toEqual([1, 1, 0])

  await $.tool.call({ tool: 'Read', file_path: '/ok' } as never)
  await settle()
  c = savedOf(seen.store.save).counters
  expect([c.recoveries, c.failedTools]).toEqual([1, []])
})

test('an interrupted turn earns no XP and no turn', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.turn.complete({ turnId: 'a', answer: '', durationMs: 10, isAborted: true, reason: 'aborted' } as never)
  await settle()
  const saved = savedOf(seen.store.save)
  expect([saved.pet.xp, saved.counters.turns, saved.counters.aborted]).toEqual([0, 0, 1])
})

test('spend comes from the session usage, counted once across a resume', async ($, on) => {
  const seen = world(on)
  // a resumed session that had already spent $0.50
  seen.usd = 0.5
  await start($)
  seen.usd = 1.25
  await turn($, 't1')
  const c = savedOf(seen.store.save).counters
  expect(c.maxSessionCostUsd).toBe(1.25)
  expect(Math.abs(c.costUsd - 0.75) < 1e-9).toBe(true)
  expect(seen.toasts).toContain('🏆 実績解除: 太っ腹 (+20 XP)')
})

test('ending a preview gives back the real status line', async ($, on) => {
  const save = freshSave(NOON)
  const seen = world(on, { save: { ...save, pet: { ...save.pet, xp: 120, species: 'cat' }, counters: { ...save.counters, maxSessionCostUsd: 0.3 } } })
  seen.usd = 0.3
  await start($)
  const run = (args: string) => $.command.run({ command: 'pet', args, origin: { kind: 'composer' } } as never)

  await run('preview hatchling')
  await run('preview off')
  expect(seen.statuses.at(-1)).toBe('🍫 うまい棒3本分')
})

test('a non-interactive session is not counted', async ($, on) => {
  const seen = world(on)
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await settle()
  expect(seen.store.save).toBeUndefined()
})

test('care: an egg can only be warmed; a pet is fed up to three times a day', async ($, on) => {
  const save = freshSave(NOON)
  const seen = world(on, { save: { ...save, pet: { ...save.pet, fullness: 10 } } })
  await start($)
  const pane = await mountPane($)
  const texts = async () => (await pane.findAll({ type: 'Text' })).map(t => t.text)

  await pane.press({ key: 'care-feed' })
  await settle()
  expect(await texts()).toContain('いま: まだ卵です。なでてあたためてあげよう')
  await pane.press({ key: 'care-pat' })
  await settle()
  expect(savedOf(seen.store.save).pet.affection).toBe(2)
  expect(await texts()).toContain('卵をあたためてもらった')

  // hatched: feed three times, then no more today
  const now = savedOf(seen.store.save)
  seen.store.save = { ...now, pet: { ...now.pet, xp: 40, species: 'cat' } }
  for (let i = 0; i < 3; i++) {
    await pane.press({ key: 'care-feed' })
    await settle()
  }
  const fed = savedOf(seen.store.save)
  expect(fed.care.feed).toBe(3)
  expect(fed.pet.fullness).toBeGreaterThan(90)
  expect((await pane.find({ key: 'care-feed' }))?.text).toBe('ごはん 0/3')
  // the fourth is refused for the day's limit (not for a full stomach)
  const full = savedOf(seen.store.save)
  seen.store.save = { ...full, pet: { ...full.pet, fullness: 10, lastFedAt: NOON } }
  await pane.press({ key: 'care-feed' })
  await settle()
  expect(savedOf(seen.store.save).care.feed).toBe(3)
  expect(await texts()).toContain('いま: きょうのごはんはもうおしまい。また明日')
})

test('the diary keeps canned words for what happened, never the command', async ($, on) => {
  const seen = world(on)
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "secret plan"' } as never)
  await settle()
  await $.tool.call({ tool: 'Write', file_path: '/x', content: '' } as never)
  await settle()

  const diary = savedOf(seen.store.save).diary.map(d => d.text)
  expect(diary).toEqual(expect.arrayContaining(['あいにきてくれた', 'コミットしてよろこんだ', '実績「初コミット」を解除した', 'ツールを止められてびっくりした']))
  expect(JSON.stringify(savedOf(seen.store.save))).not.toContain('secret plan')
  expect(await paneTexts($)).toContain('ツールを止められてびっくりした')
})

test('the tabs sit on top and every tab has the same height', async ($, on) => {
  world(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await mountPane($, surface)
    const tree = JSON.stringify(await ui.drawn())
    // the tab row comes before the screen
    expect(tree.indexOf('"tab-home"')).toBeLessThan(tree.indexOf('"screen"'))
    const heights = new Set<unknown>()
    for (const t of ['home', 'achievements', 'abilities', 'settings']) {
      await ui.press({ key: `tab-${t}` })
      heights.add((await ui.find({ key: 'content' }))?.props.height)
    }
    expect(heights.size).toBe(1)
    await ui.unmount()
  }
})

test('a save of an unknown version is never written over, and the pane says so', async ($, on) => {
  const newer = { version: 2, pet: { name: 'ぽち', xp: 400 } }
  const seen = world(on, { save: newer })
  await start($)
  await turn($, 't1')
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
  await settle()
  expect(seen.store.save).toEqual(newer)
  expect(await paneTexts($)).toContain('[保存データを読めないため、変更を保存していません。新しいバージョンのペットで保存された可能性があります]')
})

test('a failed write is neither shown nor celebrated, and the next one is celebrated once', async ($, on) => {
  const seen = world(on)
  await start($)
  seen.failSets = 1
  await turn($, 't1')
  expect(seen.toasts).toEqual([])
  expect(savedOf(seen.store.save).counters.turns).toBe(0)
  await turn($, 't2')
  expect(seen.toasts.filter(t => t.includes('初めの一歩'))).toHaveLength(1)
  expect(savedOf(seen.store.save).counters.turns).toBe(1)
})

test('/pet reads the store again and opens the pane tall and focused', async ($, on) => {
  const seen = world(on)
  await start($)
  const other = savedOf(seen.store.save)
  seen.store.save = { ...other, pet: { ...other.pet, xp: 120, species: 'cat' } }

  expect(await $.command.run({ command: 'pet', args: '', origin: { kind: 'composer' } } as never)).toEqual(
    expect.objectContaining({ text: expect.stringMatching(/^ペットのペインを開きました/) }),
  )
  expect(seen.opens.at(-1)).toEqual({ rows: 27, focus: true })
  expect(await paneTexts($)).toEqual(expect.arrayContaining(['猫・子ども', 'XP     120 / 250']))
})

test('the snack line counts this session only, not the most any session spent', async ($, on) => {
  const save = freshSave(NOON)
  const seen = world(on, { save: { ...save, pet: { ...save.pet, xp: 120, species: 'cat' }, counters: { ...save.counters, maxSessionCostUsd: 5 } } })
  seen.usd = 0.3
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await settle()
  expect(seen.statuses.at(-1)).toBe('🍫 うまい棒3本分')
})

test('an egg offers only patting; a preview offers no care and says why', async ($, on) => {
  world(on)
  await start($)
  const pane = await mountPane($)
  expect((await pane.find({ key: 'care-feed' }))?.text).toBe('ごはん -')
  expect((await pane.find({ key: 'care-pat' }))?.text).toBe('なでる 5/5')
  await pane.unmount()

  await $.command.run({ command: 'pet', args: 'preview child', origin: { kind: 'composer' } } as never)
  const previewing = await mountPane($)
  await previewing.press({ key: 'care-pat' })
  await settle()
  expect((await previewing.findAll({ type: 'Text' })).map(t => t.text)).toContain('いま: プレビュー中はお世話できません（/pet preview off で戻る）')
})

test('every error goes in the diary, and the diary pads below its entries', async ($, on) => {
  const seen = world(on)
  await start($)
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Read', file_path: '/bad' } as never)
    await settle()
  }
  const diary = savedOf(seen.store.save).diary.map(d => d.text)
  expect(diary.filter(t => t === 'エラーでしょんぼりした')).toHaveLength(3)

  // two lines today, three rows of padding
  const two = savedOf(seen.store.save)
  seen.store.save = { ...two, diary: two.diary.slice(-2) }
  await $.command.run({ command: 'pet', args: '', origin: { kind: 'composer' } } as never)
  const tree = JSON.stringify(await (await mountPane($)).drawn())
  // entries come right after the heading, the padding after them
  expect(tree.indexOf('diary-0')).toBeLessThan(tree.indexOf('diary-pad-0'))
})

test('work queued before the session started runs once it starts', async ($, on) => {
  const seen = world(on)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
  await start($)
  expect(savedOf(seen.store.save).counters.commits).toBe(1)
})

test('a narrow pane still shows the care buttons', async ($, on) => {
  const save = freshSave(NOON)
  world(on, { save: { ...save, pet: { ...save.pet, xp: 40, species: 'cat' } } })
  await start($)
  const ui = await $.ui.mount({ plugin: 'coding-pet', surface: 'terminal', component: 'Pane', requestId: 'pet', props: { ...PANE_PROPS, bodyColumns: 40 } })
  for (const kind of ['feed', 'pat', 'play']) expect(await ui.find({ key: `care-${kind}` })).toBeDefined()
  // the care row comes before the diary, so a wrapped line clips the diary first
  const tree = JSON.stringify(await ui.drawn())
  expect(tree.indexOf('"care-play"')).toBeLessThan(tree.indexOf('きょうのできごと'))
})

test("yesterday's diary is not today's", async ($, on) => {
  const save = freshSave(NOON)
  world(on, { save: { ...save, diary: [{ at: NOON - 86_400_000, text: 'きのうのこと' }] } })
  await start($)
  const texts = await paneTexts($)
  expect(texts).not.toContain('きのうのこと')
  expect(texts).toContain('あいにきてくれた')
})
