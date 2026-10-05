import type { Counters } from '../types'

export type Achievement = {
  id: string
  title: string
  // how it is earned: hidden until it is unlocked
  hint: string
  xp: number
  check: (c: Counters) => boolean
}

const tool = (c: Counters, name: string) => c.tools[name] ?? 0

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-step', title: '初めの一歩', hint: '1ターン終える', xp: 10, check: c => c.turns >= 1 },
  { id: 'reader', title: '読書家', hint: 'ファイルを50回読む', xp: 20, check: c => tool(c, 'Read') >= 50 },
  { id: 'bash-master', title: 'Bash職人', hint: 'Bashを100回使う', xp: 40, check: c => tool(c, 'Bash') >= 100 },
  { id: 'writer', title: '書き手', hint: 'ファイルを50回書き換える', xp: 40, check: c => tool(c, 'Write') + tool(c, 'Edit') >= 50 },
  { id: 'first-commit', title: '初コミット', hint: 'git commit する', xp: 20, check: c => c.commits >= 1 },
  { id: 'commit-10', title: 'コミット魔', hint: '10回コミットする', xp: 50, check: c => c.commits >= 10 },
  { id: 'all-green', title: '全部緑', hint: 'テストを通す', xp: 20, check: c => c.testPasses >= 1 },
  { id: 'comeback', title: '七転び八起き', hint: '失敗のあとに成功する', xp: 15, check: c => c.recoveries >= 1 },
  { id: 'scolded', title: '叱られた', hint: 'ツールを止められる', xp: 10, check: c => c.denies >= 1 },
  { id: 'night-owl', title: '夜更かし', hint: '深夜0〜4時に起動する', xp: 15, check: c => c.nightOwl },
  { id: 'streak-3', title: '三日坊主じゃない', hint: '3日続けて使う', xp: 30, check: c => c.streakDays >= 3 },
  { id: 'big-spender', title: '太っ腹', hint: '1セッションで$1使う', xp: 20, check: c => c.maxSessionCostUsd >= 1 },
  { id: 'deep-thought', title: '長考', hint: '5分を超えるターン', xp: 20, check: c => c.longestTurnMs >= 5 * 60 * 1000 },
  { id: 'parallel', title: '並列使い', hint: '3つのツールを同時に動かす', xp: 15, check: c => c.maxParallel >= 3 },
  { id: 'grateful', title: '感謝の人', hint: 'ありがとうを10回言う', xp: 25, check: c => c.thanks >= 10 },
  { id: 'summoner', title: '召喚士', hint: 'サブエージェントを呼ぶ', xp: 15, check: c => c.subagents >= 1 },
  { id: 'veteran', title: '百戦錬磨', hint: '100ターン終える', xp: 60, check: c => c.turns >= 100 },
]

// The achievements the counters now earn that were not unlocked before.
export const newlyEarned = (counters: Counters, unlocked: Record<string, string>) =>
  ACHIEVEMENTS.filter(a => unlocked[a.id] === undefined && a.check(counters))

// Each finished turn is worth a little XP on its own, so daily work moves the pet along too.
export const XP_PER_TURN = 1
