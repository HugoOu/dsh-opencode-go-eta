import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Loads the browser bundle against a minimal stand-in for the Harness client
 * kernel: just enough React, DOM and slot registry to run both components.
 */

const React = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children: children.length > 1 ? children : children[0] }
  },
  useId: () => ':r0:',
  useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
  useEffect() {},
  useRef(value) {
    return { current: value }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
}

globalThis.window = { __ModuleLoader__: { load() {} } }
globalThis.document = {
  documentElement: { getAttribute: () => 'zh-CN' },
  visibilityState: 'visible',
  addEventListener() {},
  removeEventListener() {},
}

const now = Date.now()
const SAMPLE = {
  ok: true,
  now: new Date(now).toISOString(),
  fetchedAt: new Date(now).toISOString(),
  source: 'live',
  error: null,
  warning: null,
  windows: {
    rolling: { percent: 23, resetsAt: new Date(now + 3 * 3600_000).toISOString() },
    weekly: { percent: 41, resetsAt: new Date(now + 4 * 86_400_000).toISOString() },
    monthly: { percent: 82, resetsAt: new Date(now + 10 * 86_400_000).toISOString(), usedMicroCents: 49.2e8, limitMicroCents: 60e8 },
  },
  projection: {
    status: 'ok',
    percent: 82,
    remainingPercent: 18,
    ratePerHour: 0.62,
    r2: 0.93,
    sampleCount: 46,
    spanHours: 153.6,
    confidence: 'medium',
    incomplete: false,
    idle: false,
    etaMs: now + 6 * 86_400_000,
    etaIso: new Date(now + 6 * 86_400_000).toISOString(),
    resetsAtMs: now + 10 * 86_400_000,
    resetsAtIso: new Date(now + 10 * 86_400_000).toISOString(),
    endsAtMs: now + 10 * 86_400_000,
    endsAtIso: new Date(now + 10 * 86_400_000).toISOString(),
    projectedAtExpiry: 100,
    projectedAtReset: 100,
    verdict: 'before-expiry',
    plan: { endsAt: new Date(now + 10 * 86_400_000).toISOString(), daysLeft: 10, cancelAtPeriodEnd: false },
    windows: {},
  },
  series: {
    monthly: Array.from({ length: 40 }, (_, index) => ({ t: now - (40 - index) * 4 * 3600_000, percent: 40 + index })),
  },
  sample: {
    count: 46,
    spanHours: 153.6,
    firstAt: new Date(now - 7 * 86_400_000).toISOString(),
    lastAt: new Date(now).toISOString(),
    cadence: { anchors: [3, 9, 15, 21], sampleIntervalMs: 1200000, staleAfterMs: 2700000 },
  },
}

let fetchCalls = 0
const originalFetch = globalThis.fetch
globalThis.fetch = async () => {
  fetchCalls += 1
  return new Response(JSON.stringify(SAMPLE), { status: 200, headers: { 'content-type': 'application/json' } })
}
test.after(() => {
  globalThis.fetch = originalFetch
})

const registrations = []
let factoryResult = null
globalThis.window.__ModuleLoader__.load = (options) => {
  assert.equal(options.id, 'dsh-opencode-go-eta')
  factoryResult = options.factory
}

await import('../client.js')
assert.ok(factoryResult, 'bundle registered a factory')

const plugin = factoryResult((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
assert.ok(plugin && plugin.apply, 'factory returned a plugin')

const cleanups = []
test.after(() => {
  for (const cleanup of cleanups) cleanup()
})

plugin.inject.includes('slots')
plugin.apply({
  get() {
    return undefined
  },
  slots: {
    inject(_key, callback) {
      callback()
    },
    register(options_, component) {
      registrations.push({ slot: options_.name, id: options_.id, component })
      return () => {}
    },
  },
  effect(callback) {
    const dispose = callback()
    if (typeof dispose === 'function') cleanups.push(dispose)
    return () => dispose?.()
  },
})

const pill = () => registrations.find((entry) => entry.slot === 'conversation.composer.dock')
const overlay = () => registrations.find((entry) => entry.slot === 'shell.overlay')

function renderTree(node) {
  if (node === null || node === undefined || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderTree).join('')
  if (typeof node.type === 'function') return renderTree(node.type(node.props))
  return renderTree(node.children)
}

test('registers the composer pill and the overlay panel', () => {
  assert.deepEqual(registrations.map((entry) => entry.slot).sort(), ['conversation.composer.dock', 'shell.overlay'])
})

test('overlay renders nothing while closed', () => {
  assert.equal(overlay().component({}), null)
})

test('pill renders before data arrives and opens the panel on click', async () => {
  const element = pill().component({})
  const text = renderTree(element)
  assert.ok(text.includes('Go'), text)
  assert.ok(element.props.onClick, 'pill is clickable')
  element.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.ok(fetchCalls >= 1, 'opening the panel loads the snapshot')
})

test('panel renders a full reading once data arrives', () => {
  const tree = renderTree(overlay().component({}))
  assert.ok(tree, 'panel should render while open')
  assert.ok(tree.includes('OpenCode Go'), tree.slice(0, 120))
  assert.ok(tree.includes('82'), 'used percent is shown')
  assert.ok(tree.includes('用尽') || tree.includes('run out'), 'headline names the projected exhaustion')
  assert.ok(tree.includes('剩余'), 'gauge caption is present')
  assert.ok(tree.includes('续费'), 'renewal chip is present')
})
