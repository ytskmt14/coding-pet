import { expect, test } from 'claude-code/testing'

import { ACHIEVEMENTS, newlyEarned } from './achievements'
import { afterMeal, ageDays, careLeft, cleanName, giveCare, isReadable, currentFullness, rollDay, drawPet, freshCounters, freshSave, hasAbility, loadSave, moodOf, nextStageXp, snacks, stageOf } from './pet'

const NOW = Date.parse('2026-10-05T12:00:00Z')

test('stages follow XP', () => {
  expect(stageOf(0).id).toBe('egg')
  expect(stageOf(29).id).toBe('egg')
  expect(stageOf(30).id).toBe('hatchling')
  expect(stageOf(100).id).toBe('child')
  expect(stageOf(250).id).toBe('adult')
  expect(stageOf(9999).id).toBe('final')
  expect(nextStageXp(120)).toBe(250)
  expect(nextStageXp(500)).toBeNull()
})

test('abilities open with the stage', () => {
  const at = (xp: number) => {
    const s = freshSave(NOW)
    return { ...s, pet: { ...s.pet, xp } }
  }
  expect(hasAbility(at(0), 'care')).toBe(true)
  expect(hasAbility(at(0), 'speech')).toBe(false)
  expect(hasAbility(at(30), 'speech')).toBe(true)
  expect(hasAbility(at(249), 'sound')).toBe(false)
  expect(hasAbility(at(250), 'sound')).toBe(true)
  expect(hasAbility(at(499), 'chatter')).toBe(false)
  expect(hasAbility(at(500), 'chatter')).toBe(true)
})

test('fullness drops with time and hunger shows on the face', () => {
  const pet = { ...freshSave(NOW).pet, species: 'cat' as const, xp: 30, fullness: 40, lastFedAt: NOW }
  expect(currentFullness(pet, NOW)).toBe(40)
  expect(currentFullness(pet, NOW + 100 * 60 * 1000)).toBe(30)
  expect(moodOf(pet, NOW + 200 * 60 * 1000)).toBe('hungry')
  expect(moodOf({ ...pet, mood: 90 }, NOW)).toBe('happy')
  expect(moodOf({ ...pet, mood: 10 }, NOW)).toBe('sad')
  expect(drawPet({ ...pet, mood: 90 }, NOW, 0)).toBe('(=^･ω･^=)')
  expect(drawPet({ ...pet, xp: 0, species: null }, NOW, 0)).toBe('(  )')
  expect(drawPet({ ...pet, xp: 500, mood: 90 }, NOW, 0)).toBe('+(=^･ω･^=)+')
})

test('achievements are earned once each', () => {
  const counters = { ...freshCounters(), turns: 1, commits: 1, tools: { Bash: 100 } }
  const earned = newlyEarned(counters, {}).map(a => a.id)
  expect(earned).toEqual(['first-step', 'bash-master', 'first-commit'])
  expect(newlyEarned(counters, { 'first-step': 'x', 'bash-master': 'x', 'first-commit': 'x' })).toEqual([])
  // every achievement has a distinct id
  expect(new Set(ACHIEVEMENTS.map(a => a.id)).size).toBe(ACHIEVEMENTS.length)
})

test('a save of another shape starts fresh; a known one keeps its values', () => {
  expect(loadSave(undefined, NOW).pet.xp).toBe(0)
  expect(loadSave({ version: 99 }, NOW).pet.xp).toBe(0)
  const old = { ...freshSave(NOW), counters: { turns: 5 } }
  const loaded = loadSave(old, NOW)
  expect(loaded.counters.turns).toBe(5)
  expect(loaded.counters.commits).toBe(0)
  expect(snacks(1)).toBe(10)
})

test('a hungry pet sulks at its next meal, and eating cheers it up', () => {
  const pet = { ...freshSave(NOW).pet, mood: 60, fullness: 80, lastFedAt: NOW }

  // fed and full: a big meal cheers it up, at most +5
  expect(afterMeal(pet, NOW, 2000)).toEqual(expect.objectContaining({ mood: 65, fullness: 100, lastFedAt: NOW }))
  // a small meal: fuller, no cheer
  expect(afterMeal(pet, NOW, 100)).toEqual(expect.objectContaining({ mood: 60, fullness: 81 }))

  // left alone 10 hours: fullness 80 -> 20, hungry, so it sulks (-3) before the meal cheers (+2)
  const later = NOW + 10 * 60 * 60 * 1000
  expect(afterMeal(pet, later, 400)).toEqual(expect.objectContaining({ mood: 59, fullness: 24, lastFedAt: later }))
  // and with nothing to eat it only sulks
  expect(afterMeal(pet, later, 0).mood).toBe(57)
})

