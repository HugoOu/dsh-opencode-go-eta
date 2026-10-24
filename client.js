/**
 * Client half of dsh-opencode-go-eta — Apple-flavoured visual layer.
 *
 * One compact capsule below the composer and one floating dashboard card in
 * the frame-wide overlay layer. Both read the same host route; no key and no
 * upstream request lives in the browser.
 */
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-eta',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const ROUTE = '/api/dsh-opencode-go-eta/status'
    const SLOT_PILL = 'conversation.composer.dock'
    const SLOT_PANEL = 'shell.overlay'
    const REFRESH_MS = 10 * 60 * 1000
    const YIELD_MS = 5 * 60 * 1000
    const DAY = 86_400_000

    const lang = (document.documentElement.getAttribute('lang') || navigator.language || 'zh').toLowerCase()
    const ZH = lang.startsWith('zh')
    const t = (zh, en) => (ZH ? zh : en)

    // Restrained palette: ink + harp strings. One indigo accent carries the
    // data; state colours appear only as 6–8px dots, never as large fills.
    // References: Apple HIG "use color sparingly, prefer a single system tint";
    // Radix Colors slate + indigo scales; Carbon's monochromatic trend palettes.
    const SYS = { accent: '#6b86e8', good: '#30a46c', warn: '#e5a000', bad: '#e5484d', neutral: '#8e8e93' }
    const GOOD = SYS.good
    const WARN = SYS.warn
    const BAD = SYS.bad
    const NEUTRAL = SYS.neutral
    // Liquid glass follows the Harness colour scheme: the dark variant dims
    // every white specular layer and lifts the accent, so text and charts keep
    // contrast on a dark surface.
    let scheme = 'light'
    function accent() {
      return scheme === 'dark' ? '#aab8ff' : '#6b86e8'
    }
    function applyScheme(value) {
      const next = value === 'dark' ? 'dark' : 'light'
      if (next === scheme) return
      scheme = next
      publish({})
    }

    // ---------------------------------------------------------------- store
    let state = { open: false, data: null, loading: false, error: null, requestedAt: 0 }
    const listeners = new Set()
    const snapshot = () => state
    function publish(patch) {
      state = { ...state, ...patch }
      for (const listener of listeners) listener()
    }
    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    let inflight = null
    function load(force) {
      if (inflight) return inflight
      publish({ loading: true })
      inflight = (async () => {
        try {
          const response = await fetch(`${ROUTE}${force ? '?refresh=1' : ''}`, {
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          publish({
            data,
            loading: false,
            error: data && data.ok ? data.error ?? null : (data && data.error) ?? 'no-data',
            requestedAt: Date.now(),
          })
        } catch (error) {
          publish({ loading: false, error: String((error && error.message) || error) })
        } finally {
          inflight = null
        }
      })()
      return inflight
    }
    function ensureFresh() {
      if (state.requestedAt === 0 || Date.now() - state.requestedAt > YIELD_MS) load(false)
    }
    function open() {
      publish({ open: true })
      ensureFresh()
    }
    function close() {
      publish({ open: false })
    }
    function toggle() {
      if (state.open) close()
      else open()
    }

    function useStore() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(subscribe, snapshot, snapshot)
      }
      const [local, setLocal] = React.useState(snapshot())
      React.useEffect(() => subscribe(() => setLocal(snapshot())), [])
      return local
    }

    // ------------------------------------------------------------ formatting
    function pct(value, digits = 0) {
      if (!Number.isFinite(value)) return '—'
      return `${digits > 0 ? value.toFixed(digits) : Math.round(value)}%`
    }
    function shortDate(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '—'
      return `${date.getMonth() + 1}/${date.getDate()}`
    }
    function dateTime(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) return '—'
      const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      const day = ZH ? `${date.getMonth() + 1}月${date.getDate()}日` : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return `${day} ${time}`
    }
    function money(microCents) {
      if (!Number.isFinite(microCents)) return null
      return `$${(microCents / 1e8).toFixed(2)}`
    }
    function spanLabel(hours) {
      if (!Number.isFinite(hours) || hours <= 0) return '—'
      if (hours < 48) return t(`${hours.toFixed(hours < 10 ? 1 : 0)} 小时`, `${hours.toFixed(hours < 10 ? 1 : 0)}h`)
      return t(`${(hours / 24).toFixed(1)} 天`, `${(hours / 24).toFixed(1)}d`)
    }
    function confidenceLabel(level) {
      if (level === 'high') return t('高', 'high')
      if (level === 'medium') return t('中', 'medium')
      if (level === 'low') return t('低', 'low')
      return t('样本不足', 'insufficient')
    }
    function clock(iso) {
      if (!iso) return '—'
      const date = new Date(iso)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    }

    // ---------------------------------------------------------------- styles
    const css = `
.ogeta-root {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI Variable", "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  font-variant-numeric: tabular-nums;
}
/* Matches the shipped ContextMeter trigger: same 14px ring, 2px stroke,
   same padding, font size and line height, so the two rings read as peers. */
.ogeta-pill {
  flex: none; white-space: nowrap; display: inline-flex; align-items: center; gap: 6px;
  padding: 1px 8px; margin: 0; border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: transparent; color: var(--dsw-alias-label-tertiary, #86868b); cursor: pointer;
  font: inherit; font-size: var(--dsh-content-font-size-secondary, 13px);
  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));
  font-variant-numeric: tabular-nums; transition: background .16s ease, color .16s ease;
}
.ogeta-pill:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); color: var(--dsw-alias-label-secondary, #515154); }
.ogeta-pill:active { transform: scale(.98); }
.ogeta-pill:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, ${accent()} 45%, transparent); }
.ogeta-pill-brand { color: var(--dsw-alias-label-tertiary, #86868b); }
.ogeta-pill-value { color: var(--dsw-alias-label-primary, #1d1d1f); font-weight: 500; }

.ogeta-layer { position: fixed; inset: 0; pointer-events: none; z-index: 60; }
.ogeta-panel {
  --ogeta-surface: var(--dsw-alias-settings-card-fill, #ffffff);
  --ogeta-raise: var(--dsw-alias-bg-layer-2, rgba(0,0,0,.035));
  --ogeta-text: var(--dsw-alias-label-primary, #1d1d1f);
  --ogeta-muted: var(--dsw-alias-label-secondary, #515154);
  --ogeta-faint: var(--dsw-alias-label-tertiary, #86868b);
  --ogeta-line: var(--dsw-alias-border-l1, rgba(0,0,0,.07));
  --ogeta-line-strong: var(--dsw-alias-border-l2, rgba(0,0,0,.13));
  --ogeta-accent: ${accent()};
  --ogeta-track: color-mix(in srgb, var(--ogeta-text) 10%, transparent);
  position: fixed; right: 22px; bottom: 22px; width: min(396px, calc(100vw - 32px));
  max-height: min(88vh, 760px); overflow: auto; overscroll-behavior: contain;
  pointer-events: auto; box-sizing: border-box; padding: 18px 18px 14px;
  border-radius: 26px; color: var(--ogeta-text); font-size: 13px; line-height: 1.42;
  background:
    radial-gradient(95% 62% at 16% -12%, rgba(255,255,255,.58), rgba(255,255,255,0) 62%) padding-box,
    linear-gradient(112deg, rgba(255,255,255,.10) 28%, rgba(255,255,255,.20) 44%, rgba(255,255,255,.03) 58%) padding-box,
    linear-gradient(162deg, color-mix(in srgb, var(--ogeta-surface) 72%, transparent), color-mix(in srgb, var(--ogeta-surface) 56%, transparent)) padding-box,
    linear-gradient(146deg, rgba(255,255,255,.95), rgba(255,255,255,.30) 30%, rgba(255,255,255,.06) 57%, rgba(255,255,255,.58)) border-box;
  border: 1px solid transparent;
  box-shadow:
    0 44px 120px rgba(0,0,0,.30),
    0 14px 36px rgba(0,0,0,.12),
    0 2px 6px rgba(0,0,0,.05),
    inset 0 1px 0 rgba(255,255,255,.78),
    inset 0 -1px 0 rgba(255,255,255,.20),
    inset 0 26px 60px -40px rgba(255,255,255,.65),
    inset 0 -30px 60px -50px rgba(0,0,0,.35);
  -webkit-backdrop-filter: blur(42px) saturate(2.05) brightness(1.06); backdrop-filter: blur(42px) saturate(2.05) brightness(1.06);
  animation: ogeta-in .3s cubic-bezier(.3,.7,.3,1) both;
  scrollbar-width: thin;
}
/* Dark glass: same material, no bright white layers over the text. */
.ogeta-panel--dark {
  background:
    radial-gradient(95% 62% at 16% -12%, rgba(255,255,255,.07), rgba(255,255,255,0) 62%) padding-box,
    linear-gradient(112deg, rgba(255,255,255,.02) 28%, rgba(255,255,255,.05) 44%, rgba(255,255,255,0) 58%) padding-box,
    linear-gradient(162deg, color-mix(in srgb, var(--ogeta-surface) 94%, transparent), color-mix(in srgb, var(--ogeta-surface) 88%, transparent)) padding-box,
    linear-gradient(146deg, rgba(255,255,255,.24), rgba(255,255,255,.09) 32%, rgba(255,255,255,.02) 60%, rgba(255,255,255,.13)) border-box;
  box-shadow:
    0 44px 120px rgba(0,0,0,.6),
    0 14px 36px rgba(0,0,0,.4),
    0 2px 6px rgba(0,0,0,.3),
    inset 0 1px 0 rgba(255,255,255,.14),
    inset 0 -1px 0 rgba(255,255,255,.04);
  -webkit-backdrop-filter: blur(36px) saturate(1.5) brightness(1); backdrop-filter: blur(36px) saturate(1.5) brightness(1);
}
.ogeta-panel--dark .ogeta-mark { background: linear-gradient(150deg, rgba(255,255,255,.08), rgba(255,255,255,.02));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.14); }
.ogeta-panel--dark .ogeta-chip { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.1);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08); }
.ogeta-panel--dark .ogeta-iconbtn { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.12);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.1); }
@keyframes ogeta-in { from { opacity: 0; transform: translateY(12px) scale(.97); } to { opacity: 1; transform: none; } }
.ogeta-head { display: flex; align-items: flex-start; gap: 10px; }
.ogeta-head-main { display: flex; align-items: center; gap: 11px; flex: 1; min-width: 0; }
.ogeta-mark { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: 12px;
  background:
    radial-gradient(120% 120% at 22% -20%, rgba(255,255,255,.85), rgba(255,255,255,0) 60%) padding-box,
    linear-gradient(150deg, color-mix(in srgb, ${accent()} 16%, white), color-mix(in srgb, ${accent()} 9%, transparent)) padding-box;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.5), inset 0 -6px 12px -8px color-mix(in srgb, ${accent()} 40%, transparent); }
.ogeta-title { font-size: 15px; font-weight: 650; letter-spacing: -.015em; margin: 0; }
.ogeta-subtitle { color: var(--ogeta-faint); font-size: 11.5px; letter-spacing: -.005em; margin-top: 1px; }
.ogeta-actions { display: flex; align-items: center; gap: 5px; flex: none; }
.ogeta-chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border-radius: 999px;
  background: linear-gradient(150deg, rgba(255,255,255,.5), rgba(255,255,255,.06)) padding-box,
    linear-gradient(140deg, rgba(255,255,255,.75), rgba(255,255,255,.12), rgba(255,255,255,.4)) border-box;
  border: 1px solid transparent; color: var(--ogeta-muted);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.55);
  font-size: 11.5px; font-weight: 500; white-space: nowrap; letter-spacing: -.005em; }
.ogeta-iconbtn { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.28); color: var(--ogeta-faint); cursor: pointer;
  background: linear-gradient(150deg, rgba(255,255,255,.42), rgba(255,255,255,.05));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 1px 2px rgba(0,0,0,.05);
  transition: background .16s ease, color .16s ease, transform .16s ease, box-shadow .16s ease; }
.ogeta-iconbtn:hover { background: color-mix(in srgb, var(--ogeta-text) 7%, transparent); color: var(--ogeta-text); }
.ogeta-iconbtn:active { transform: scale(.94); }
.ogeta-iconbtn:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, ${accent()} 35%, transparent); }
.ogeta-spin { animation: ogeta-spin .9s linear infinite; }
@keyframes ogeta-spin { to { transform: rotate(360deg); } }

.ogeta-hero { display: flex; align-items: center; gap: 18px; margin: 18px 0 6px; }
.ogeta-rings { position: relative; width: 132px; height: 132px; flex: none; }
.ogeta-rings-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; }
.ogeta-big { font-size: 31px; font-weight: 660; letter-spacing: -.035em; line-height: 1; }
.ogeta-big small { font-size: 15px; font-weight: 600; letter-spacing: -.02em; margin-left: 1px; opacity: .62; }
.ogeta-big-cap { font-size: 10.5px; font-weight: 500; color: var(--ogeta-faint); letter-spacing: .01em; margin-top: 3px; }
.ogeta-figures { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-end; text-align: right; gap: 6px; }
.ogeta-figures { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: stretch; gap: 6px; }
.ogeta-figrow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  color: var(--ogeta-muted); font-size: 11.5px; white-space: nowrap; }
.ogeta-figrow b { color: var(--ogeta-text); font-weight: 600; }
.ogeta-figrow-strong { color: var(--ogeta-text); font-weight: 600; font-size: 12px; }
.ogeta-figrow-strong i { color: var(--ogeta-faint); font-style: normal; font-weight: 500; }
.ogeta-remaining { display: flex; align-items: baseline; gap: 5px; }
.ogeta-remaining b { font-size: 30px; font-weight: 660; letter-spacing: -.04em; line-height: 1; }
.ogeta-remaining span { color: var(--ogeta-faint); font-size: 12px; }
.ogeta-money { display: flex; align-items: baseline; justify-content: flex-end; gap: 6px; }
.ogeta-money b { font-size: 20px; font-weight: 620; letter-spacing: -.025em; }
.ogeta-money span { color: var(--ogeta-faint); font-size: 12px; letter-spacing: -.01em; }
.ogeta-figline { display: flex; align-items: center; justify-content: flex-end; gap: 7px; color: var(--ogeta-muted); font-size: 12px; letter-spacing: -.005em; }
.ogeta-figline b { color: var(--ogeta-text); font-weight: 600; }
.ogeta-dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
.ogeta-legend { display: flex; align-items: center; gap: 12px; margin-top: 4px; flex-wrap: wrap; }
.ogeta-legend span { display: inline-flex; align-items: center; gap: 5px; color: var(--ogeta-muted); font-size: 11.5px; letter-spacing: -.005em; }
.ogeta-legend i { width: 7px; height: 7px; border-radius: 50%; }

.ogeta-verdict { display: flex; gap: 10px; align-items: flex-start; margin: 16px 2px 4px; }
.ogeta-verdict-dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; flex: none;
  box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 13%, transparent); }
.ogeta-verdict-main { font-size: 14.5px; font-weight: 600; letter-spacing: -.015em; }
.ogeta-verdict-sub { margin-top: 2px; color: var(--ogeta-muted); font-size: 12px; letter-spacing: -.005em; }
.ogeta-verdict--warn { color: ${SYS.warn}; }
.ogeta-verdict--bad { color: ${SYS.bad}; }
.ogeta-verdict--good { color: ${SYS.good}; }
.ogeta-verdict--muted { color: var(--ogeta-muted); }
.ogeta-verdict--warn .ogeta-verdict-main { color: var(--ogeta-text); }
.ogeta-verdict--bad .ogeta-verdict-main { color: var(--ogeta-text); }
.ogeta-verdict--good .ogeta-verdict-main { color: var(--ogeta-text); }

.ogeta-section { margin-top: 18px; }
.ogeta-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
.ogeta-section-title { font-size: 12px; font-weight: 600; letter-spacing: -.005em; color: var(--ogeta-muted); }
.ogeta-section-note { font-size: 11px; color: var(--ogeta-faint); letter-spacing: -.005em; }
.ogeta-timeline { position: relative; height: 30px; margin: 0 1px 4px; }
.ogeta-tl-track { position: absolute; left: 0; right: 0; top: 13px; height: 5px; border-radius: 999px; background: var(--ogeta-track); }
.ogeta-tl-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px;
  background: linear-gradient(90deg, color-mix(in srgb, ${accent()} 55%, transparent), ${accent()}); }
.ogeta-tl-proj { position: absolute; top: 1px; bottom: 1px; border-radius: 999px;
  background: repeating-linear-gradient(90deg, color-mix(in srgb, ${SYS.neutral} 38%, transparent) 0 4px, transparent 4px 8px); }
.ogeta-tl-mark { position: absolute; top: 50%; transform: translate(-50%, -50%); }
.ogeta-tl-now { width: 10px; height: 10px; border-radius: 50%; background: var(--ogeta-surface);
  box-shadow: 0 0 0 2px ${accent()}, 0 1px 4px rgba(0,0,0,.18); }
.ogeta-tl-eta { width: 11px; height: 11px; border-radius: 50%; background: ${SYS.warn};
  box-shadow: 0 0 0 4px color-mix(in srgb, ${SYS.warn} 18%, transparent); animation: ogeta-pulse 2.6s ease-in-out infinite; }
.ogeta-tl-eta--good { background: ${SYS.good}; box-shadow: 0 0 0 4px color-mix(in srgb, ${SYS.good} 18%, transparent); animation: none; }
@keyframes ogeta-pulse { 0%,100% { box-shadow: 0 0 0 3px color-mix(in srgb, ${SYS.warn} 10%, transparent); } 50% { box-shadow: 0 0 0 8px color-mix(in srgb, ${SYS.warn} 16%, transparent); } }
.ogeta-tl-renew { width: 2px; height: 14px; border-radius: 1px; background: color-mix(in srgb, var(--ogeta-text) 30%, transparent); }
.ogeta-tl-labels { display: flex; justify-content: space-between; gap: 6px; font-size: 10.5px; color: var(--ogeta-faint); letter-spacing: -.005em; }
.ogeta-tl-labels b { font-weight: 600; color: var(--ogeta-muted); }

.ogeta-spark { width: 100%; height: 76px; display: block; overflow: visible; }
.ogeta-rows { display: flex; flex-direction: column; }
.ogeta-row { display: grid; grid-template-columns: 46px 1fr 96px; align-items: center; gap: 10px; padding: 7px 0; }
.ogeta-row + .ogeta-row { border-top: 1px solid var(--ogeta-line); }
.ogeta-row-name { color: var(--ogeta-muted); font-size: 12px; }
.ogeta-row-bar { height: 5px; border-radius: 999px; background: var(--ogeta-track); overflow: hidden; }
.ogeta-row-bar i { display: block; height: 100%; border-radius: inherit; transition: width .5s cubic-bezier(.32,.72,.24,1); }
.ogeta-row-meta { text-align: right; color: var(--ogeta-faint); font-size: 11.5px; white-space: nowrap; letter-spacing: -.005em; }
.ogeta-row-meta b { color: var(--ogeta-text); font-weight: 600; }

.ogeta-quotas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 12px 2px 0; }
.ogeta-quota { display: flex; flex-direction: column; gap: 2px; padding-top: 8px; border-top: 1px solid var(--ogeta-line); }
.ogeta-quota-top { display: flex; align-items: center; gap: 5px; color: var(--ogeta-muted); font-size: 11px; }
.ogeta-quota-top i { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.ogeta-quota-value { font-size: 15px; font-weight: 620; letter-spacing: -.02em; }
.ogeta-quota-note { color: var(--ogeta-faint); font-size: 10px; }
.ogeta-chart { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 6px; width: 100%; align-items: stretch; }
.ogeta-yaxis { display: flex; flex-direction: column; justify-content: space-between; padding: 2px 0 12px;
  font-size: 9px; color: var(--ogeta-faint); text-align: right; font-variant-numeric: tabular-nums; }
.ogeta-plot { min-width: 0; }
.ogeta-plot svg { width: 100%; height: 96px; display: block; overflow: visible; }
.ogeta-chart svg { width: 100%; height: 96px; display: block; overflow: visible; }
.ogeta-chart-labels { display: flex; justify-content: space-between; gap: 6px; font-size: 10px; color: var(--ogeta-faint); margin-top: 2px; }
.ogeta-advice { margin-top: 14px; padding: 10px 11px; border-radius: 14px;
  background: color-mix(in srgb, var(--ogeta-text) 4%, transparent); border: 1px solid var(--ogeta-line); }
.ogeta-advice-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-size: 11.5px; font-weight: 600; color: var(--ogeta-muted); margin-bottom: 4px; }
.ogeta-advice-price { font-size: 10px; font-weight: 500; color: var(--ogeta-faint); }
.ogeta-option { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 6px 0; }
.ogeta-option + .ogeta-option { border-top: 1px solid var(--ogeta-line); }
.ogeta-option-name { font-size: 12px; color: var(--ogeta-muted); }
.ogeta-option.is-pick .ogeta-option-name { color: var(--ogeta-text); font-weight: 600; }
.ogeta-option-cost { font-size: 13px; font-weight: 650; text-align: right; }
.ogeta-option-note { grid-column: 1 / -1; font-size: 10.5px; color: var(--ogeta-faint); }
.ogeta-advice-reco { margin-top: 6px; font-size: 11.5px; color: var(--ogeta-text); }.ogeta-foot { margin-top: 15px; padding-top: 11px; border-top: 1px solid var(--ogeta-line);
  display: flex; gap: 8px; justify-content: space-between; color: var(--ogeta-faint); font-size: 10.5px; letter-spacing: -.005em; }
.ogeta-foot b { font-weight: 600; color: var(--ogeta-muted); }
.ogeta-error { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 9px 11px; border-radius: 12px;
  background: color-mix(in srgb, ${SYS.bad} 9%, transparent); color: ${SYS.bad}; font-size: 11.5px; }
.ogeta-retry { margin-left: auto; border: 0; background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.ogeta-skel { height: 12px; border-radius: 7px; background: linear-gradient(90deg, var(--ogeta-track) 25%, color-mix(in srgb, var(--ogeta-track) 45%, transparent) 37%, var(--ogeta-track) 63%);
  background-size: 400% 100%; animation: ogeta-shimmer 1.4s ease infinite; }
@keyframes ogeta-shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
`

    // ------------------------------------------------------------- primitives
    function toneFor(percent) {
      if (!Number.isFinite(percent)) return 'var(--ogeta-muted)'
      if (percent >= 90) return SYS.bad
      if (percent >= 75) return SYS.warn
      return SYS.good
    }

    /** Activity-ring style gauge: three concentric windows, rounded caps. */
    function Rings({ windows }) {
      const size = 132
      const specs = [
        { key: 'monthly', color: accent(), opacity: 1, radius: 58 },
        { key: 'weekly', color: accent(), opacity: 0.6, radius: 46 },
        { key: 'rolling', color: accent(), opacity: 0.32, radius: 34 },
      ]
      return h(
        'div',
        { className: 'ogeta-rings' },
        h(
          'svg',
          { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': true },
          specs.map((spec, index) => {
            const stroke = 9
            const radius = spec.radius
            const circumference = 2 * Math.PI * radius
            const percent = Number.isFinite(windows[spec.key]?.percent) ? windows[spec.key].percent : 0
            const value = Math.max(0, Math.min(100, percent))
            return h(
              'g',
              { key: spec.key, transform: `rotate(-90 ${size / 2} ${size / 2})` },
              h('circle', { cx: size / 2, cy: size / 2, r: radius, fill: 'none', stroke: 'var(--ogeta-track)', strokeWidth: stroke }),
              h('circle', {
                cx: size / 2,
                cy: size / 2,
                r: radius,
                fill: 'none',
                stroke: spec.color,
                strokeOpacity: spec.opacity,
                strokeWidth: stroke,
                strokeLinecap: 'round',
                strokeDasharray: `${circumference} ${circumference}`,
                strokeDashoffset: circumference * (1 - value / 100),
                style: { transition: 'stroke-dashoffset .7s cubic-bezier(.32,.72,.24,1)', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,.08))' },
              }),
            )
          }),
        ),
      )
    }

    // -------------------------------------------------------------- analysis
    function describe(data) {
      const projection = data?.projection
      const plan = projection?.plan ?? null
      const monthly = data?.windows?.monthly ?? {}
      const now = Date.now()

      if (!data || !data.ok) {
        const error = data?.error ?? state.error
        const missingKey = error === 'missing-key'
        return {
          tone: 'muted',
          headline: missingKey ? t('未配置 OpenCode Go 密钥', 'OpenCode Go key is not configured') : t('暂时无法读取套餐额度', 'Quota is temporarily unavailable'),
          sub: missingKey
            ? t('在 DSH 凭据里保存 OPENCODE_GO_API_KEY（设置 → 模型里配置 opencode-go 即可）', 'Store OPENCODE_GO_API_KEY in DSH credentials (the opencode-go model route already uses it).')
            : t('请检查网络或密钥后重试；已采集的样本会保留。', 'Check the network or key and retry; recorded samples are kept.'),
          percent: Number.isFinite(monthly.percent) ? monthly.percent : null,
          plan,
        }
      }

      const used = Number.isFinite(monthly.percent) ? monthly.percent : projection?.percent
      const verdict = projection?.verdict ?? 'insufficient'
      const confidence = confidenceLabel(projection?.confidence)
      const rate = projection?.ratePerHour
      const eta = projection?.etaIso
      const resetsAt = projection?.resetsAtIso ?? monthly.resetsAt
      const endsAt = plan?.endsAt ?? projection?.endsAtIso

      if (verdict === 'exhausted') {
        return {
          tone: 'bad',
          headline: t('本月额度已用尽', 'Monthly allowance is used up'),
          sub: resetsAt ? t(`等待 ${dateTime(resetsAt)} 重置`, `Resets at ${dateTime(resetsAt)}`) : t('等待窗口重置', 'Waiting for the window reset'),
          percent: used,
          plan,
        }
      }
      if (verdict === 'insufficient') {
        return {
          tone: 'muted',
          headline: t('采样数据不足', 'Insufficient samples'),
          sub: t(
            `已记录 ${projection?.sampleCount ?? 0} 个采样点（跨度 ${spanLabel(projection?.spanHours)}），至少需要 3 个采样点且跨度 6 小时`, 
            `${projection?.sampleCount ?? 0} samples over ${spanLabel(projection?.spanHours)}; needs 3 points across 6 hours`,
          ),
          percent: used,
          plan,
        }
      }
      if (verdict === 'idle') {
        return {
          tone: 'good',
          headline: t('近期消耗变化不明显', 'Recent consumption is flat'),
          sub: t('近期无明显消耗，暂不估算耗尽时间', 'No meaningful burn lately; no exhaustion estimate is issued'),
          percent: used,
          plan,
        }
      }
      if (verdict === 'safe-reset') {
        return {
          tone: 'good',
          headline: t('本周期内不会用尽', 'Will not run out this cycle'),
          sub: resetsAt
            ? t(
                `${dateTime(resetsAt)} 会重置；按当前速度届时约 ${pct(projection.projectedAtReset)}`,
                `Resets ${dateTime(resetsAt)}; pacing to about ${pct(projection.projectedAtReset)} by then`,
              )
            : t('额度会先重置', 'The window resets first'),
          percent: used,
          plan,
        }
      }
      if (verdict === 'after-expiry') {
        return {
          tone: 'good',
          headline: t('到期前不会用尽', 'Will not run out before renewal'),
          sub: endsAt
            ? t(
                `按当前速度，到续费日 ${dateTime(endsAt)} 预计只用到 ${pct(projection.projectedAtExpiry)}`,
                `At this pace you reach about ${pct(projection.projectedAtExpiry)} by the renewal date ${dateTime(endsAt)}`,
              )
            : t('按当前速度到续费日仍有余量', 'Still has headroom at the renewal date'),
          percent: used,
          plan,
        }
      }
      if (verdict === 'before-reset') {
        return {
          tone: 'warn',
          headline: t(`预计 ${dateTime(eta)} 额度用尽`, `Projected to run out at ${dateTime(eta)}`),
          sub: t('会在本周期重置前用尽（线性外推）', 'Before the window resets (linear projection)'),
          percent: used,
          plan,
        }
      }      if (verdict === 'before-expiry') {
        const early = endsAt && eta ? (new Date(endsAt).getTime() - new Date(eta).getTime()) / DAY : null
        return {
          tone: 'warn',
          headline: t(`预计 ${dateTime(eta)} 额度用尽`, `Projected to run out at ${dateTime(eta)}`),
          sub: early !== null && early > 0
            ? t(`比续费日 ${shortDate(endsAt)} 早 ${early.toFixed(1)} 天 · 线性外推`, `${early.toFixed(1)} days before renewal on ${shortDate(endsAt)} · linear projection`)
            : t(`续费日为 ${shortDate(endsAt)}，额度会先行用尽`, `Renewal is ${shortDate(endsAt)}; the quota runs out first`),
          percent: used,
          plan,
        }
      }
      return {
        tone: 'muted',
        headline: t('当前样本不足以估算耗尽时间', 'Current samples are insufficient for an estimate'),
        sub: t(`最近斜率 ${Number.isFinite(rate) ? rate.toFixed(2) : '—'} %/小时 · 置信度 ${confidence}`, `Recent slope ${Number.isFinite(rate) ? rate.toFixed(2) : '—'} %/h · confidence ${confidence}`),
        percent: used,
        plan,
      }
    }

    // --------------------------------------------------------------- surface
    function Timeline({ data, tone }) {
      const projection = data?.projection ?? {}
      const monthly = data?.windows?.monthly ?? {}
      const plan = projection.plan ?? null
      const now = Date.now()
      const endsAt = plan?.endsAt ? new Date(plan.endsAt).getTime() : null
      const resetsAt = monthly.resetsAt ? new Date(monthly.resetsAt).getTime() : null
      const eta = projection.etaIso ? new Date(projection.etaIso).getTime() : null
      const firstSample = data?.sample?.firstAt ? new Date(data.sample.firstAt).getTime() : null
      const start = Math.min(
        ...[now - 7 * DAY, firstSample ?? Number.POSITIVE_INFINITY, resetsAt !== null ? resetsAt - 30 * DAY : Number.POSITIVE_INFINITY].filter(Number.isFinite),
      )
      const end = Math.max(...[now + 2 * DAY, endsAt ?? 0, resetsAt ?? 0, eta ?? 0].filter((value) => Number.isFinite(value) && value > 0))
      const span = Math.max(1, end - start)
      const pos = (value) => `${Math.max(0, Math.min(100, ((value - start) / span) * 100))}%`
      const nowPos = pos(now)
      const etaPos = eta !== null ? pos(eta) : null
      const renewPos = endsAt !== null ? pos(endsAt) : null

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'ogeta-timeline' },
          h(
            'div',
            { className: 'ogeta-tl-track' },
            h('div', { className: 'ogeta-tl-fill', style: { width: nowPos } }),
            eta !== null && eta < (endsAt ?? Number.POSITIVE_INFINITY)
              ? h('div', { className: 'ogeta-tl-proj', style: { left: nowPos, width: etaPos } })
              : null,
            h('div', { className: 'ogeta-tl-mark', style: { left: nowPos } }, h('div', { className: 'ogeta-tl-now' })),
            eta !== null ? h('div', { className: 'ogeta-tl-mark', style: { left: etaPos } }, h('div', { className: `ogeta-tl-eta${tone === 'good' ? ' ogeta-tl-eta--good' : ''}` })) : null,
            renewPos !== null ? h('div', { className: 'ogeta-tl-mark', style: { left: renewPos } }, h('div', { className: 'ogeta-tl-renew' })) : null,
          ),
        ),
        h(
          'div',
          { className: 'ogeta-tl-labels' },
          h('span', null, shortDate(new Date(start).toISOString())),
          h('span', null, h('b', null, t('现在', 'now'))),
          eta !== null ? h('span', null, h('b', null, shortDate(new Date(eta).toISOString())), t(' 预计用尽', ' projected')) : h('span', null, ''),
          renewPos !== null ? h('span', null, h('b', null, shortDate(new Date(renewPos).toISOString())), t(' 续费', ' renew')) : h('span', null, ''),
        ),
      )
    }

    /** Catmull-Rom → cubic Bézier, the smooth curve Apple uses for sparklines. */
    function smoothPath(points) {
      if (points.length < 2) return ''
      let path = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`
      for (let i = 0; i < points.length - 1; i += 1) {
        const p0 = points[i - 1] ?? points[i]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = points[i + 2] ?? p2
        const c1x = p1[0] + (p2[0] - p0[0]) / 6
        const c1y = p1[1] + (p2[1] - p0[1]) / 6
        const c2x = p2[0] - (p3[0] - p1[0]) / 6
        const c2y = p2[1] - (p3[1] - p1[1]) / 6
        path += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
      }
      return path
    }

    function Spark({ data, tone }) {
      const series = data?.series?.monthly ?? []
      const projection = data?.projection ?? {}
      const now = Date.now()
      const points = series.map((point) => ({ t: point.t, y: point.percent }))
      const eta = projection.etaIso ? new Date(projection.etaIso).getTime() : null
      const endsAt = projection.endsAtIso ? new Date(projection.endsAtIso).getTime() : null
      const target = eta ?? endsAt ?? now + 7 * DAY
      const start = points.length > 0 ? points[0].t : now - 7 * DAY
      const end = Math.max(target, now, points.length > 0 ? points[points.length - 1].t : now)
      const width = 328
      const height = 76
      const pad = 4
      const x = (value) => pad + ((value - start) / Math.max(1, end - start)) * (width - pad * 2)
      const y = (value) => height - pad - (Math.max(0, Math.min(100, value)) / 100) * (height - pad * 2 - 8)
      const mapped = points.map((point) => [x(point.t), y(point.y)])
      const line = smoothPath(mapped)
      const area = line ? `${line} L${mapped[mapped.length - 1][0].toFixed(1)},${height} L${mapped[0][0].toFixed(1)},${height} Z` : ''
      const last = mapped[mapped.length - 1]
      const projected = Number.isFinite(projection.projectedAtExpiry) ? projection.projectedAtExpiry : points.length > 0 ? points[points.length - 1].y : 0
      const id = React.useId ? React.useId().replace(/[:]/g, '') : 'spark'
      return h(
        'svg',
        { className: 'ogeta-spark', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': t('月额度采样轨迹', 'Monthly quota samples') },
        h(
          'defs',
          null,
          h('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0%', style: { stopColor: accent(), stopOpacity: 0.22 } }),
            h('stop', { offset: '100%', style: { stopColor: accent(), stopOpacity: 0 } })),
        ),
        h('line', { x1: 0, y1: y(100), x2: width, y2: y(100), stroke: 'var(--ogeta-line)', strokeDasharray: '2 5' }),
        area ? h('path', { d: area, fill: `url(#${id})` }) : null,
        line ? h('path', { d: line, fill: 'none', stroke: accent(), strokeWidth: 2, strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }) : null,
        last && target > (points[points.length - 1]?.t ?? 0)
          ? h('path', {
              d: `M${last[0].toFixed(1)},${last[1].toFixed(1)} L${x(target).toFixed(1)},${y(projected).toFixed(1)}`,
              fill: 'none',
              stroke: SYS.neutral,
              strokeWidth: 1.8,
              strokeDasharray: '3 5',
              strokeLinecap: 'round',
              vectorEffect: 'non-scaling-stroke',
            })
          : null,
        last ? h('circle', { cx: last[0], cy: last[1], r: 3.4, fill: 'var(--ogeta-surface)', stroke: accent(), strokeWidth: 2 }) : null,
        eta ? h('circle', { cx: x(eta), cy: y(100), r: 3, fill: SYS.warn }) : null,
      )
    }

    function Row({ label, window: win }) {
      const percent = Number.isFinite(win?.percent) ? win.percent : null
      const remaining = percent === null ? null : Math.max(0, 100 - percent)
      return h(
        'div',
        { className: 'ogeta-row' },
        h('span', { className: 'ogeta-row-name' }, label),
        h('div', { className: 'ogeta-row-bar' }, h('i', { style: { width: `${percent === null ? 0 : Math.max(2, Math.min(100, percent))}%`, background: percent === null ? 'transparent' : accent() } })),
        h('span', { className: 'ogeta-row-meta' }, percent === null ? '—' : h('span', null, h('b', null, pct(remaining)), t(' 剩余', ' left'))),
      )
    }

    /** History and forecast on one time axis: the timeline and the spark merged. */
    function BurnChart({ data, tone }) {
      const series = data?.series?.monthly ?? []
      const projection = data?.projection ?? {}
      const monthly = data?.windows?.monthly ?? {}
      const now = Date.now()
      const points = series.map((point) => ({ t: point.t, y: point.percent }))
      const eta = projection.etaIso ? new Date(projection.etaIso).getTime() : null
      const endsAt = projection.endsAtIso
        ? new Date(projection.endsAtIso).getTime()
        : projection.plan?.endsAt
          ? new Date(projection.plan.endsAt).getTime()
          : null
      const resetsAt = monthly.resetsAt ? new Date(monthly.resetsAt).getTime() : null
      const start = points.length > 0 ? Math.min(points[0].t, now - 3 * DAY) : now - 7 * DAY
      const end = Math.max(now + 2 * DAY, endsAt ?? 0, resetsAt ?? 0, eta ?? 0)
      const width = 328
      const height = 96
      const left = 4
      const right = 4
      const top = 6
      const bottom = 8
      const x = (value) => left + ((value - start) / Math.max(1, end - start)) * (width - left - right)
      const y = (value) => height - bottom - (Math.max(0, Math.min(100, value)) / 100) * (height - top - bottom)
      const mapped = points.map((point) => [x(point.t), y(point.y)])
      const line = smoothPath(mapped)
      const area = line && mapped.length > 1 ? `${line} L${mapped[mapped.length - 1][0].toFixed(1)},${height - bottom} L${mapped[0][0].toFixed(1)},${height - bottom} Z` : ''
      const last = mapped[mapped.length - 1]
      const projected = Number.isFinite(projection.projectedAtExpiry) ? projection.projectedAtExpiry : null
      const target = eta !== null && (endsAt === null || eta <= endsAt) ? eta : endsAt
      const targetY = eta !== null && (endsAt === null || eta <= endsAt) ? 100 : projected
      const id = React.useId ? React.useId().replace(/[:]/g, '') : 'burn'
      return h(
        'div',
        { className: 'ogeta-chart' },
        h('div', { className: 'ogeta-yaxis' },
          h('span', null, '100%'),
          h('span', null, '50%'),
          h('span', null, '0')),
        h(
          'div',
          { className: 'ogeta-plot' },
        h(
          'svg',
          { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': t('月额度用量与预测', 'Monthly quota usage and forecast') },
          h(
            'defs',
            null,
            h('linearGradient', { id, x1: '0', y1: '0', x2: '0', y2: '1' },
              h('stop', { offset: '0%', style: { stopColor: accent(), stopOpacity: 0.16 } }),
              h('stop', { offset: '100%', style: { stopColor: accent(), stopOpacity: 0 } })),
          ),
          h('line', { x1: left, y1: y(100), x2: width - right, y2: y(100), stroke: 'var(--ogeta-line)', strokeDasharray: '2 5' }),
          h('line', { x1: left, y1: y(50), x2: width - right, y2: y(50), stroke: 'var(--ogeta-line)', strokeDasharray: '2 7', opacity: 0.6 }),
          area ? h('path', { d: area, fill: `url(#${id})` }) : null,
          line ? h('path', { d: line, fill: 'none', stroke: accent(), strokeWidth: 2, strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke' }) : null,
          last && target
            ? h('path', {
                d: `M${last[0].toFixed(1)},${last[1].toFixed(1)} L${x(target).toFixed(1)},${y(targetY ?? 100).toFixed(1)}`,
                fill: 'none',
                stroke: tone === 'good' ? GOOD : WARN,
                strokeWidth: 1.8,
                strokeDasharray: '3 5',
                strokeLinecap: 'round',
                vectorEffect: 'non-scaling-stroke',
              })
            : null,
          h('line', { x1: x(now), y1: top, x2: x(now), y2: height - bottom, stroke: accent(), strokeOpacity: 0.28, strokeDasharray: '2 4' }),
          eta !== null ? h('line', { x1: x(eta), y1: y(100), x2: x(eta), y2: height - bottom, stroke: WARN, strokeOpacity: 0.4, strokeDasharray: '2 4' }) : null,
          endsAt !== null ? h('line', { x1: x(endsAt), y1: top, x2: x(endsAt), y2: height - bottom, stroke: 'var(--ogeta-muted)', strokeOpacity: 0.45 }) : null,
          last ? h('circle', { cx: last[0], cy: last[1], r: 3.2, fill: 'var(--ogeta-surface)', stroke: accent(), strokeWidth: 2 }) : null,
          eta !== null ? h('circle', { cx: x(eta), cy: y(100), r: 3.4, fill: WARN }) : null,
        ),
        h(
          'div',
          { className: 'ogeta-chart-labels' },
          h('span', null, shortDate(new Date(start).toISOString())),
          h('span', null, t('现在', 'now')),
          eta !== null ? h('span', null, t('预计用尽 ', 'out '), shortDate(new Date(eta).toISOString())) : null,
          endsAt !== null ? h('span', null, t('续费 ', 'renew '), shortDate(new Date(endsAt).toISOString())) : null,
        ),
        ),
      )
    }
    function Panel({ data, loading, error }) {
      const [, forceTick] = React.useState(0)
      React.useEffect(() => {
        const timer = setInterval(() => forceTick((value) => value + 1), 30_000)
        return () => clearInterval(timer)
      }, [])
      const dark = scheme === 'dark'
      const view = describe(data)
      const projection = data?.projection ?? {}
      const windows = data?.windows ?? {}
      const monthly = windows.monthly ?? {}
      const plan = projection.plan ?? null
      const used = Number.isFinite(monthly.percent) ? monthly.percent : null
      const remaining = used === null ? null : Math.max(0, 100 - used)
      const allowanceUsd = Number.isFinite(data?.allowanceUsd)
        ? data.allowanceUsd
        : Number.isFinite(monthly.limitMicroCents) ? monthly.limitMicroCents / 1e8 : null
      const usedMoney = allowanceUsd !== null && Number.isFinite(used)
        ? `$${((used / 100) * allowanceUsd).toFixed(2)}`
        : money(monthly.usedMicroCents)
      const limitMoney = allowanceUsd !== null ? `$${allowanceUsd.toFixed(2)}` : money(monthly.limitMicroCents)
      const endsAt = plan?.endsAt ?? projection.endsAtIso ?? null
      const daysLeft = endsAt ? (new Date(endsAt).getTime() - Date.now()) / DAY : null
      const errorView = data && data.ok === false ? data : null

      return h(
        'div',
        { className: 'ogeta-layer ogeta-root', onMouseDown: (event) => event.stopPropagation() },
        h(
          'div',
          { className: `ogeta-panel${dark ? ' ogeta-panel--dark' : ''}`, role: 'dialog', 'aria-modal': false, 'aria-label': t('OpenCode Go 额度预测', 'OpenCode Go quota forecast') },
          h('style', null, css),
          h(
            'div',
            { className: 'ogeta-head' },
            h(
              'div',
              { className: 'ogeta-head-main' },
              h(
                'div',
                { className: 'ogeta-mark' },
                h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', 'aria-hidden': true },
                  h('circle', { cx: 12, cy: 12, r: 8.2, fill: 'none', stroke: accent(), strokeWidth: 2.6, strokeLinecap: 'round', strokeDasharray: '38 14', transform: 'rotate(-108 12 12)' }),
                  h('circle', { cx: 12, cy: 12, r: 4.2, fill: 'none', stroke: accent(), strokeOpacity: 0.45, strokeWidth: 2.4, strokeLinecap: 'round', strokeDasharray: '15 12', transform: 'rotate(38 12 12)' }),
                ),
              ),
              h('div', null,
                h('div', { className: 'ogeta-title' }, 'OpenCode Go'),
                h('div', { className: 'ogeta-subtitle' }, data && data.ok ? `${data.model ?? 'DeepSeek V4.1 Flash'} · ${data.planName ?? 'Go'}` : t('月额度 · 本地预测', 'Monthly plan · local forecast'))),
            ),
            h(
              'div',
              { className: 'ogeta-actions' },
              endsAt
                ? h('span', { className: 'ogeta-chip' },
                    `${t('续费', 'renew')} ${shortDate(endsAt)}`,
                    daysLeft !== null ? ` · ${daysLeft >= 0 ? t(`${Math.ceil(daysLeft)} 天`, `${Math.ceil(daysLeft)}d`) : t('已到期', 'expired')}` : '')
                : null,
              h(
                'button',
                { className: 'ogeta-iconbtn', title: t('刷新', 'Refresh'), 'aria-label': t('刷新', 'Refresh'), onClick: () => load(true) },
                h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', className: loading ? 'ogeta-spin' : undefined, 'aria-hidden': true },
                  h('path', { d: 'M13.4 8a5.4 5.4 0 1 1-1.58-3.82', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
                  h('path', { d: 'M13.6 2.7v3h-3', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' })),
              ),
              h(
                'button',
                { className: 'ogeta-iconbtn', title: t('关闭', 'Close'), 'aria-label': t('关闭', 'Close'), onClick: close },
                h('svg', { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': true },
                  h('path', { d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' })),
              ),
            ),
          ),

          data && data.ok
            ? h(
                'div',
                null,
                h('section', { className: 'ogeta-hero' },
                  h(Rings, { windows }),
                  h('div', { className: 'ogeta-figures' },
                    h('div', { className: 'ogeta-remaining' },
                      h('b', null, remaining === null ? '—' : `${Math.round(remaining)}%`),
                      h('span', null, t('剩余', 'left'))),
                    h('div', { className: 'ogeta-figrow' },
                      h('span', { className: 'ogeta-figrow-strong' },
                        usedMoney ? usedMoney : pct(used, 1),
                        limitMoney ? h('i', { title: t('按 OpenCode Go 官方模型额度', 'Per-model allowance from the official OpenCode Go table') }, ` / ${limitMoney}`) : null),
                      h('span', null,
                        t('速度 ', 'pace '),
                        h('b', null, Number.isFinite(projection.ratePerHour) ? `${projection.ratePerHour.toFixed(2)}%/h` : '—'))),
                    h('div', { className: 'ogeta-figrow' },
                      h('span', null, t('置信度 ', 'confidence '), h('b', null, confidenceLabel(projection.confidence))),
                      h('span', null, `${projection.sampleCount ?? 0} ${t('个采样点', 'samples')}`)),
                  ),
                ),
                h('div', { className: 'ogeta-quotas' },
                  [
                    [t('月', 'month'), windows.monthly, 1],
                    [t('周', 'week'), windows.weekly, 0.6],
                    ['5h', windows.rolling, 0.32],
                  ].map(([label, win, opacity]) =>
                    h('div', { className: 'ogeta-quota', key: label },
                      h('div', { className: 'ogeta-quota-top' },
                        h('i', { style: { background: accent(), opacity } }),
                        h('span', null, label)),
                      h('div', { className: 'ogeta-quota-value' }, Number.isFinite(win?.percent) ? pct(win.percent) : '—'),
                      h('div', { className: 'ogeta-quota-note' },
                        win?.resetsAt ? t(`重置 ${shortDate(win.resetsAt)}`, `resets ${shortDate(win.resetsAt)}`) : '—')))),
                h('div', { className: `ogeta-verdict ogeta-verdict--${view.tone}` },
                  h('span', { className: 'ogeta-verdict-dot', style: { background: 'currentColor' } }),
                  h('div', null,
                    h('div', { className: 'ogeta-verdict-main' }, view.headline),
                    h('div', { className: 'ogeta-verdict-sub' }, view.sub))),

                data.advice
                  ? h('section', { className: 'ogeta-advice' },
                      h('div', { className: 'ogeta-advice-head' },
                        t('提前用尽时的成本对比', 'Cost comparison if it runs out early'),
                        data.advice.pricing && Number.isFinite(data.advice.pricing.input)
                          ? h('span', { className: 'ogeta-advice-price' }, `官方价 $${data.advice.pricing.input}/${data.advice.pricing.output} 每 M`)
                          : null),
                      h('div', { className: `ogeta-option${data.advice.recommendation === 'renew' ? ' is-pick' : ''}` },
                        h('span', { className: 'ogeta-option-name' }, t('立即续费 OpenCode Go', 'Renew OpenCode Go now')),
                        h('span', { className: 'ogeta-option-cost' }, `$${data.advice.planPriceUsd.toFixed(2)}`),
                        h('span', { className: 'ogeta-option-note' },
                          t(`新一期额度 $${data.advice.limitUsd.toFixed(0)}，续费日顺延`, `new $${data.advice.limitUsd.toFixed(0)} allowance, renewal moves out`))),
                      h('div', { className: `ogeta-option${data.advice.recommendation === 'api' ? ' is-pick' : ''}` },
                        h('span', { className: 'ogeta-option-name' }, t('改用官方 API 支付溢出部分', 'Pay the overflow on the official API')),
                        h('span', { className: 'ogeta-option-cost' }, `$${(data.advice.officialUsd ?? data.advice.overflowUsd).toFixed(2)}`),
                        h('span', { className: 'ogeta-option-note' },
                          t(
                            `溢出约 ${pct(data.advice.overflowPercent)} 额度${Number.isFinite(data.advice.tokensEstimate) ? ` · 约 ${(data.advice.tokensEstimate / 1e6).toFixed(1)}M tokens` : ''}`,
                            `about ${pct(data.advice.overflowPercent)} overflow${Number.isFinite(data.advice.tokensEstimate) ? ` · ~${(data.advice.tokensEstimate / 1e6).toFixed(1)}M tokens` : ''}`))),
                      h('div', { className: 'ogeta-advice-reco' },
                        data.advice.recommendation === 'api'
                          ? t('建议：溢出金额低于套餐价，用官方 API 补齐更省。', 'Recommendation: the overflow costs less than a new period, so top up on the official API.')
                          : t('建议：溢出金额已达到套餐价，立即续费更省。', 'Recommendation: the overflow reaches a full period price, so renewing is cheaper.')))
                  : null,

                h('section', { className: 'ogeta-section' },
                  h('div', { className: 'ogeta-section-head' },
                    h('span', { className: 'ogeta-section-title' }, t('用量与预测', 'usage & forecast')),
                    h('span', { className: 'ogeta-section-note' }, `${projection.sampleCount ?? 0} ${t('个采样点', 'pts')} · ${spanLabel(projection.spanHours)}`)),
                  h(BurnChart, { data, tone: view.tone })),


              )
            : h(
                'div',
                { style: { padding: '20px 2px 6px' } },
                h('div', { className: 'ogeta-skel', style: { width: '62%', marginBottom: 11 } }),
                h('div', { className: 'ogeta-skel', style: { width: '86%', marginBottom: 11 } }),
                h('div', { className: 'ogeta-skel', style: { width: '44%' } }),
              ),

          (errorView || (error && error !== 'missing-key')) && data?.ok !== false
            ? h('div', { className: 'ogeta-error' },
                h('span', null, t('本次取数失败：', 'Fetch failed: '), String(data?.error ?? error)),
                h('button', { className: 'ogeta-retry', onClick: () => load(true) }, t('重试', 'retry')))
            : null,

          h('footer', { className: 'ogeta-foot' },
            h('span', null,
              t('采样 ', 'sampled '),
              h('b', null, projection.sampleCount ?? data?.sample?.count ?? 0),
              t(` 点 · ${data?.sample?.cadence?.anchors?.join('/') ?? '3/9/15/21'} 点与任务结束时取数`, ` pts · anchors ${data?.sample?.cadence?.anchors?.join('/') ?? '3/9/15/21'} + task ends`)),
            h('span', null, t('上次 ', 'last '), h('b', null, clock(data?.sample?.lastAt ?? data?.fetchedAt)))),
        ),
      )
    }

    function Pill() {
      const store = useStore()
      const dark = scheme === 'dark'
      const data = store.data
      const projection = data?.projection ?? {}
      const windows = data?.windows ?? {}
      const used = Number.isFinite(windows.monthly?.percent) ? windows.monthly.percent : null
      const remaining = used === null ? null : Math.max(0, Math.round(100 - used))
      const verdict = projection.verdict ?? 'insufficient'
      const tone = verdict === 'before-expiry' || verdict === 'before-reset' ? SYS.warn : verdict === 'exhausted' ? SYS.bad : SYS.good
      const etaLabel = projection.etaIso
        ? t(`${shortDate(projection.etaIso)} 用尽`, `out ${shortDate(projection.etaIso)}`)
        : verdict === 'after-expiry' || verdict === 'safe-reset' || verdict === 'idle'
          ? t('到期前有余量', 'headroom until renewal')
          : t('数据不足', 'insufficient data')
      return h(
        'button',
        {
          type: 'button',
          className: `ogeta-pill ogeta-root${dark ? ' ogeta-pill--dark' : ''}`,
          onClick: toggle,
          title: t(`OpenCode Go · ${etaLabel}`, `OpenCode Go · ${etaLabel}`),
          'aria-label': t('OpenCode Go 月额度预测', 'OpenCode Go monthly forecast'),
        },
        h('style', null, css),
        h('svg', { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true, style: { display: 'block', flex: 'none' } },
          h('circle', { cx: 7, cy: 7, r: 5.5, fill: 'none', stroke: 'var(--dsw-alias-border-l3, rgba(0,0,0,.16))', strokeWidth: 2 }),
          h('circle', {
            cx: 7,
            cy: 7,
            r: 5.5,
            fill: 'none',
            stroke: tone === WARN || tone === BAD ? tone : accent(),
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeDasharray: `${2 * Math.PI * 5.5} ${2 * Math.PI * 5.5}`,
            strokeDashoffset: (2 * Math.PI * 5.5) * (1 - Math.max(0, Math.min(100, used ?? 0)) / 100),
            transform: 'rotate(-90 7 7)',
            style: { transition: 'stroke-dashoffset .6s cubic-bezier(.32,.72,.24,1)' },
          })),
        h('span', { className: 'ogeta-pill-brand' }, 'Go'),
        h('span', { className: 'ogeta-pill-value' }, remaining === null ? '—' : `${remaining}%`),
      )
    }

    function Overlay() {
      const store = useStore()
      React.useEffect(() => {
        if (store.open) load(false)
      }, [store.open])
      React.useEffect(() => {
        if (!store.open) return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') close()
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [store.open])
      if (!store.open) return null
      return h(Panel, { data: store.data, loading: store.loading, error: store.error })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject(SLOT_PILL, () =>
          ctx.slots.register({ name: SLOT_PILL, id: 'opencode-go-eta-pill', order: 30, label: 'OpenCode Go ETA' }, Pill),
        )
        ctx.slots.inject(SLOT_PANEL, () =>
          ctx.slots.register({ name: SLOT_PANEL, id: 'opencode-go-eta-panel', order: 20, label: 'OpenCode Go ETA' }, Overlay),
        )

        const theme = ctx.get('theme')
        if (theme !== undefined && typeof theme.getTheme === 'function') {
          try {
            applyScheme(theme.getTheme() && theme.getTheme().colorScheme)
          } catch {
            applyScheme('light')
          }
          ctx.effect(
            () => ctx.on('theme/change', (next) => applyScheme(next && (next.colorScheme ?? next.theme?.colorScheme))),
            'opencode-go-eta: theme',
          )
        }

        ctx.effect(() => {
          const boot = setTimeout(() => load(false), 1200)
          const timer = setInterval(() => {
            if (document.visibilityState === 'visible' && Date.now() - state.requestedAt > REFRESH_MS) load(false)
          }, 60_000)
          return () => {
            clearTimeout(boot)
            clearInterval(timer)
          }
        }, 'opencode-go-eta: client refresh')
      },
    }
  },
})