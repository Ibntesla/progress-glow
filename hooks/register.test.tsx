import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'progress-glow',
  component: 'Pane',
  requestId: 'progress-glow',
  props: {
    title: 'Progress',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// 2026-10-26 14:00 UTC, 10:00 pm in Singapore.
const START = Date.UTC(2026, 9, 26, 14, 0)

const checklist = (marks: string) =>
  ['Render care kit film', '', ...[...marks].map((mark, i) => `${mark} Step ${i + 1}`)].join('\n')

test('checklists and frame counts move the bar, with a finish time', async ($, on) => {
  const clock = mock.clock(on)
  await clock.set(START)
  on('command.register', () => ({ value: { command: 'progress' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__progress-glow__set_progress' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('No task running yet.')
    await ui.unmount()
  }

  await $.tool.call({ tool: 'mcp__hearthbot__update_progress_checklist', text: checklist('✱○○○') })
  await clock.advance(10 * 60_000)
  await $.tool.call({ tool: 'mcp__hearthbot__update_progress_checklist', text: checklist('✓✓✱○') })

  // 12.5% at the start, 62.5% ten minutes later: 50% per 10 min, so
  // 37.5% to go is 7.5 min, finishing 10:17:30 pm (shown as 10:17 or 10:18).
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const bar = await desk.find({ type: 'Svg' })
  expect(String(bar?.props.alt)).toMatch(/Render care kit film: 63%/)
  expect(String(bar?.props.alt)).toMatch(/about 8 min left · done around 10:1[78] pm/)
  expect(String(bar?.props.source)).toContain('#D97757')
  await desk.unmount()

  await $.tool.call({
    tool: 'mcp__progress-glow__set_progress',
    label: 'Rendering frames',
    current: 447,
    total: 1788,
    eta_minutes: 90,
  })
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await term.find({ type: 'Text', text: /25%/ }))?.text).toContain('25%')
  expect((await term.find({ type: 'Text', text: /left/ }))?.text).toBe(
    'about 1 h 30 min left · done around 11:40 pm',
  )
  await term.unmount()

  await $.tool.call({ tool: 'mcp__progress-glow__set_progress', label: 'Rendering frames', done: true })
  const end = await $.ui.mount({ ...PANE, surface: 'mobile' })
  expect(String((await end.find({ type: 'Svg' }))?.props.alt)).toMatch(/100%\. Done at 10:10 pm/)
  await end.unmount()
})
