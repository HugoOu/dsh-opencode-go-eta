import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classify,
  currentCycle,
  formatDuration,
  median,
  MIN_SAMPLES,
  MIN_SPAN_HOURS,
  projectWindow,
  theilSen,
} from '../lib/projection.js'

const H = 3_600_000
const DAY = 24 * H

test('median handles odd and even lengths without mutating input', () => {
  const input = [3, 1, 2]
  assert.equal(median(input), 2)
  assert.deepEqual(input, [3, 1, 2])
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.equal(median([]), 0)
})

test('theilSen recovers a clean linear slope', () => {
  const points = []
  for (let i = 0; i < 20; i += 1) points.push({ x: i * 6, y: 10 + 0.25 * i * 6 })
  const fit = theilSen(points)
  assert.ok(Math.abs(fit.slope - 0.25) < 1e-9, `slope ${fit.slope}`)
  assert.ok(fit.r2 > 0.999)
  assert.equal(fit.n, 20)
})

test('theilSen is robust against a single spike', () => {
  const points = []
  for (let i = 0; i < 12; i += 1) points.push({ x: i, y: i })
  points[5] = { x: 5, y: 60 }
  const fit = theilSen(points)
  assert.ok(Math.abs(fit.slope - 1) < 0.4, `slope ${fit.slope}`)
})

test('currentCycle drops the part before the last reset', () => {
  const series = [
    { t: 0, percent: 40 },
    { t: H, percent: 80 },
    { t: 2 * H, percent: 2 }, // reset
    { t: 3 * H, percent: 5 },
  ]
  const out = currentCycle(series, null, 5 * H)
  assert.deepEqual(out.map((s) => s.percent), [2, 5])
})

test('projectWindow reports insufficient samples below the threshold', () => {
  const now = Date.parse('2026-10-24T00:00:00Z')
  const series = [
    { t: now - 2 * H, percent: 20 },
    { t: now - 1 * H, percent: 21 },
  ]
  const projection = projectWindow({
    series,
    nowMs: now,
    resetsAtMs: now + 10 * DAY,
    endsAtMs: now + 12 * DAY,
    cycleMs: 30 * DAY,
    percentNow: 21,
  })
  assert.equal(projection.incomplete, true)
  assert.equal(projection.verdict, 'insufficient')
  assert.equal(projection.etaMs, null)
})

test('projectWindow predicts exhaustion before renewal when burning fast', () => {
  const now = Date.parse('2026-10-24T00:00:00Z')
  const series = []
  // 1%/hour, 50% used, 4 days of samples
  for (let i = 0; i < 96; i += 1) {
    series.push({ t: now - (96 - i) * H, percent: 2 + i })
  }
  const endsAt = now + 5 * DAY
  const projection = projectWindow({
    series,
    nowMs: now,
    resetsAtMs: now + 26 * DAY,
    endsAtMs: endsAt,
    cycleMs: 30 * DAY,
    percentNow: 98,
  })
  assert.equal(projection.status, 'ok')
  assert.ok(projection.ratePerHour > 0.9 && projection.ratePerHour < 1.1, `rate ${projection.ratePerHour}`)
  assert.ok(projection.etaMs !== null && projection.etaMs <= now + 3 * H, `eta ${projection.etaMs}`)
  assert.equal(projection.verdict, 'before-expiry')
  assert.equal(projection.confidence, 'high')
  assert.ok(projection.sampleCount >= MIN_SAMPLES)
  assert.ok(projection.spanHours >= MIN_SPAN_HOURS)
})

test('projectWindow says safe when the window resets first', () => {
  const now = Date.parse('2026-10-24T00:00:00Z')
  const series = []
  for (let i = 0; i < 60; i += 1) series.push({ t: now - (60 - i) * 6 * H, percent: 10 + i * 0.5 })
  const projection = projectWindow({
    series,
    nowMs: now,
    resetsAtMs: now + 2 * DAY,
    endsAtMs: now + 20 * DAY,
    cycleMs: 30 * DAY,
    percentNow: 40,
  })
  assert.equal(projection.verdict, 'safe-reset')
  assert.ok(projection.etaMs === null || projection.etaMs >= now + 2 * DAY)
})

test('projectWindow reports exhausted and idle cases', () => {
  const now = Date.parse('2026-10-24T00:00:00Z')
  const series = []
  for (let i = 0; i < 40; i += 1) series.push({ t: now - (40 - i) * 6 * H, percent: 30 })
  const idle = projectWindow({ series, nowMs: now, resetsAtMs: now + DAY, endsAtMs: now + 9 * DAY, cycleMs: 30 * DAY, percentNow: 30 })
  assert.equal(idle.verdict, 'idle')
  assert.equal(idle.etaMs, null)

  const exhausted = projectWindow({ series, nowMs: now, resetsAtMs: now + DAY, endsAtMs: now + 9 * DAY, cycleMs: 30 * DAY, percentNow: 100 })
  assert.equal(exhausted.verdict, 'exhausted')
})

test('classify covers the expiry comparison branches', () => {
  const now = 1_000_000
  const base = { percent: 50, nowMs: now, resetsAtMs: now + 10 * DAY, endsAtMs: now + 5 * DAY, incomplete: false, idle: false }
  assert.equal(classify({ ...base, etaMs: now + 2 * DAY }), 'before-expiry')
  assert.equal(classify({ ...base, etaMs: now + 8 * DAY }), 'after-expiry')
  assert.equal(classify({ ...base, etaMs: now + 20 * DAY, resetsAtMs: now + 10 * DAY }), 'safe-reset')
  assert.equal(classify({ ...base, etaMs: now + 2 * DAY, endsAtMs: null }), 'before-expiry')
  assert.equal(classify({ ...base, etaMs: null }), 'no-rate')
})

test('formatDuration is stable', () => {
  assert.equal(formatDuration(0.5), '30m')
  assert.equal(formatDuration(3), '3.0h')
  assert.equal(formatDuration(30), '30h')
  assert.equal(formatDuration(72), '3.0d')
  assert.equal(formatDuration(Number.NaN), '—')
})
