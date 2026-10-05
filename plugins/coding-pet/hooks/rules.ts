import type { PetSave } from '../types'
import { newlyEarned } from './achievements'
import type { Achievement } from './achievements'
import { clamp, SPECIES_IDS, stageIndex } from './pet'

// A shell command's parts: split on && || ; | and newlines, each without leading
// VAR=value assignments, so `cd app && CI=1 npm test` yields `npm test`. Quoted text is
// blanked first, so `git commit -m "wip; npm test"` is one part, not a test run.
export const segments = (command: string) =>
  command
    .replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''")
    .split(/&&|\|\||;|\||\n/)
    .map(part => part.trim().replace(/^(?:\w+=\S*\s+)+/, ''))
    .filter(Boolean)

// A test runner at the start of a part: not any command that mentions "test".
const TEST_RUNNER =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|npx\s+(?:jest|vitest|mocha)\b|(?:pytest|jest|vitest|mocha)\b|python3?\s+-m\s+pytest\b|(?:go|cargo|deno|bun)\s+test\b|claude\s+plugin\s+test\b)/
// `commit` as a word of its own: not `commit-tree`
const GIT_COMMIT = /^git(?:\s+-C\s+\S+)?\s+commit(?![\w-])/

export const isTestRun = (command: string) => segments(command).some(part => TEST_RUNNER.test(part))
export const isCommit = (command: string) => segments(command).some(part => GIT_COMMIT.test(part) && !/--dry-run\b/.test(part))

// "Thanks" said by the person: typed at the terminal or sent through Remote Control,
// not a task notification, a scheduled prompt or another session's message.
const THANKS = /ありがと|感謝|サンキュ|\bthank you\b|\bthanks\b/i
export const isThanks = (originKind: string, text: string) =>
  (originKind === 'composer' || originKind === 'bridge') && THANKS.test(text)

// The save after a change, with what the change earned: achievements and their XP,
// and a species at hatching when none was chosen. `pick` (0..1) picks the species.
export const award = (save: PetSave, at: string, pick: number): { save: PetSave; earned: Achievement[] } => {
  let after = save
  const earned = newlyEarned(after.counters, after.unlocked)
  if (earned.length > 0) {
    after = {
      ...after,
      unlocked: { ...after.unlocked, ...Object.fromEntries(earned.map(a => [a.id, at])) },
      pet: {
        ...after.pet,
        xp: after.pet.xp + earned.reduce((sum, a) => sum + a.xp, 0),
        mood: clamp(after.pet.mood + 5 * earned.length),
      },
    }
  }
  if (stageIndex(after.pet.xp) > 0 && after.pet.species === null) {
    const species = SPECIES_IDS[Math.min(SPECIES_IDS.length - 1, Math.floor(pick * SPECIES_IDS.length))]!
    after = { ...after, pet: { ...after.pet, species } }
  }
  return { save: after, earned }
}
