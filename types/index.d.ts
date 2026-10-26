export type Progress = {
  label: string
  percent: number
  startedAt: number
  startPercent: number
  updatedAt: number
  etaAt: number | null
  isDone: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'progress-glow': { progress: Shaped<Progress | null>; now: number }
  }
}
