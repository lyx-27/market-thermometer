# Changelog

## Unreleased — position tracking, drop alerts, data resilience

### Added

- **My position on Meme Watch.** Record buys and each row shows the market cap you
  entered at plus live P/L%. Multiple buys in one coin are dollar-weighted into a
  single average entry (`avgEntryMcap = ΣAi / Σ(Ai/Mi)`); a single buy is simply that
  buy's market cap.
  - `positions.json` holds the records and is **gitignored** (real amounts / cost
    basis are private). `positions.example.json` documents the format.
  - `record-buy.js <coinId|name> <amountUSD> [entryMcap]` appends a buy; omit the
    market cap and it captures the current one.
  - Fully exited coins move to the file's `_closed` archive — history is kept, but
    they no longer count toward P/L.
  - Lookup accepts either the coin `id` or its display name, case-insensitively.
- **48h drop sound alerts.** A chime fires once when a watched coin's 48h change
  crosses −20%, and again at −40%. Levels re-arm only after the coin recovers above
  them, and the first refresh after launch is seeded silently so opening the widget
  never replays an old drop. Sound resolution: `MT_ALERT_SOUND` env var → an audio
  file in `Trader_Record_tool/` → the system `Glass.aiff`. macOS uses `afplay`,
  Windows a PowerShell fallback.
- **GeckoTerminal as a fallback price source.** DexScreener is unreachable on some
  networks (TLS reset even through a proxy), which previously blanked every meme row.
  The fallback supplies price, market cap, 24h change, logo and top pool.
  `MEME_WATCH` entries now carry a `net` (network slug) for it to use.
- **Last-good cache.** If both sources fail, recent values are reused for up to 30
  minutes and marked `stale` instead of collapsing the row to `—`.
- **Base** added to the Money Flow column (per-chain 24h DEX volume).

### Changed

- **Meme rows are now a fixed-column CSS grid** (`name | chart | MCAP | price |
  position`) instead of flex. The chart and position cells always render — empty when
  there's no data — so charts and every other column line up across all rows
  regardless of whether a coin has chart data or a recorded buy. Previously rows with
  and without a position drifted out of alignment.
- **Sub-cent prices display significant digits** rather than 4 fixed decimals. At 4
  decimals `$0.0002236` and `$0.0003645` both collapsed to `$0.0002`/`$0.0004`, making
  entry vs. current price impossible to compare.
- The position column shows entry market cap + P/L% only; the entry unit price was
  removed from the UI (still recorded in `positions.json`).
- Meme coin fetches are staggered ~250ms apart so a long watchlist doesn't hit the
  token APIs as one burst and trip their per-second throttles.

### Fixed

- **Spoof pool selection.** Some tokens list pools with fabricated liquidity and
  garbage prices (e.g. `priceUsd` ≈ 7e26), which the "deepest liquidity" rule picked —
  corrupting the displayed price and any P/L. Pools are now filtered to sane prices
  before selection. (Surfaced as CASHCAT showing `$703,716,125,920,911,300,000,000,000`.)
- **Total Volume going blank.** The CoinGecko demo key exhausts its 10,000-call
  monthly quota within days at a 45s refresh, after which `/global` returns HTTP 429.
  It now falls back to the keyless public tier, which has no monthly cap.
- **Pin button state.** The handler read `event.currentTarget` after an `await`, by
  which point it is `null`, so the pinned/unpinned opacity never updated.
- **Launcher double-start.** The "already running?" check used a pattern that could
  never match, so repeated launches stacked up extra instances.

### Fixed — alert spam, and alert history was unauditable

- **Drop alerts re-fired on every dip.** The −20% / −40% levels re-armed at the exact
  threshold, so a coin oscillating around −20% chimed again each time it ticked back
  under without ever actually recovering. One ~2h window produced **126 chimes**
  (MOONBASE alone fired 19 times). Re-arming now requires recovering 5pp above the
  level; on the same oscillating sequence that drops 7 chimes to 3, keeping only the
  genuine crossings. The pump alert already had this hysteresis — the drop side never
  did, which is why the noise was one-sided.
- **Alert history is now durable and timestamped** in `logs/alerts.log` (gitignored).
  Previously alerts only went to stdout, which the launcher points at
  `/tmp/market-thermometer.log` — truncated on every start, wiped on reboot, and with
  no timestamps. An audible alert is something you can miss while away, so there has
  to be a record of what fired and when. Kept out of `.cache/` on purpose: that
  directory is meant to be safe to delete, and this is history.

