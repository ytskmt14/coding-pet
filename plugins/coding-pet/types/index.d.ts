export type Species = 'cat' | 'bird' | 'slime' | 'dragon' | 'ghost'
export type StageId = 'egg' | 'hatchling' | 'child' | 'adult' | 'final'

export type Counters = {
  turns: number
  aborted: number
  // by tool name
  tools: Record<string, number>
  errors: number
  denies: number
  // a tool that succeeded after its own last call failed
  recoveries: number
  // tools whose last call failed, waiting for a recovery
  failedTools: string[]
  commits: number
  testPasses: number
  subagents: number
  thanks: number
  costUsd: number
  // the most one session has spent: each session raises it with its own spend only
  maxSessionCostUsd: number
  longestTurnMs: number
  maxParallel: number
  sessions: number
  // local date (YYYY-MM-DD) of the last session, and how many days in a row
  lastSessionDay: string | null
  streakDays: number
  nightOwl: boolean
}

export type Pet = {
  name: string
  // decided at hatching
  species: Species | null
  xp: number
  bornAt: string
  // 0..100
  mood: number
  // 0..100 as of lastFedAt; it drops with time (see currentFullness)
  fullness: number
  lastFedAt: number
  // 0..100, raised by care
  affection: number
}

export type CareKind = 'feed' | 'pat' | 'play'

// One line of the diary: canned words only, never a command, a path or a prompt.
export type DiaryEntry = { at: number; text: string }

export type PetSave = {
  version: 1
  pet: Pet
  // achievement id -> when it was unlocked (ISO)
  unlocked: Record<string, string>
  counters: Counters
  settings: { sound: boolean; chatter: boolean }
  // the latest diary lines, newest last
  diary: DiaryEntry[]
  // care given on `day` (YYYY-MM-DD), by kind, for the daily limits
  care: { day: string; feed: number; pat: number; play: number }
}

export type PaneTab = 'home' | 'achievements' | 'abilities' | 'settings'

export type Speech = { text: string; at: number }


declare module 'claude-code' {
  interface PluginState {
    'coding-pet': {
      // the store's save, mirrored so the pane redraws on change
      // Shaped: kept under a tag, so a hot reload with a new PetSave form reads the old value as absent
      save: Shaped<PetSave | null>
      // true when the store holds a save this version cannot read: nothing is written then
      unreadable: boolean
      // a message from the mod itself (not the pet's words), shown on the いま line
      notice: Speech | null
      speech: Speech | null
      // animation frame, ticked on a timer
      frame: number
      // the pane's tab
      tab: PaneTab
      // whether the pet's pane is open: the animation and the store refresh run only then
      paneOpen: boolean
      // set once per session, so a hot reload's session.start is not counted again
      sessionCounted: boolean
      lastChatAt: number
      // the session's cost when this session started, so a resumed session's spend is not counted twice
      seenSessionUsd: number | null
      // /pet preview: draw the pet at this XP and species without touching the save
      preview: { xp: number; species: Species } | null
    }
  }
}
