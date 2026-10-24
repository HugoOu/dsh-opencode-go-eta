/**
 * Host half of dsh-opencode-go-eta.
 *
 * Samples the two OpenCode Go endpoints sparingly — at a few local anchor
 * times, when a task finishes, at start-up and when the widget asks for a
 * refresh — then builds a local history the Client half uses to estimate when
 * the monthly allowance will run out and how that compares with the renewal
 * date.
 *
 * The key never leaves this process: the browser only reads a same-origin
 * route that answers with percentages, money amounts, reset times and dates.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

import { projectWindow } from './lib/projection.js'
import { loadPricing } from './lib/pricing.js'

export const name = 'opencode-go-eta'
export const inject = ['credentials', 'webServer']

const ROUTE = '/api/dsh-opencode-go-eta/status'
const STORE_VERSION = 1
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

const DEFAULTS = {
  apiKeyRef: 'OPENCODE_GO_API_KEY',
  baseUrl: 'https://opencode.ai',
  usagePath: '/zen/go/v1/usage',
  statusPath: '/console/api/go/status',
  timeoutMs: 15_000,
  /** Minimum gap between implicit samples (anchor misses, turn ends, route reads). */
  sampleIntervalMs: 20 * 60_000,
  /** Local hours at which a sample is due when the Harness is running. */
  anchors: [3, 9, 15, 21],
  /** A route read this far after the last sample triggers a fresh one. */
  staleAfterMs: 45 * 60_000,
  retentionDays: 45,
  /** Price of one Go period used by the renew-vs-API advice. */
  planPriceUsd: 10,
  /** Monthly allowance value when the console status endpoint has no meters. */
  quotaValueFallbackUsd: 60,
  pricingModel: 'deepseek-v4.1-flash',
  /** Shown in the card so the per-model allowance is unambiguous. */
  modelLabel: 'DeepSeek V4.1 Flash',
  planName: 'Go',
  /** Go's own per-token price for the current model (USD / 1M tokens, peak). */
  goModelPrices: { 'deepseek-v4.1-flash': { input: 0.3, output: 1.2 } },
  /** Model-specific monthly allowance from the official Go table (Go plan). */
  modelAllowancesUsd: { 'deepseek-v4.1-flash': 80 },
  pricingUrl: 'https://models.dev/api.json',
  pricingTtlMs: 43_200_000,
  pricingFallback: null,
  maxSamples: 4000,
  enabled: true,
}

const WINDOW_CYCLE_MS = {
  rolling: 5 * HOUR_MS,
  weekly: 7 * DAY_MS,
  monthly: 30 * DAY_MS,
}

