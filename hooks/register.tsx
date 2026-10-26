import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Progress } from '../types'

const PANE = 'progress-glow'
const TITLE = 'Progress'
const ORANGE = '#D97757'
// Times are shown in Singapore time (UTC+8).
const UTC_OFFSET_HOURS = 8
const TICK_MS = 30_000

const progress = atom({ plugin: 'progress-glow', key: 'progress' } as const, null, {
  shape: 'progress-1',
})
const now = atom({ plugin: 'progress-glow', key: 'now' } as const, 0)

const SET_PROGRESS_DESCRIPTION = [
  'Updates the orange progress bar the person watches beside the chat.',
  'Call it whenever a long job reports how far along it is, e.g. a render at frame 812 of 1788:',
  'pass label, and either percent or current + total. Pass eta_minutes only when the job itself',
  'reports a time left; otherwise the bar estimates it from the pace so far. Pass done: true when',
  'the job finishes. Checklist updates already move the bar, so this is for finer-grained jobs.',
].join(' ')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'set_progress',
      description: SET_PROGRESS_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short name of the job, e.g. "Rendering care kit film"' },
          percent: { type: 'number', minimum: 0, maximum: 100 },
          current: { type: 'number', description: 'Units done so far, e.g. frames rendered' },
          total: { type: 'number', description: 'Units in the whole job' },
          eta_minutes: { type: 'number', description: 'Minutes left, if the job reports it' },
          done: { type: 'boolean' },
        },
        required: ['label'],
      },
    })
    await $.command.register({
      name: 'progress',
      description: 'Show the orange progress bar (add "clear" to reset it)',
      argumentHint: '[clear]',
    })
    $.clock.every(TICK_MS, async () => {
      const at = await $.clock.now()
      await update($, now, () => at)
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, progress, () => null)
      $.ui.status(undefined)

      return { text: 'Progress bar cleared.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Progress bar opened.' }
  })

  on('tool.call', { tool: 'mcp__progress-glow__set_progress' }, async ($, e) => {
    const input = e as unknown as SetProgressInput
    const percent = percentOf(input)
    if (percent === null) {
      return { result: 'Give percent, or current and total.', isError: true }
    }
    const shown = await record($, input.label, percent, input.eta_minutes)

    return { result: `Progress bar now shows ${Math.round(shown.percent)}% for "${shown.label}".` }
  }).catch(() => ({ result: 'The progress bar could not be updated.', isError: true }))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const counted = countSteps(e as unknown as Record<string, unknown>, e.tool)
    if (counted !== null && ran.deny === undefined && ran.isError !== true) {
      // The bar is a nicety: a fault here must never spoil the tool call.
      await record($, counted.label, counted.percent).catch(() => undefined)
    }

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const shown = await read($, progress)
    const at = Math.max(await read($, now), shown?.updatedAt ?? 0)

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      if (shown === null) {
        return <Text dimColor>No task running yet.</Text>
      }
      const width = Math.max(10, Math.min(40, e.props.bodyColumns - 6))
      const filled = Math.round((width * shown.percent) / 100)

      return (
        <Box flexDirection="column">
          <Text dimColor wrap="truncate-end">{shown.label}</Text>
          <Text>
            <Text color={ORANGE}>{'━'.repeat(filled)}</Text>
            <Text dimColor>{'━'.repeat(width - filled)}</Text>
            <Text color={ORANGE} bold> {Math.round(shown.percent)}%</Text>
          </Text>
          <Text dimColor>{finishLine(shown, at)}</Text>
        </Box>
      )
    }

    const { Svg, Text } = $.ui.resolve(e)
    if (shown === null) {
      return <Text dimColor>No task running yet.</Text>
    }

    return (
      <Svg
        source={barSvg(shown, at)}
        alt={`${shown.label}: ${Math.round(shown.percent)}%. ${finishLine(shown, at)}`}
        isInteractive
      />
    )
  })
}

type SetProgressInput = {
  label: string
  percent?: number
  current?: number
  total?: number
  eta_minutes?: number
  done?: boolean
}

function percentOf(input: SetProgressInput): number | null {
  if (input.done === true) return 100
  if (typeof input.percent === 'number') return clamp(input.percent)
  if (typeof input.current === 'number' && typeof input.total === 'number' && input.total > 0) {
    return clamp((input.current / input.total) * 100)
  }

  return null
}

