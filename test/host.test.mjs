import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../index.js'

const DAY = 86_400_000
const H = 3_600_000

function fakeContext() {
  const routes = []
  const disposers = []
  const ctx = {
    credentials: { resolve: async () => ({ value: 'test-key' }) },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    get(name) {
      if (name === 'credentials') return ctx.credentials
      if (name === 'webServer') return ctx.webServer
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on() {
      return () => {}
    },
    routes,
    disposers,
  }
  return ctx
}

function responseRecorder() {
  const out = { status: 0, headers: null, body: '' }
  return {
    out,
    res: {
      writeHead(status, headers) {
        out.status = status
        out.headers = headers
      },
      end(text) {
        out.body = text
      },
    },
  }
}

test('host half samples both endpoints and answers the status route', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ogeta-test-'))
  process.env.DSH_HOME = home
  const now = Date.now()
  const resetsAt = new Date(now + 10 * DAY).toISOString()
  const endsAt = new Date(now + 10 * DAY).toISOString()

  const samples = []
  for (let i = 0; i < 40; i += 1) {
    samples.push({
      t: now - (40 - i) * 2.4 * H,
      usage: {
        rolling: { percent: 5, resetsAt: new Date(now + 3 * H).toISOString() },
        weekly: { percent: 20, resetsAt: new Date(now + 4 * DAY).toISOString() },
        monthly: { percent: 20 + i, resetsAt },
      },
      money: { monthly: { usedMicroCents: (20 + i) * 1e8, limitMicroCents: 100 * 1e8 } },
      plan: { startsAt: new Date(now - 20 * DAY).toISOString(), endsAt, cancelAtPeriodEnd: false },
    })
  }
  await fs.mkdir(path.join(home, 'opencode-go-eta'), { recursive: true })
  await fs.writeFile(
    path.join(home, 'opencode-go-eta', 'samples.json'),
    JSON.stringify({ version: 1, savedAt: now, samples }),
    'utf8',
  )

  const fetchCalls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url))
    if (String(url).includes('/zen/go/v1/usage')) {
      return new Response(
        JSON.stringify({
          usage: {
            rolling: { status: 'ok', percent: 6, resetsAt: new Date(now + 2 * H).toISOString() },
            weekly: { status: 'ok', percent: 21, resetsAt: new Date(now + 4 * DAY).toISOString() },
            monthly: { status: 'ok', percent: 60, resetsAt },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return new Response(
      JSON.stringify({
        access: {
          startsAt: new Date(now - 20 * DAY).toISOString(),
          endsAt,
          meters: {
            fiveHour: { usedMicroCents: 6e8, limitMicroCents: 100e8 },
            week: { usedMicroCents: 21e8, limitMicroCents: 100e8 },
            month: { usedMicroCents: 60e8, limitMicroCents: 100e8 },
          },
          cancelAtPeriodEnd: false,
          renewalPending: false,
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  try {
    const ctx = fakeContext()
    apply(ctx, { anchors: [], sampleIntervalMs: 1, staleAfterMs: 0, timeoutMs: 5000 })
    assert.equal(ctx.routes.length, 1)
    const route = ctx.routes[0]
    assert.equal(route.kind, 'exact')

    const { out, res } = responseRecorder()
    await route.handler(
      { method: 'GET', url: '/api/dsh-opencode-go-eta/status?refresh=1', socket: { remoteAddress: '127.0.0.1' } },
      res,
    )
    assert.equal(out.status, 200)
    const body = JSON.parse(out.body)
    assert.equal(body.ok, true)
    assert.equal(body.windows.monthly.percent, 60)
    assert.equal(body.projection.plan.endsAt, endsAt)
    assert.equal(body.projection.verdict, 'before-expiry')
    assert.ok(body.projection.etaIso !== null)
    assert.ok(body.projection.sampleCount >= 40)
    assert.ok(Array.isArray(body.series.monthly) && body.series.monthly.length > 1)
    assert.equal(fetchCalls.length, 2, fetchCalls.join(','))
    assert.ok(fetchCalls.some((url) => url.endsWith('/zen/go/v1/usage')))
    assert.ok(fetchCalls.some((url) => url.endsWith('/console/api/go/status')))
  } finally {
    globalThis.fetch = originalFetch
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('host half survives a missing credential without throwing', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ogeta-test-'))
  process.env.DSH_HOME = home
  const ctx = fakeContext()
  ctx.get = (name) => (name === 'webServer' ? { register: () => () => {} } : undefined)
  apply(ctx, { anchors: [], sampleIntervalMs: 1, staleAfterMs: 0 })
  const route = ctx.routes[0]
  const { out, res } = responseRecorder()
  await route.handler({ method: 'GET', url: '/api/dsh-opencode-go-eta/status', socket: { remoteAddress: '127.0.0.1' } }, res)
  assert.equal(out.status, 200)
  const body = JSON.parse(out.body)
  assert.equal(body.ok, false)
  assert.equal(body.error, 'missing-key')
  await fs.rm(home, { recursive: true, force: true })
})