export function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig && typeof rawConfig === 'object' ? rawConfig : {}) }
  if (config.enabled === false) return

  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  const storeDir = path.join(home, 'opencode-go-eta')
  const storeFile = path.join(storeDir, 'samples.json')
  const pricingFile = path.join(storeDir, 'pricing-cache.json')
  let pricing = null
  let pricingInflight = null
  let pricingAttemptAt = 0

  async function ensurePricing(force = false) {
    const now = Date.now()
    if (!force && pricing !== null && now - pricingAttemptAt < config.pricingTtlMs) return pricing
    if (!force && pricing === null && now - pricingAttemptAt < 10 * 60_000) return null
    if (pricingInflight !== null) return pricingInflight
    pricingAttemptAt = now
    pricingInflight = loadPricing({
      model: config.pricingModel,
      url: config.pricingUrl,
      cacheFile: pricingFile,
      ttlMs: config.pricingTtlMs,
      fallback: config.pricingFallback,
    }).then(
      (result) => {
        pricing = result
        pricingInflight = null
        return result
      },
      () => {
        pricingInflight = null
        return null
      },
    )
    return pricingInflight
  }

  /** @type {Array<{t:number, usage:any, money:any, plan:any}>} */
  let samples = []
  let lastAttemptAt = 0
  let lastError = null
  let lastWarning = null
  let lastErrorAt = 0
  let lastSource = 'never'
  let loading = loadStore()

  async function loadStore() {
    try {
      const text = await fs.readFile(storeFile, 'utf8')
      const parsed = JSON.parse(text)
      if (parsed && parsed.version === STORE_VERSION && Array.isArray(parsed.samples)) {
        samples = parsed.samples.filter((s) => Number.isFinite(s?.t))
      }
    } catch {
      samples = []
    }
  }

  let saveTimer = null
  let saving = null
  function scheduleSave() {
    if (saveTimer !== null) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      saving = persist().catch(() => {})
    }, 1500)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
  }

  async function persist() {
    const cutoff = Date.now() - config.retentionDays * DAY_MS
    samples = samples.filter((s) => s.t >= cutoff).slice(-config.maxSamples)
    const body = JSON.stringify({ version: STORE_VERSION, savedAt: Date.now(), samples })
    try {
      await fs.mkdir(storeDir, { recursive: true })
      const tmp = `${storeFile}.tmp`
      await fs.writeFile(tmp, body, 'utf8')
      await fs.rename(tmp, storeFile)
    } catch {
      /* sampling still works from memory when the disk is unavailable */
    }
  }

  function endpoint(suffix) {
    const base = String(config.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, '')
    return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`
  }

  async function resolveKey() {
    const ref = config.apiKeyRef || DEFAULTS.apiKeyRef
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const resolved = await credentials.resolve(ref)
        const value = resolved && typeof resolved.value === 'string' ? resolved.value : undefined
        if (value) return value
      } catch {
        /* fall through to the environment */
      }
    }
    const ambient = process.env[ref]
    return typeof ambient === 'string' && ambient.length > 0 ? ambient : undefined
  }

  async function getJson(url, key, signal) {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal,
    })
    if (!response.ok) {
      let detail = ''
      try {
        const body = await response.json()
        detail = typeof body?.error === 'string' ? body.error : body?.error?.message ?? body?.message ?? ''
      } catch {
        detail = ''
      }
      const error = new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
      error.status = response.status
      throw error
    }
    return response.json()
  }

  function num(value) {
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
    return Number.isFinite(n) ? n : null
  }

  function normalizeUsage(payload) {
    const usage = payload?.usage ?? payload
    const out = {}
    for (const key of ['rolling', 'weekly', 'monthly']) {
      const raw = usage?.[key]
      if (raw === undefined || raw === null) continue
      out[key] = {
        percent: num(raw.percent ?? raw.usedPercent ?? raw.used_percent),
        resetsAt: typeof raw.resetsAt === 'string' ? raw.resetsAt : typeof raw.resets_at === 'string' ? raw.resets_at : null,
        status: typeof raw.status === 'string' ? raw.status : null,
      }
    }
    return out
  }

  function normalizeStatus(payload) {
    const access = payload?.access ?? payload
    const meters = access?.meters ?? {}
    const out = { meters: {}, startsAt: null, endsAt: null, cancelAtPeriodEnd: null, renewalPending: null }
    const names = { rolling: ['fiveHour', 'fivehour', 'rolling'], weekly: ['week', 'weekly'], monthly: ['month', 'monthly'] }
    for (const [key, candidates] of Object.entries(names)) {
      for (const candidate of candidates) {
        const raw = meters[candidate]
        if (raw === undefined || raw === null) continue
        out.meters[key] = {
          usedMicroCents: num(raw.usedMicroCents ?? raw.used_micro_cents),
          limitMicroCents: num(raw.limitMicroCents ?? raw.limit_micro_cents),
        }
        break
      }
    }
    out.startsAt = typeof access?.startsAt === 'string' ? access.startsAt : null
    out.endsAt = typeof access?.endsAt === 'string' ? access.endsAt : null
    out.cancelAtPeriodEnd = typeof access?.cancelAtPeriodEnd === 'boolean' ? access.cancelAtPeriodEnd : null
    out.renewalPending = typeof access?.renewalPending === 'boolean' ? access.renewalPending : null
    out.paymentMethodKind = typeof access?.paymentMethodKind === 'string' ? access.paymentMethodKind : null
    out.useBalance = typeof access?.useBalance === 'boolean' ? access.useBalance : null
    return out
  }

  /** Percent per window, preferring the official usage percentage. */
  function windowPercent(usage, status, key) {
    const direct = usage?.[key]?.percent
    if (Number.isFinite(direct)) return direct
    const meter = status?.meters?.[key]
    if (meter && Number.isFinite(meter.usedMicroCents) && Number.isFinite(meter.limitMicroCents) && meter.limitMicroCents > 0) {
      return (meter.usedMicroCents / meter.limitMicroCents) * 100
    }
    return null
  }

  async function sample(reason, options = {}) {
    const now = Date.now()
    const minInterval = options.force === true ? 60_000 : config.sampleIntervalMs
    if (!options.force && now - lastAttemptAt < minInterval) return { skipped: 'fresh' }
    lastAttemptAt = now

    const key = await resolveKey()
    if (!key) {
      lastError = 'missing-key'
      lastErrorAt = now
      lastSource = 'error'
      return { skipped: 'missing-key' }
    }

    const signal = AbortSignal.timeout(config.timeoutMs)
    const [usageResult, statusResult] = await Promise.allSettled([
      getJson(endpoint(config.usagePath), key, signal),
      config.statusPath === false ? Promise.reject(new Error('disabled')) : getJson(endpoint(config.statusPath), key, signal),
    ])

    const usage = usageResult.status === 'fulfilled' ? normalizeUsage(usageResult.value) : null
    const status = statusResult.status === 'fulfilled' ? normalizeStatus(statusResult.value) : null
    if (usage === null && status === null) {
      const failure = usageResult.status === 'rejected' ? usageResult.reason : statusResult.reason
      lastError = describeError(failure)
      lastWarning = null
      lastErrorAt = now
      lastSource = 'error'
      return { skipped: 'error', error: lastError }
    }

    const entry = {
      t: now,
      reason,
      usage: usage ?? {},
      money: status ? status.meters : {},
      plan: status
        ? { startsAt: status.startsAt, endsAt: status.endsAt, cancelAtPeriodEnd: status.cancelAtPeriodEnd, renewalPending: status.renewalPending }
        : null,
    }
    samples.push(entry)
    // A failed console-status call still leaves the percentage series usable;
    // only a failed usage call makes the reading partial.
    lastError = usageResult.status === 'rejected' ? describeError(usageResult.reason) : null
    lastWarning = statusResult.status === 'rejected' ? describeError(statusResult.reason) : null
    lastErrorAt = lastError === null ? 0 : now
    lastSource = 'live'
    scheduleSave()
    void ensurePricing(false)
    return { saved: entry }
  }

  function describeError(error) {
    const status = error && typeof error.status === 'number' ? error.status : null
    if (status === 401 || status === 403) return 'unauthorized'
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout'
    if (status !== null) return `http-${status}`
    return 'network'
  }

  function seriesFor(key) {
    const out = []
    for (const sampleEntry of samples) {
      const percent = windowPercent(sampleEntry.usage, { meters: sampleEntry.money }, key)
      if (percent === null) continue
      out.push({ t: sampleEntry.t, percent })
    }
    return out
  }

  function buildSnapshot() {
    const now = Date.now()
    const latest = samples[samples.length - 1]
    const usage = latest?.usage ?? {}
    const money = latest?.money ?? {}
    const plan = latest?.plan ?? null

    const windows = {}
    for (const key of ['rolling', 'weekly', 'monthly']) {
      windows[key] = {
        percent: latest ? windowPercent(usage, { meters: money }, key) : null,
        resetsAt: usage?.[key]?.resetsAt ?? null,
        usedMicroCents: money?.[key]?.usedMicroCents ?? null,
        limitMicroCents: money?.[key]?.limitMicroCents ?? null,
      }
    }

    const endsAtMs = plan?.endsAt ? Date.parse(plan.endsAt) : null
    const deductions = {}
    for (const key of ['rolling', 'weekly', 'monthly']) {
      const resetsAtMs = windows[key].resetsAt ? Date.parse(windows[key].resetsAt) : null
      deductions[key] = projectWindow({
        series: seriesFor(key),
        nowMs: now,
        resetsAtMs: Number.isFinite(resetsAtMs) ? resetsAtMs : null,
        endsAtMs: key === 'monthly' && Number.isFinite(endsAtMs) ? endsAtMs : null,
        cycleMs: WINDOW_CYCLE_MS[key],
        percentNow: windows[key].percent ?? undefined,
      })
    }

    const series = {}
    for (const key of ['rolling', 'weekly', 'monthly']) {
      const all = seriesFor(key).filter((point) => point.t >= now - 14 * DAY_MS)
      const stride = Math.max(1, Math.ceil(all.length / 90))
      series[key] = all.filter((_, index) => index % stride === 0).map((point) => ({
        t: point.t,
        percent: Math.round(point.percent * 100) / 100,
      }))
    }

    const monthly = deductions.monthly

    // Renew-vs-official-API advice, only when the quota is projected to run
    // out before the renewal date. Amounts use the quota's own dollar meter
    // (usedMicroCents/limitMicroCents) so no token history is required; the
    // token estimate additionally uses the current model's public price.
    const meterLimitUsd = Number.isFinite(windows.monthly.limitMicroCents)
      ? windows.monthly.limitMicroCents / 1e8
      : Number.isFinite(config.quotaValueFallbackUsd) ? config.quotaValueFallbackUsd : 60
    // The console meter is a plan-credit cap; the official Go table lists a
    // different monthly allowance per model (V4.1 Flash: $80 on Go). Prefer the
    // model table for displayed money and the cost advice.
    const configuredAllowance = config.modelAllowancesUsd && typeof config.modelAllowancesUsd === 'object'
      ? config.modelAllowancesUsd[String(config.pricingModel).toLowerCase()]
      : undefined
    const allowanceUsd = Number.isFinite(configuredAllowance) ? configuredAllowance : meterLimitUsd
    let advice = null
    if (monthly.verdict === 'before-expiry' && Number.isFinite(monthly.projectedAtExpiry)) {
      const overflowPercent = Math.max(0, monthly.projectedAtExpiry - 100)
      const overflowUsd = (overflowPercent / 100) * allowanceUsd
      const planPriceUsd = Number.isFinite(config.planPriceUsd) ? config.planPriceUsd : 10
      const price = pricing
      const blendedOfficial = price && Number.isFinite(price.input) && Number.isFinite(price.output)
        ? (price.input + 3 * price.output) / 4
        : null
      const tokensEstimate = blendedOfficial !== null && blendedOfficial > 0
        ? (overflowUsd / blendedOfficial) * 1e6
        : null
      const officialUsd = overflowUsd
      advice = {
        overflowPercent,
        overflowUsd,
        limitUsd: allowanceUsd,
        planPriceUsd,
        recommendation: officialUsd < planPriceUsd ? 'api' : 'renew',
        officialUsd,
        tokensEstimate,
        pricing: price
          ? {
              model: price.model,
              input: price.input,
              output: price.output,
              source: price.source,
              fetchedAt: price.fetchedAt ? new Date(price.fetchedAt).toISOString() : null,
            }
          : null,
      }
    }
    const projection = {
      ...monthly,
      generatedAt: new Date(now).toISOString(),
      /** Whole-subscription view used by the headline. */
      plan: plan
        ? {
            startsAt: plan.startsAt,
            endsAt: plan.endsAt,
            cancelAtPeriodEnd: plan.cancelAtPeriodEnd,
            renewalPending: plan.renewalPending,
            daysLeft: Number.isFinite(endsAtMs) ? (endsAtMs - now) / DAY_MS : null,
          }
        : null,
      windows: deductions,
    }

    return {
      ok: latest !== undefined,
      version: 1,
      now: new Date(now).toISOString(),
      fetchedAt: latest ? new Date(latest.t).toISOString() : null,
      source: lastSource,
      error: lastError,
      warning: lastWarning,
      errorAt: lastErrorAt > 0 ? new Date(lastErrorAt).toISOString() : null,
      stale: latest === undefined || now - latest.t > config.staleAfterMs,
      model: config.modelLabel,
      planName: config.planName,
      allowanceUsd,
      windows,
      projection,
      series,
      advice,
      pricing: pricing
        ? {
            model: pricing.model,
            input: pricing.input,
            output: pricing.output,
            source: pricing.source,
            fetchedAt: pricing.fetchedAt ? new Date(pricing.fetchedAt).toISOString() : null,
          }
        : null,
      sample: {
        count: samples.length,
        spanHours: samples.length > 1 ? (samples[samples.length - 1].t - samples[0].t) / HOUR_MS : 0,
        firstAt: samples.length > 0 ? new Date(samples[0].t).toISOString() : null,
        lastAt: latest ? new Date(latest.t).toISOString() : null,
        cadence: { anchors: config.anchors, sampleIntervalMs: config.sampleIntervalMs, staleAfterMs: config.staleAfterMs },
      },
    }
  }

  function sendJson(res, statusCode, body) {
    const text = JSON.stringify(body)
    res.writeHead(statusCode, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(text),
    })
    res.end(text)
  }

  function isLoopback(req) {
    const address = req?.socket?.remoteAddress ?? ''
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  }

  async function handleRequest(req, res) {
    try {
      if ((req.method ?? 'GET') !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      if (!isLoopback(req)) {
        sendJson(res, 403, { ok: false, error: 'loopback-only' })
        return
      }
      const url = new URL(req.url ?? ROUTE, 'http://127.0.0.1')
      await loading
      void ensurePricing(url.searchParams.get('refresh') === '1')
      if (url.searchParams.get('refresh') === '1' || buildSnapshot().stale) {
        await sample('route', { force: url.searchParams.get('refresh') === '1' })
      }
      const snapshot = buildSnapshot()
      snapshot.sample.count = samples.length
      sendJson(res, 200, snapshot)
    } catch (error) {
      sendJson(res, 500, { ok: false, error: 'internal', message: String(error && error.message ? error.message : error) })
    }
  }

  // Sampling at a handful of local anchor hours; the timer itself never talks
  // to the network unless an anchor (or a task boundary) makes a sample due.
  let anchorTimer = null
  function dueAnchor(nowMs) {
    if (!Array.isArray(config.anchors) || config.anchors.length === 0) return false
    const now = new Date(nowMs)
    let latest = null
    for (const hour of config.anchors) {
      const candidate = new Date(now)
      candidate.setHours(hour, 0, 0, 0)
      if (candidate.getTime() <= nowMs && (latest === null || candidate.getTime() > latest)) latest = candidate.getTime()
    }
    if (latest === null) return false
    const lastSampleAt = samples.length > 0 ? samples[samples.length - 1].t : 0
    return lastSampleAt < latest
  }

  ctx.effect(() => {
    anchorTimer = setInterval(() => {
      if (dueAnchor(Date.now())) void sample('anchor')
    }, 5 * 60_000)
    if (typeof anchorTimer.unref === 'function') anchorTimer.unref()
    return () => {
      if (anchorTimer !== null) clearInterval(anchorTimer)
    }
  }, 'opencode-go-eta: anchor timer')

  ctx.effect(() => {
    const timer = setTimeout(() => {
      void sample('start')
      void ensurePricing(false)
    }, 4000)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearTimeout(timer)
  }, 'opencode-go-eta: start sample')

  // A finished task is a natural sampling boundary; the listener tolerates
  // Harness builds whose session feed does not reach this context.
  ctx.effect(
    () =>
      ctx.on('session/event', (_session, event) => {
        if (event && event.type === 'turn/end') void sample('turn-end')
      }),
    'opencode-go-eta: turn-end sample',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: ROUTE,
        handler: handleRequest,
      }),
    'opencode-go-eta: status route',
  )

  ctx.effect(() => () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    void persist()
  }, 'opencode-go-eta: flush samples')
}
