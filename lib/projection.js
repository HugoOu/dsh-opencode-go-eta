/**
 * Pure projection math for the OpenCode Go ETA widget.
 *
 * Everything here is deterministic and side-effect free so it can be unit
 * tested without a Harness runtime. The host half feeds it samples taken from
 * the two OpenCode endpoints; the client half renders the result.
 */

/** Minimum samples before a projection is published. */
export const MIN_SAMPLES = 3
/** Minimum covered span (hours) before a projection is published. */
export const MIN_SPAN_HOURS = 6
/** Rates at or below this (%/hour) count as "not really consuming". */
export const IDLE_RATE_PER_HOUR = 0.002
/** A drop of more than this many percentage points is treated as a window reset. */
export const RESET_DROP = 1.5

const HOUR_MS = 3_600_000

/**
 * Theil–Sen robust slope over `{ x, y }` points. Pairwise slopes are capped by
 * deterministic stride sampling so a long history stays cheap.
 * @param {Array<{x: number, y: number}>} points
 * @returns {{ slope: number, intercept: number, n: number, span: number, r2: number }}
 */
export function theilSen(points) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x)
  const n = pts.length
  if (n < 2) return { slope: 0, intercept: n === 1 ? pts[0].y : 0, n, span: 0, r2: 0 }

  const stride = Math.max(1, Math.ceil(Math.sqrt((n * (n - 1)) / 2 / 4000)))
  const slopes = []
  for (let i = 0; i < n; i += stride) {
    for (let j = i + 1; j < n; j += stride) {
      const dx = pts[j].x - pts[i].x
      if (dx > 0) slopes.push((pts[j].y - pts[i].y) / dx)
    }
  }
  slopes.sort((a, b) => a - b)
  const slope = slopes.length === 0 ? 0 : median(slopes)
  const intercept = median(pts.map((p) => p.y - slope * p.x))

  const span = pts[n - 1].x - pts[0].x
  const xs = pts.map((p) => p.x)
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = pts.reduce((a, p) => a + p.y, 0) / n
  let ssTot = 0
  let ssRes = 0
  for (const p of pts) {
    ssTot += (p.y - meanY) ** 2
    ssRes += (p.y - (intercept + slope * p.x)) ** 2
  }
  const r2 = ssTot <= 1e-9 ? 0 : Math.max(0, Math.min(1, 1 - ssRes / ssTot))
  return { slope, intercept, n, span, r2 }
}

/** Median of a numeric array (sorted copy, no mutation). */
export function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Cut a sample series at the last window reset and keep only the current cycle.
 * @param {Array<{ t: number, percent: number }>} series ascending by `t`
 * @param {number | null} resetsAtMs when the current window resets
 * @param {number} cycleMs approximate window length used as an early bound
 */
export function currentCycle(series, resetsAtMs, cycleMs) {
  const usable = series.filter((s) => Number.isFinite(s.t) && Number.isFinite(s.percent))
  let start = 0
  for (let i = 1; i < usable.length; i += 1) {
    if (usable[i].percent < usable[i - 1].percent - RESET_DROP) start = i
  }
  let out = usable.slice(start)
  const lowerBound = resetsAtMs === null ? null : resetsAtMs - cycleMs - 60_000
  if (lowerBound !== null) out = out.filter((s) => s.t >= lowerBound)
  return out
}

/**
 * Project one window from a sample series.
 * @param {object} input
 * @param {Array<{ t: number, percent: number }>} input.series
 * @param {number} input.nowMs
 * @param {number | null} input.resetsAtMs
 * @param {number | null} input.endsAtMs subscription end (renewal) time
 * @param {number} input.cycleMs expected window length
 * @param {number} [input.percentNow]
 */
export function projectWindow({ series, nowMs, resetsAtMs, endsAtMs, cycleMs, percentNow }) {
  const cycle = currentCycle(series, resetsAtMs, cycleMs)
  const last = cycle[cycle.length - 1]
  const percent = Number.isFinite(percentNow) ? percentNow : last?.percent
  if (!Number.isFinite(percent)) {
    return { status: 'no-data', sampleCount: 0, spanHours: 0 }
  }

  const points = cycle.map((s) => ({ x: (s.t - nowMs) / HOUR_MS, y: s.percent }))
  const fit = theilSen(points)
  const ratePerHour = fit.slope
  const spanHours = (cycle[cycle.length - 1].t - cycle[0].t) / HOUR_MS
  const sampleCount = cycle.length

  const remaining = Math.max(0, 100 - percent)
  const incomplete = sampleCount < MIN_SAMPLES || spanHours < MIN_SPAN_HOURS
  const idle = !incomplete && ratePerHour <= IDLE_RATE_PER_HOUR

  let etaMs = null
  if (!incomplete && !idle && remaining <= 0) etaMs = nowMs
  else if (!incomplete && !idle && ratePerHour > 0) etaMs = nowMs + (remaining / ratePerHour) * HOUR_MS

  const hoursToExpiry = endsAtMs === null ? null : (endsAtMs - nowMs) / HOUR_MS
  const hoursToReset = resetsAtMs === null ? null : (resetsAtMs - nowMs) / HOUR_MS
  const projectedAtExpiry =
    hoursToExpiry === null || incomplete ? null : clamp(percent + ratePerHour * hoursToExpiry, 0, 999)
  const projectedAtReset =
    hoursToReset === null || incomplete ? null : clamp(percent + ratePerHour * hoursToReset, 0, 999)

  const confidence =
    incomplete ? 'none' : fit.n >= 8 && spanHours >= 24 && fit.r2 >= 0.55 ? 'high' : fit.n >= 4 && spanHours >= 12 ? 'medium' : 'low'

  const verdict = classify({ percent, etaMs, nowMs, resetsAtMs, endsAtMs, incomplete, idle, projectedAtReset })

  return {
    status: 'ok',
    percent,
    remainingPercent: remaining,
    ratePerHour,
    r2: fit.r2,
    sampleCount,
    spanHours,
    confidence,
    incomplete,
    idle,
    etaMs,
    etaIso: etaMs === null ? null : new Date(etaMs).toISOString(),
    resetsAtMs,
    resetsAtIso: resetsAtMs === null ? null : new Date(resetsAtMs).toISOString(),
    endsAtMs,
    endsAtIso: endsAtMs === null ? null : new Date(endsAtMs).toISOString(),
    projectedAtExpiry,
    projectedAtReset,
    verdict,
  }
}

/** Map the projection onto the single headline the UI shows. */
export function classify({ percent, etaMs, nowMs, resetsAtMs, endsAtMs, incomplete, idle, projectedAtReset }) {
  if (percent >= 100) return 'exhausted'
  if (incomplete) return 'insufficient'
  if (idle) return 'idle'
  if (etaMs === null) return 'no-rate'
  if (resetsAtMs !== null && etaMs >= resetsAtMs) return 'safe-reset'
  if (endsAtMs !== null && etaMs <= endsAtMs) return 'before-expiry'
  if (endsAtMs !== null) return 'after-expiry'
  return projectedAtReset !== null && projectedAtReset >= 100 ? 'before-reset' : 'before-expiry'
}

/** Format a duration in hours as a compact Chinese/English-neutral string. */
export function formatDuration(hours) {
  if (!Number.isFinite(hours)) return '—'
  const abs = Math.abs(hours)
  if (abs < 1) return `${Math.max(1, Math.round(abs * 60))}m`
  if (abs < 48) return `${abs.toFixed(abs < 10 ? 1 : 0)}h`
  return `${(abs / 24).toFixed(1)}d`
}

/** Clamp a number into a closed range. */
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n))
}