### Added — muted coins & pump alerts

- **`muted: true` on a watchlist entry** hides a coin from its page while still
  tracking it. Intended for coins you've stopped actively watching (bagged or dead)
  where the only thing worth knowing is if it suddenly rips. Marginal cost is close to
  zero: a muted coin rides along in its network's existing batched quote request and
  skips the chart and logo fetches entirely, since neither is drawn. Positions keep
  accumulating — hiding is not closing.
- **Pump alert.** A muted coin crossing **+50% over 24h** chimes twice; the existing
  48h drawdown alerts (−20% / −40%) chime once, so the two are distinguishable without
  looking. The asymmetry is deliberate: a visible coin falling is news, while a coin
  you've already given up on is only news if it rips. Re-arms below +35% so a coin
  hovering at the line can't chatter.
- **Alert state is persisted** to `.cache/alerts.json`. Previously state lived only in
  memory and the first tick after launch was seeded silently, which meant a restart
  both forgot what had already fired and could never report a pump that began while
  the widget was closed. Now only a first-ever run seeds silently.

### Performance — API call volume cut ~83%

Measured ~22 calls per refresh (~46k/day). Now ~4 per refresh (~8k/day), by matching
each source's poll rate to how fast its data actually changes:

- **Tiered refresh.** Prices (BTC/ETH + all tokens) stay on the 45s tick. Everything
  else is cached to its real update rate: Fear & Greed 60min (it's published once a
  day — polling it every 45s was ~1900x oversampling), total volume and per-chain DEX
  volume 10min (both are 24h aggregates), US stocks 45s while the market is open and
  30min when it's shut. Failures are never cached, so a broken source retries next tick.
- **Batched token quotes.** One GeckoTerminal multi-token request per *network*
  replaces one request per token — 14 calls become 3. It also returns token-level
  data, so unlike a pool-level lookup it cannot pick a wrong-side pool
  (the BLUECHIP bug below). DexScreener stays as the per-token fallback.
  DexScreener's own multi-address form was rejected for this: it caps the response at
  30 pools, so with more than a few tokens some lose their deepest pool.
- **Charts: 5min → 20-30min TTL, persisted to disk.** The candles are 1-hour
  resolution, so a 5min TTL was ~12x oversampling. The cache now survives restarts
  (`.cache/tokens.json`, gitignored) along with logos — previously every restart
  re-downloaded all 14 charts, which was the real cause of the rate-limit stalls.
  Keyed by token rather than pool, since a token's top pool can change.
  Expiry carries ±20% deterministic jitter so they don't all lapse on one tick.
- **Backoff on chart failure (5min).** Previously a failing chart retried every tick,
  and those retries were what kept the rate limit tripped — a self-sustaining stall.
- **BTC/ETH now use CoinGecko's keyless tier first.** This endpoint is polled every
  refresh, which needs ~58k calls/month — far beyond the demo key's 10k. The key is
  now only a fallback. Also dropped the 7-day sparkline from the request, since those
  rows render price and 24h change only.

### Notes / known data quirks

- Sources can disagree on price. SCHIFFY is the notable case: its main pool is quoted
  in `GLD` and the two sources value `GLD` about 2.3x apart, so its P/L visibly jumps
  when the fallback takes over — that's a source switch, not a real move. Other coins
  agree within roughly 1–8%.
- GeckoTerminal's free tier allows ~30 requests/minute. Charts are cached per pool for
  5 minutes; bursts of manual debugging will trip the limit and show widespread `ERR`
  for a minute or two.
- To stop DexScreener from being reset on a CN network, add a proxy rule for
  `api.dexscreener.com` in Clash rather than letting it go direct.

### Current state

- Three pages: market dashboard, Meme Watch, Onchain Project.
- Meme Watch shows 9 coins and monitors 5 more silently (muted, pump-alert only);
  Onchain Project tracks 1. 27 metrics total; refresh every 45s.
- Positions tracked for BTC/ETH (price basis) and open token positions (market-cap
  basis), with closed trades archived in `positions.json`.
- ~4 API calls per refresh in steady state.
- Runs on macOS and Windows (see [WINDOWS.md](WINDOWS.md)).
