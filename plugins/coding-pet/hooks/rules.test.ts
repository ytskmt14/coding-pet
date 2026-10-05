import { expect, test } from 'claude-code/testing'

import { award, isCommit, isTestRun, isThanks, segments } from './rules'
import { freshSave } from './pet'

test('a test run is a test runner at the start of a command part', () => {
  for (const ran of ['npm test', 'pnpm run test', 'cd app && CI=1 npm test', 'pytest -q', 'python3 -m pytest', 'go test ./...', 'claude plugin test .', 'npx vitest run'])
    expect([ran, isTestRun(ran)]).toEqual([ran, true])
  for (const not of ['cat test.txt', 'ls tests/', 'mkdir -p src/test', 'grep -r test .', 'git commit -m "add tests"', 'echo npm test'])
    expect([not, isTestRun(not)]).toEqual([not, false])
})

test('a commit is git commit at the start of a command part, not a dry run', () => {
  for (const c of ['git commit -m "x"', 'git add . && git commit -m x', 'git -C repo commit -m x']) expect([c, isCommit(c)]).toEqual([c, true])
  for (const c of ['echo git commit', 'git commit --dry-run', 'git commit-tree abc', 'git log --grep commit']) expect([c, isCommit(c)]).toEqual([c, false])
  expect(segments('A=1 B=2 npm test; ls | wc -l')).toEqual(['npm test', 'ls', 'wc -l'])
  // separators inside quotes split nothing
  expect(isTestRun('git commit -m "wip; npm test"')).toBe(false)
  expect(isCommit('git commit -m "wip; npm test"')).toBe(true)
  expect(isTestRun("echo 'a && npm test'")).toBe(false)
})

test('thanks count only from the person, and not inside other words', () => {
  expect(isThanks('composer', 'ありがとう！')).toBe(true)
  expect(isThanks('bridge', 'thanks')).toBe(true)
  expect(isThanks('task-notification', 'ありがとう')).toBe(false)
  expect(isThanks('scheduled-trigger', 'thank you')).toBe(false)
  expect(isThanks('composer', 'Thanksgiving plans')).toBe(false)
})

test('award grants each achievement once and hatches with the picked species', () => {
  const save = freshSave(0)
  const first = award({ ...save, pet: { ...save.pet, xp: 25 }, counters: { ...save.counters, turns: 1 } }, 'at', 0.99)
  expect(first.earned.map(a => a.id)).toEqual(['first-step'])
  expect(first.save.pet).toEqual(expect.objectContaining({ xp: 35, species: 'ghost' }))
  expect(award(first.save, 'at', 0).earned).toEqual([])
})
