/**
 * Official API pricing for the "renew vs. pay-as-you-go" advice.
 *
 * Prices come from the public models.dev catalogue (USD per 1M tokens),
 * fetched lazily and cached on disk. When the catalogue is unreachable the
 * plugin still offers the quota-value comparison and marks token estimates as
 * unavailable — it never invents a price.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_TTL_MS = 12 * 3_600_000

/**
 * @param {object} options
 * @param {string} options.model model id to look up (for example deepseek-v4.1-flash)
 * @param {string} [options.url]
 * @param {string} [options.cacheFile]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.ttlMs]
 * @param {{ input: number, output: number, cacheRead?: number }} [options.fallback]
 */
export async function loadPricing({ model, url = 'https://models.dev/api.json', cacheFile, timeoutMs = 12_000, ttlMs = DEFAULT_TTL_MS, fallback }) {
  const cached = await readCache(cacheFile)
  if (cached !== null && Date.now() - cached.at < ttlMs) {
    const hit = findModel(cached.data, model)
    if (hit !== null) return normalize(hit, 'cache', cached.at)
  }

  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    const hit = findModel(data, model)
    if (hit !== null) {
      await writeCache(cacheFile, data)
      return normalize(hit, 'models.dev', Date.now())
    }
    throw new Error('model-not-found')
  } catch (error) {
    if (cached !== null) {
      const hit = findModel(cached.data, model)
      if (hit !== null) return normalize(hit, 'cache-stale', cached.at)
    }
    if (fallback && Number.isFinite(fallback.input) && Number.isFinite(fallback.output)) {
      return {
        model,
        input: fallback.input,
        output: fallback.output,
        cacheRead: Number.isFinite(fallback.cacheRead) ? fallback.cacheRead : null,
        source: 'config',
        fetchedAt: null,
        error: String(error && error.message ? error.message : error),
      }
    }
    return { model, input: null, output: null, cacheRead: null, source: 'unavailable', fetchedAt: null, error: String(error && error.message ? error.message : error) }
  }
}

function normalize(model, source, fetchedAt) {
  return {
    model: model.id,
    input: Number.isFinite(model.cost?.input) ? model.cost.input : null,
    output: Number.isFinite(model.cost?.output) ? model.cost.output : null,
    cacheRead: Number.isFinite(model.cost?.cache_read) ? model.cost.cache_read : null,
    source,
    fetchedAt,
    error: null,
  }
}

/**
 * models.dev publishes `{ providerId: { models: { [id]: { id, cost } } } }`.
 * Prefer the `deepseek` provider, then any provider that has the exact id.
 */
export function findModel(catalog, model) {
  if (catalog === null || typeof catalog !== 'object' || typeof model !== 'string' || model.length === 0) return null
  const wanted = model.toLowerCase()
  let loose = null
  for (const [providerId, provider] of Object.entries(catalog)) {
    const models = provider && typeof provider === 'object' ? provider.models : null
    if (models === null || typeof models !== 'object') continue
    for (const [id, entry] of Object.entries(models)) {
      if (entry === null || typeof entry !== 'object') continue
      const candidate = { ...entry, id: typeof entry.id === 'string' ? entry.id : id }
      const match = `${candidate.id}`.toLowerCase()
      if (match === wanted || id.toLowerCase() === wanted) {
        if (providerId === 'deepseek') return candidate
        if (loose === null) loose = candidate
      }
    }
  }
  return loose
}

async function readCache(file) {
  if (!file) return null
  try {
    const text = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && typeof parsed.at === 'number' && parsed.data) return parsed
    return null
  } catch {
    return null
  }
}

async function writeCache(file, data) {
  if (!file) return
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ at: Date.now(), data }), 'utf8')
  } catch {
    /* cache is best-effort */
  }
}