test('a corrupt save falls back field by field instead of breaking the pet', () => {
  const loaded = loadSave(
    { version: 1, pet: { xp: '25', species: 'unicorn', mood: 150, name: 7 }, counters: { turns: 'x', tools: { Bash: 3, Read: 'no' } }, unlocked: { a: 1, b: 'x' } },
    NOW,
  )
  expect(loaded.pet).toEqual(expect.objectContaining({ xp: 0, species: null, mood: 100, name: 'たま' }))
  expect(loaded.counters.turns).toBe(0)
  expect(loaded.counters.tools).toEqual({ Bash: 3 })
  expect(loaded.unlocked).toEqual({ b: 'x' })
  expect(loaded.settings).toEqual({ sound: true, chatter: true })
  expect([loaded.diary, loaded.pet.affection]).toEqual([[], 0])
  // a birthday that is no date falls back to a real one
  expect(Number.isFinite(Date.parse(loadSave({ version: 1, pet: { bornAt: 'yesterday' } }, NOW).pet.bornAt))).toBe(true)
})

test('fullness keeps falling across short gaps between meals', () => {
  let pet = { ...freshSave(NOW).pet, fullness: 80, lastFedAt: NOW }
  // ten empty meals four minutes apart: 40 minutes is 4 points
  for (let i = 1; i <= 10; i++) pet = afterMeal(pet, NOW + i * 4 * 60 * 1000, 0)
  expect(Math.abs(pet.fullness - 76) < 1e-9).toBe(true)
})

test('a name keeps whole characters and drops invisible ones', () => {
  expect(cleanName('a🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱x')).toBe('a🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱🐱')
  expect(cleanName(' ミ\u0007ケ ')).toBe('ミケ')
  // zero-width spaces, direction marks, line separators
  expect(cleanName('\u200b\u200b')).toBe('')
  expect(cleanName('\u200d\u200d')).toBe('')
  expect(cleanName('ポ\u202eチ\u2028')).toBe('ポチ')
  // a family emoji is one character, made of several code points
  expect(cleanName('👨‍👩‍👧'.repeat(13))).toBe('👨‍👩‍👧'.repeat(12))
})

test('age counts the first day as day 1', () => {
  const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime()
  const save = { ...freshSave(at(5, 23)), pet: { ...freshSave(at(5, 23)).pet, bornAt: new Date(at(5, 23)).toISOString() } }
  expect(ageDays(save, at(5, 23))).toBe(1)
  expect(ageDays(save, at(6, 0))).toBe(2)
  expect(ageDays(save, at(15))).toBe(11)
})

test('the streak grows a day at a time and starts over after a gap', () => {
  const day = (d: number) => new Date(2026, 9, d, 12).getTime()
  let c = rollDay(freshCounters(), day(5))
  expect([c.lastSessionDay, c.streakDays]).toEqual(['2026-10-05', 1])
  c = rollDay(c, day(5) + 3600_000)
  expect(c.streakDays).toBe(1)
  c = rollDay(c, day(6))
  c = rollDay(c, day(7))
  expect(c.streakDays).toBe(3)
  expect(rollDay(c, day(9)).streakDays).toBe(1)
})

test('care counts start over only when the day moves forward', () => {
  const day = (d: number) => new Date(2026, 9, d, 12).getTime()
  const base = freshSave(day(5))
  const pet = { ...base, pet: { ...base.pet, xp: 40, species: 'cat' as const, fullness: 10 }, care: { day: '2026-10-06', feed: 3, pat: 0, play: 0 } }
  // the clock went back a day: the counts used "tomorrow" still hold
  expect(careLeft(pet, 'feed', day(5))).toBe(0)
  expect(giveCare(pet, 'feed', day(5))).toEqual({ refused: 'きょうのごはんはもうおしまい。また明日' })
  // the next day they start over
  expect(careLeft(pet, 'feed', day(7))).toBe(3)
})

test('only nothing at all, or version 1, is a readable save', () => {
  expect(isReadable(undefined)).toBe(true)
  expect(isReadable({ version: 1 })).toBe(true)
  expect(isReadable({ version: 2, pet: { xp: 400 } })).toBe(false)
  expect(isReadable('garbage')).toBe(false)
  expect(isReadable(null)).toBe(false)
})