// Reads a checklist or todo list off a tool call and turns it into a percent:
// finished steps count whole, the one in progress counts half.
function countSteps(
  input: Record<string, unknown>,
  tool: string,
): { label: string; percent: number } | null {
  if (tool.endsWith('update_progress_checklist') && typeof input.text === 'string') {
    const lines = input.text.split('\n').map(line => line.trim())
    const steps = lines.filter(line => /^[✓✱○]/.test(line))
    if (steps.length === 0) return null
    const done = steps.filter(line => line.startsWith('✓')).length
    const going = steps.filter(line => line.startsWith('✱')).length
    const label = lines.find(line => line !== '' && !/^[✓✱○]/.test(line)) ?? 'Current task'

    return { label, percent: ((done + going / 2) / steps.length) * 100 }
  }
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const todos = input.todos as { status?: string; activeForm?: string; content?: string }[]
    if (todos.length === 0) return null
    const done = todos.filter(todo => todo.status === 'completed').length
    const active = todos.find(todo => todo.status === 'in_progress')
    const going = active === undefined ? 0 : 1

    return {
      label: active?.activeForm ?? active?.content ?? 'Current task',
      percent: ((done + going / 2) / todos.length) * 100,
    }
  }

  return null
}

async function record(
  $: EngineInterface,
  label: string,
  percent: number,
  etaMinutes?: number,
): Promise<Progress> {
  const at = await $.clock.now()
  const next = await update($, progress, prev => estimate(prev, label, clamp(percent), at, etaMinutes))
  const shown = next ?? estimate(null, label, clamp(percent), at, etaMinutes)
  $.ui.status(`${Math.round(shown.percent)}% · ${finishLine(shown, at)}`)

  return shown
}

// The finish time comes from the pace since this task started: how many
// percent went by in how long, carried on to 100. Each new reading is
// blended with the last so the time does not jump about.
function estimate(
  prev: Progress | null,
  label: string,
  percent: number,
  at: number,
  etaMinutes?: number,
): Progress {
  const isNew =
    prev === null || prev.isDone || (prev.label !== label && percent < 100) || percent < prev.percent - 1
  const startedAt = isNew ? at : prev.startedAt
  const startPercent = isNew ? percent : prev.startPercent
  const isDone = percent >= 100

  let etaAt: number | null = isNew ? null : prev.etaAt
  if (isDone) {
    etaAt = at
  } else if (typeof etaMinutes === 'number' && etaMinutes >= 0) {
    etaAt = at + etaMinutes * 60_000
  } else if (percent > startPercent && at - startedAt >= 10_000) {
    const raw = at + ((at - startedAt) * (100 - percent)) / (percent - startPercent)
    etaAt = etaAt === null ? raw : Math.round(raw * 0.6 + etaAt * 0.4)
  }

  return { label, percent, startedAt, startPercent, updatedAt: at, etaAt, isDone }
}

function finishLine(shown: Progress, at: number): string {
  if (shown.isDone) return `Done at ${clockTime(shown.etaAt ?? shown.updatedAt)}`
  if (shown.etaAt === null) return 'Working out the finish time…'
  const minutes = Math.max(0, Math.round((shown.etaAt - at) / 60_000))
  const left =
    minutes < 1 ? 'almost done' : minutes < 60 ? `about ${minutes} min left` : `about ${hours(minutes)} left`

  return `${left} · done around ${clockTime(shown.etaAt)}`
}

function hours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60

  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function clockTime(ms: number): string {
  const local = new Date(ms + UTC_OFFSET_HOURS * 3_600_000)
  const h24 = local.getUTCHours()
  const minute = String(local.getUTCMinutes()).padStart(2, '0')
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12

  return `${h12}:${minute} ${h24 < 12 ? 'am' : 'pm'}`
}

function barSvg(shown: Progress, at: number): string {
  const width = 360
  const fill = Math.max(shown.percent > 0 ? 6 : 0, Math.round((width * shown.percent) / 100))
  const pulse = shown.isDone
    ? ''
    : '<animate attributeName="opacity" values="0.45;0.95;0.45" dur="2.4s" repeatCount="indefinite"/>'

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 62" width="${width}" height="62">`,
    '<defs>',
    '<linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#C15F3C"/><stop offset="1" stop-color="#F4A27F"/></linearGradient>',
    '<filter id="glow" x="-20%" y="-300%" width="140%" height="700%"><feGaussianBlur stdDeviation="5"/></filter>',
    '</defs>',
    `<text x="0" y="15" font-family="system-ui, sans-serif" font-size="12" fill="#8F8D86">${escapeXml(shorten(shown.label, 44))}</text>`,
    `<text x="${width}" y="15" text-anchor="end" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="${ORANGE}">${Math.round(shown.percent)}%</text>`,
    `<rect x="0" y="28" width="${width}" height="6" rx="3" fill="${ORANGE}" fill-opacity="0.15"/>`,
    `<rect x="0" y="28" width="${fill}" height="6" rx="3" fill="${ORANGE}" filter="url(#glow)" opacity="0.8">${pulse}</rect>`,
    `<rect x="0" y="28" width="${fill}" height="6" rx="3" fill="url(#g)"/>`,
    `<text x="0" y="54" font-family="system-ui, sans-serif" font-size="11" fill="#8F8D86">${escapeXml(finishLine(shown, at))}</text>`,
    '</svg>',
  ].join('')
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function clamp(percent: number): number {
  return Math.min(100, Math.max(0, percent))
}
