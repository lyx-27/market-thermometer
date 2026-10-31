'use strict';

/**
 * Data providers for the dashboard.
 *
 * Every provider returns a normalized "metric":
 *   { id, group, name, sub, value, unit, changePct, series, ok, note, logo }
 *
 * All network access happens here (Electron main process) -> no CORS.
 *
 * Sources chosen to be reachable from mainland-China networks:
 *   - DefiLlama    : per-chain 24h DEX volume + history (ETH / SOL / BNB / Robinhood)
 *   - coins.llama  : crypto price fallback
 *   - alternative  : crypto Fear & Greed
 *   - Tencent (qt.gtimg.cn / ifzq.gtimg.cn) : US index/stock quotes + intraday
 *   - CoinGecko    : global stats + BTC (with fallback, often blocked in CN)
 */

const fs = require('fs');
const path = require('path');
const { fetch: uFetch, ProxyAgent } = require('undici');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// CoinGecko demo key: read from the gitignored "api key" file (kept OUT of the .app bundle).
// Check env, then the original project folder (absolute), then a relative path (dev mode).
let CG_KEY = process.env.CG_DEMO_KEY || '';
if (!CG_KEY) {
  // Local dev fallback: a gitignored "api key" file in the project root.
  try {
    const p = path.join(__dirname, '..', '..', 'api key');
    const m = fs.readFileSync(p, 'utf8').match(/CG-[A-Za-z0-9]+/);
    if (m) CG_KEY = m[0];
  } catch (_) {
    /* no local key file — CoinGecko calls fall back / degrade gracefully */
  }
}
const CG_HEADERS = CG_KEY ? { 'x-cg-demo-api-key': CG_KEY } : {};

// Local proxy (Clash Verge mixed port by default). Only CoinGecko is routed through it;
// DefiLlama / Tencent / alternative.me stay direct so they keep working even if the proxy is off.
let proxyAgent = null;
try {
  proxyAgent = new ProxyAgent(process.env.MARKET_PROXY || 'http://127.0.0.1:7897');
} catch (_) {
  /* no proxy available */
}

async function fetchJson(url, { timeout = 15000, headers = {}, proxy = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const opts = { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } };
    if (proxy && proxyAgent) opts.dispatcher = proxyAgent;
    const res = await uFetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Tencent endpoints return GBK for Chinese names; numbers are ASCII, so decode latin1.
async function fetchText(url, { timeout = 12000, headers = {}, proxy = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const opts = { signal: ctrl.signal, headers: { 'User-Agent': UA, ...headers } };
    if (proxy && proxyAgent) opts.dispatcher = proxyAgent;
    const res = await uFetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString('latin1');
  } finally {
    clearTimeout(t);
  }
}

function downsample(arr, n = 40) {
  if (!Array.isArray(arr) || arr.length <= n) return (arr || []).slice();
  const step = (arr.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/* ----------------------------- CRYPTO: macro ----------------------------- */

async function cryptoGlobal() {
  const base = { id: 'cg-global', group: 'crypto-macro', name: 'Total Volume', sub: '24H · all crypto', unit: 'usd' };
  const url = 'https://api.coingecko.com/api/v3/global';
  // Try the demo key first (higher limits). If it fails — e.g. the key's monthly
  // quota is exhausted (HTTP 429 / error 10006) — retry on the keyless public tier,
  // which has no monthly cap. Both go through the proxy (CoinGecko is usually
  // blocked on a direct CN connection).
  try {
    let data;
    try {
      ({ data } = await fetchJson(url, { proxy: true, headers: CG_HEADERS }));
    } catch (_) {
      ({ data } = await fetchJson(url, { proxy: true })); // keyless public-tier fallback
    }
    return {
      ...base,
      ok: true,
      value: data.total_volume.usd,
      changePct: data.market_cap_change_percentage_24h_usd,
      series: [],
    };
  } catch (e) {
    return { ...base, ok: false, value: null, changePct: null, series: [], note: String(e.message || e) };
  }
}

async function fearGreed() {
  const base = { id: 'fng', group: 'crypto-macro', name: 'Fear & Greed', sub: 'sentiment', unit: 'index' };
  try {
    const j = await fetchJson('https://api.alternative.me/fng/?limit=40');
    const list = (j.data || []).slice().reverse();
    const latest = list[list.length - 1];
    return { ...base, ok: true, value: Number(latest.value), label: latest.value_classification, series: list.map((d) => Number(d.value)), changePct: null };
  } catch (e) {
    return { ...base, ok: false, value: null, series: [], note: String(e.message || e) };
  }
}

/* ------------------------- CRYPTO: micro (assets) ------------------------- */

// BTC & ETH shown as PRICE (+24h change), one batched CoinGecko call, llama price fallback.
const PRICE_DEFS = [
  { id: 'btc', gecko: 'bitcoin', name: 'BTC', logo: 'bitcoin', accent: '#f7931a' },
  { id: 'eth', gecko: 'ethereum', name: 'ETH', logo: 'ethereum', accent: '#627eea' },
];

async function coinPrices() {
  const mk = (d, extra) => {
    const m = { id: d.id, group: 'crypto', name: d.name, sub: 'Price', unit: 'usd-price', logo: d.logo, accent: d.accent, ...extra };
    // my position, on a PRICE basis (no market cap tracked for BTC/ETH here)
    if (m.ok && m.value > 0) m.position = computePosition(positionsFor(d.id, d.name), m.value, null);
    return m;
  };
  // `sparkline` is omitted on purpose: BTC/ETH rows show price + 24h only (no chart),
  // so pulling 7 days of hourly points every refresh was wasted payload.
  const url =
    'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&sparkline=false&price_change_percentage=24h';
  try {
    // Keyless public tier FIRST for this one: it's fetched on every refresh, and the
    // demo key's 10k/month quota cannot sustain that (~58k/month would be needed).
    // The key is kept only as a fallback if the public tier throttles us.
    let arr;
    try {
      arr = await fetchJson(url, { proxy: true });
    } catch (_) {
      arr = await fetchJson(url, { proxy: true, headers: CG_HEADERS });
    }
    const map = {};
    arr.forEach((c) => (map[c.id] = c));
    return PRICE_DEFS.map((d) => {
      const c = map[d.gecko];
      if (!c) return mk(d, { ok: false, value: null, changePct: null, series: [] });
      return mk(d, { ok: true, value: c.current_price, changePct: c.price_change_percentage_24h, series: [] });
    });
  } catch (e) {
    try {
      const j = await fetchJson('https://coins.llama.fi/prices/current/coingecko:bitcoin,coingecko:ethereum');
      return PRICE_DEFS.map((d) => {
        const p = j.coins['coingecko:' + d.gecko];
        if (!p) return mk(d, { ok: false, value: null, changePct: null, series: [], note: String(e.message || e) });
        return mk(d, { ok: true, value: p.price, changePct: null, series: [], note: 'coingecko blocked, llama price' });
      });
    } catch (e2) {
      return PRICE_DEFS.map((d) => mk(d, { ok: false, value: null, changePct: null, series: [], note: String(e.message || e) }));
    }
  }
}

// Per-chain 24h DEX volume from DefiLlama (money flowing through the chain today).
function chainDex(id, slug, name, meta) {
  return async function () {
    const base = { id, group: 'crypto', name, sub: '24H DEX Vol', unit: 'usd', ...meta };
    try {
      const j = await fetchJson(
        `https://api.llama.fi/overview/dexs/${slug}?excludeTotalDataChartBreakdown=true&dataType=dailyVolume`
      );
      const series = downsample((j.totalDataChart || []).map((p) => p[1]));
      return { ...base, ok: true, value: j.total24h, changePct: j.change_1d, series };
    } catch (e) {
      return { ...base, ok: false, value: null, changePct: null, series: [], note: String(e.message || e) };
    }
  };
}

/* ------------------------- caching infrastructure ------------------------- */

// Disk-backed cache. Without this every restart re-downloads all logos and charts,
// which is what actually trips GeckoTerminal's per-minute limit during development.
const CACHE_DIR = path.join(__dirname, '..', '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'tokens.json');
let _disk = { logos: {}, charts: {}, pools: {} };
try {
  _disk = Object.assign(_disk, JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')));
} catch (_) {
  /* first run / unreadable -> start empty */
}
let _saveTimer = null;
let _dirty = false;
function flushDisk() {
  if (!_dirty) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(_disk));
    _dirty = false;
  } catch (_) {
    /* cache is best-effort */
  }
}
function saveDisk() {
  _dirty = true;
  clearTimeout(_saveTimer); // debounce: one tick touches many entries
  _saveTimer = setTimeout(flushDisk, 2000);
  if (_saveTimer.unref) _saveTimer.unref(); // don't hold a short-lived CLI open
}
// Flush on exit too, otherwise anything written in the last 2s is lost — which is
// exactly what happens to short-lived runs and to the widget being killed.
process.once('exit', flushDisk);

// Wrap a provider so it only re-fetches after `ttl` ms. `ttl` may be a function for
// schedules that vary (e.g. US stocks: fast while the market is open, slow when shut).
// Failures are NOT cached, so a broken source retries on the next tick.
function cached(fn, ttl) {
  let last = { ts: 0, value: null };
  return async function () {
    const ms = typeof ttl === 'function' ? ttl() : ttl;
    if (last.value && Date.now() - last.ts < ms) return last.value;
    const v = await fn();
    const ok = Array.isArray(v) ? v.some((x) => x && x.ok) : v && v.ok;
    if (ok) last = { ts: Date.now(), value: v };
    return v;
  };
}

// US equities only move during regular session hours; polling every 45s overnight is
// pure waste. Uses the IANA zone so DST is handled for us.
function usMarketOpen() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(new Date());
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    if (['Sat', 'Sun'].includes(get('weekday'))) return false;
    const mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
    return mins >= 9 * 60 + 30 && mins <= 16 * 60; // 09:30–16:00 ET
  } catch (_) {
    return true; // if we can't tell, stay fresh
  }
}

const MIN = 60_000;

// Resolved token logos, cached by address (value = data URI, or null when the token
// has no logo). Persisted, so a restart doesn't re-download every image.
const LOGO_CACHE = new Map(Object.entries(_disk.logos));

// Fetch a small image and inline it as a data: URI so it renders under the app's
// strict CSP (img-src 'self' data:) without opening up arbitrary remote origins.
// Proxy-capable, because image CDNs can be blocked on CN networks too.
async function fetchDataUri(url, { timeout = 12000, proxy = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const opts = { signal: ctrl.signal, headers: { 'User-Agent': UA } };
    if (proxy && proxyAgent) opts.dispatcher = proxyAgent;
    const res = await uFetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${buf.toString('base64')}`;
  } finally {
    clearTimeout(t);
  }
}

// DexScreener CMS images take width/height/quality params; request a small icon.
function shrinkLogo(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.has('width')) {
      u.searchParams.set('width', '128');
      u.searchParams.set('height', '128');
      if (u.searchParams.has('quality')) u.searchParams.set('quality', '80');
      return u.toString();
    }
  } catch (_) {
    /* not a rewritable URL — use as-is */
  }
  return url;
}

// Resolve a token's logo to a ready-to-render data URI exactly once, then cache it.
//   - success        -> cache + return the data URI
//   - no image at all -> cache null (show pure text, don't try again)
//   - transient fail  -> return undefined, stay uncached so a later refresh retries
async function resolveLogo(address, imageUrl) {
  if (LOGO_CACHE.has(address)) return LOGO_CACHE.get(address);
  if (!imageUrl) {
    LOGO_CACHE.set(address, null);
    _disk.logos[address] = null;
    saveDisk();
    return null;
  }
  try {
    const uri = await fetchDataUri(shrinkLogo(imageUrl), { proxy: true }).catch(() =>
      fetchDataUri(shrinkLogo(imageUrl))
    );
    LOGO_CACHE.set(address, uri);
    _disk.logos[address] = uri;
    saveDisk();
    return uri;
  } catch (_) {
    return undefined;
  }
}

// 48h price sparkline (1h candles) via GeckoTerminal's free OHLCV endpoint.
// Cached ~5min per pool (the data is hourly, so no need to refetch every 45s).
// The candles are 1-HOUR resolution, so refetching every 5 minutes was ~12x
// oversampling. 25 min keeps the sparkline current at a fraction of the calls.
// ±20% jitter per pool stops all watched tokens expiring on the same tick (a
// simultaneous burst is what trips the provider's per-minute limit).
const CHART_CACHE = new Map(Object.entries(_disk.charts)); // "net/pair" -> { ts, series }
const CHART_TTL = 25 * MIN;
const chartTtlFor = (key) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 1000;
  return CHART_TTL * (0.8 + (h / 1000) * 0.4); // deterministic per pool, 20–30 min
};
// Back off after a failed chart fetch. Without this a rate-limited chart is retried
// every tick, and those retries are exactly what keeps the limit tripped.
const CHART_FAIL = new Map(); // key -> don't-retry-before timestamp
const CHART_FAIL_BACKOFF = 5 * MIN;
// DexScreener chainId -> GeckoTerminal network slug (pass through when they match).
const GT_NET = {
  ethereum: 'eth',
  bsc: 'bsc',
  polygon: 'polygon_pos',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  avalanche: 'avax',
  base: 'base',
  solana: 'solana',
};

async function tokenChart(chainId, pair, token) {
  if (!chainId || !pair) return [];
  const net = GT_NET[chainId] || chainId;
  // Keyed by TOKEN, not pool: a token's "top pool" can change between refreshes, and
  // a pool-keyed cache would miss every time that happened even though the chart we
  // want ("this token's last 48h") is the same.
  const key = `${net}/${token || pair}`;
  const cached = CHART_CACHE.get(key);
  if (cached && Date.now() - cached.ts < chartTtlFor(key)) return cached.series;
  const retryAfter = CHART_FAIL.get(key);
  if (retryAfter && Date.now() < retryAfter) return cached ? cached.series : [];
  const url = `https://api.geckoterminal.com/api/v2/networks/${net}/pools/${pair}/ohlcv/hour?aggregate=1&limit=48&currency=usd`;
  try {
    let j;
    try {
      j = await fetchJson(url, { proxy: true, timeout: 12000 });
    } catch (_) {
      j = await fetchJson(url, { timeout: 12000 });
    }
    const list = (j && j.data && j.data.attributes && j.data.attributes.ohlcv_list) || [];
    // GeckoTerminal returns newest-first; reverse to chronological, take close (idx 4).
    const series = list
      .slice()
      .reverse()
      .map((r) => Number(r[4]))
      .filter((v) => !isNaN(v));
    if (series.length >= 2) {
      const entry = { ts: Date.now(), series };
      CHART_CACHE.set(key, entry);
      _disk.charts[key] = entry;
      CHART_FAIL.delete(key);
      saveDisk();
      return series;
    }
    CHART_FAIL.set(key, Date.now() + CHART_FAIL_BACKOFF); // empty/short payload
    return cached ? cached.series : [];
  } catch (_) {
    CHART_FAIL.set(key, Date.now() + CHART_FAIL_BACKOFF);
    return cached ? cached.series : []; // keep last good chart if a refresh fails
  }
}

/* --------------------------- my positions (buys) -------------------------- */
// Personal buy records live in a gitignored positions.json at the project root:
//   { "<coinId>": [ { "amount": <USD invested>, "mcap": <entry market cap USD> }, ... ] }
// (a buy may use "price" instead of "mcap"). Edit by hand or via record-buy.js.
const POSITIONS_PATH = path.join(__dirname, '..', '..', 'positions.json');
let _posCache = { mtime: -1, data: {} };

function loadPositions() {
  try {
    const st = fs.statSync(POSITIONS_PATH);
    if (st.mtimeMs !== _posCache.mtime) {
      _posCache = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(POSITIONS_PATH, 'utf8')) || {} };
    }
  } catch (_) {
    _posCache = { mtime: -1, data: {} }; // no file / bad JSON -> no positions
  }
  return _posCache.data;
}

// Aggregate buys into an average entry using the current price/mcap. Since price is
// proportional to market cap (fixed supply), P/L follows from the mcaps alone:
//   avgEntryMcap  = ΣAi / Σ(Ai/Mi)          (dollar-weighted harmonic mean)
//   avgEntryPrice = priceNow · avgEntryMcap / mcapNow
//   plPct         = (mcapNow / avgEntryMcap − 1) · 100
// A single buy reduces to entryMcap = M1 (first buy is the basis).
// `mcapNow` may be null (e.g. BTC/ETH, where we track price only) — then the whole
// calculation runs on a PRICE basis instead of a market-cap basis. Both bases use the
// same dollar-weighted harmonic mean, since price is proportional to market cap.
function computePosition(buys, priceNow, mcapNow) {
  if (!Array.isArray(buys) || !buys.length || !(priceNow > 0)) return null;
  const byMcap = mcapNow > 0;
  let totalAmount = 0;
  let sumAmtOverLevel = 0;
  for (const b of buys) {
    const amt = Number(b && b.amount);
    // this buy's entry level, in the same unit as the current figure
    let li = NaN;
    if (byMcap) {
      li = b && b.mcap != null ? Number(b.mcap) : b && b.price != null ? (Number(b.price) * mcapNow) / priceNow : NaN;
    } else {
      li = b && b.price != null ? Number(b.price) : NaN;
    }
    if (!(amt > 0) || !(li > 0)) continue;
    totalAmount += amt;
    sumAmtOverLevel += amt / li;
  }
  if (!(totalAmount > 0) || !(sumAmtOverLevel > 0)) return null;
  const entryLevel = totalAmount / sumAmtOverLevel;
  const nowLevel = byMcap ? mcapNow : priceNow;
  return {
    basis: byMcap ? 'mcap' : 'price',
    entryMcap: byMcap ? entryLevel : null,
    entryPrice: byMcap ? (priceNow * entryLevel) / mcapNow : entryLevel,
    plPct: (nowLevel / entryLevel - 1) * 100,
    invested: totalAmount,
  };
}

// Look up a coin's buys by id, or — forgivingly — by display name (case-insensitive),
// so a hand-edited positions.json can key on either "artificial-inu" or "AI".
function positionsFor(id, name) {
  const all = loadPositions();
  if (Array.isArray(all[id])) return all[id];
  const want = [id, name].filter(Boolean).map((s) => String(s).toLowerCase());
  for (const k of Object.keys(all)) {
    if (Array.isArray(all[k]) && want.includes(k.toLowerCase())) return all[k];
  }
  return null;
}

// Primary token source: DexScreener (any chain, no key). Returns normalized basics.
async function basicsFromDexScreener(address) {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
  let j;
  try {
    j = await fetchJson(url, { proxy: true, timeout: 12000 });
  } catch (_) {
    j = await fetchJson(url, { timeout: 12000 }); // proxy blocked -> try direct
  }
  const pairs = (j && j.pairs) || [];
  if (!pairs.length) throw new Error('no DEX pairs');
  // CRITICAL: DexScreener also returns pools where OUR token is the *quote* side
  // (e.g. "NVDAc/BLUECHIP"). In those, priceUsd/marketCap describe the OTHER token,
  // so using them reports a completely wrong price and market cap. Keep only pools
  // where our token is the base token.
  const want = String(address).toLowerCase();
  const ours = pairs.filter((p) => ((p.baseToken && p.baseToken.address) || '').toLowerCase() === want);
  if (!ours.length) throw new Error('no pairs quoting this token as base');
  // Some tokens also have spoof pools reporting fake liquidity + garbage prices
  // (e.g. priceUsd ~7e26). Keep only sane-priced pairs, then take the deepest
  // liquidity among those (fall back to all of ours if the filter empties it).
  const sane = ours.filter((p) => {
    const pr = Number(p.priceUsd);
    return Number.isFinite(pr) && pr > 0 && pr < 1e9;
  });
  const pool = sane.length ? sane : ours;
  const best = pool.reduce((a, b) =>
    ((b.liquidity && b.liquidity.usd) || 0) > ((a.liquidity && a.liquidity.usd) || 0) ? b : a
  );
  const pc = best.priceChange || {};
  return {
    symbol: (best.baseToken && best.baseToken.symbol) || null,
    price: Number(best.priceUsd),
    marketCap: best.marketCap != null ? Number(best.marketCap) : best.fdv != null ? Number(best.fdv) : null,
    changePct: pc.h24 != null ? Number(pc.h24) : null,
    imageUrl: (best.info && best.info.imageUrl) || null,
    net: best.chainId,
    pair: best.pairAddress,
    source: 'dexscreener',
  };
}

// Fallback token source: GeckoTerminal. Needed because DexScreener can be fully
// unreachable on some networks (TLS reset), while GeckoTerminal still resolves.
// Requires a network slug — from meta.net when known, else a few likely candidates.
async function basicsFromGecko(address, nets) {
  for (const net of nets) {
    try {
      const j = await fetchJson(
        `https://api.geckoterminal.com/api/v2/networks/${net}/tokens/${address}?include=top_pools`,
        { proxy: true, timeout: 12000 }
      );
      const a = j && j.data && j.data.attributes;
      const price = a && Number(a.price_usd);
      if (!a || !Number.isFinite(price) || !(price > 0)) continue;
      const poolInc = (j.included || []).find((x) => x.type === 'pool');
      const pa = (poolInc && poolInc.attributes) || {};
      // pool ids look like "<net>_<poolAddress>"
      const pair = poolInc && poolInc.id ? String(poolInc.id).replace(new RegExp('^' + net + '_'), '') : null;
      const mc = a.market_cap_usd != null ? Number(a.market_cap_usd) : a.fdv_usd != null ? Number(a.fdv_usd) : null;
      const h24 = pa.price_change_percentage && pa.price_change_percentage.h24;
      return {
        symbol: a.symbol || null,
        price,
        marketCap: Number.isFinite(mc) ? mc : null,
        changePct: h24 != null && h24 !== '' ? Number(h24) : null,
        imageUrl: a.image_url && a.image_url !== 'missing.png' ? a.image_url : null,
        net,
        pair,
        source: 'geckoterminal',
      };
    } catch (_) {
      /* try the next candidate network */
    }
  }
  throw new Error('no token data (DexScreener + GeckoTerminal both failed)');
}

/* ---------------------- batched token quotes (primary) --------------------- */
// One request per NETWORK instead of one per token. With 14 watched tokens across
// 3 networks that's 14 calls -> 3 per refresh. GeckoTerminal's multi-token endpoint
// also returns token-level data, so it can't pick a wrong-side pool the way a
// pool-level lookup can (see the base/quote pitfall in basicsFromDexScreener).
const NET_ADDRS = new Map(); // net -> Set(address), filled in as tokens are registered
function registerToken(net, address) {
  if (!net || !address) return;
  if (!NET_ADDRS.has(net)) NET_ADDRS.set(net, new Set());
  NET_ADDRS.get(net).add(address);
}

const NET_BATCH = new Map(); // net -> { ts, promise }
const BATCH_TTL = 40_000; // just under the refresh interval, so each tick is fresh

function fetchNetBatch(net) {
  const cur = NET_BATCH.get(net);
  if (cur && Date.now() - cur.ts < BATCH_TTL) return cur.promise; // also dedups the
  const addrs = [...(NET_ADDRS.get(net) || [])]; // concurrent callers within one tick
  if (!addrs.length) return Promise.resolve(new Map());
  const promise = (async () => {
    const url = `https://api.geckoterminal.com/api/v2/networks/${net}/tokens/multi/${addrs.join(',')}?include=top_pools`;
    const j = await fetchJson(url, { proxy: true, timeout: 15000 });
    const pools = new Map((j.included || []).filter((x) => x.type === 'pool').map((p) => [p.id, p.attributes || {}]));
    // Map results back to the exact address strings we asked for. Matching is done
    // case-insensitively (EVM is case-insensitive; Solana base58 stays unique anyway).
    const wantByLower = new Map(addrs.map((a) => [a.toLowerCase(), a]));
    const out = new Map();
    for (const d of j.data || []) {
      const a = d.attributes || {};
      const price = Number(a.price_usd);
      if (!Number.isFinite(price) || !(price > 0)) continue;
      const tp = d.relationships && d.relationships.top_pools && d.relationships.top_pools.data;
      const poolId = tp && tp[0] && tp[0].id;
      const pa = (poolId && pools.get(poolId)) || {};
      const h24 = pa.price_change_percentage && pa.price_change_percentage.h24;
      const mc = a.market_cap_usd != null ? Number(a.market_cap_usd) : a.fdv_usd != null ? Number(a.fdv_usd) : null;
      const key = wantByLower.get(String(a.address || '').toLowerCase()) || a.address;
      out.set(key, {
        symbol: a.symbol || null,
        price,
        marketCap: Number.isFinite(mc) ? mc : null,
        changePct: h24 != null && h24 !== '' ? Number(h24) : null,
        imageUrl: a.image_url && a.image_url !== 'missing.png' ? a.image_url : null,
        net,
        pair: poolId ? String(poolId).replace(net + '_', '') : null,
        source: 'geckoterminal-batch',
      });
    }
    return out;
  })();
  NET_BATCH.set(net, { ts: Date.now(), promise });
  promise.catch(() => NET_BATCH.delete(net)); // failure -> retry on the next tick
  return promise;
}

// Last-good snapshot per coin, so a transient outage of BOTH sources keeps showing
// recent numbers (marked stale) instead of blanking the whole row to "—".
const TOKEN_CACHE = new Map(); // id -> { ts, metric }
const TOKEN_TTL = 30 * MIN;

// Any DEX-traded token, looked up by CONTRACT ADDRESS. Shown as PRICE with its 24h
// change ("涨幅") + market cap + my position. Tries DexScreener, then GeckoTerminal.
function tokenDex(id, address, meta = {}) {
  registerToken(meta.net, address); // join this network's batched quote request
  return async function () {
    const base = { id, group: 'crypto', name: meta.name || id.toUpperCase(), sub: 'Price', unit: 'usd-price', ...meta };
    try {
      const candidates = meta.net ? [meta.net] : ['robinhood', 'eth', 'base', 'bsc', 'solana'];
      // 1) batched, token-level quote (1 request per network) — the cheap path
      let b = null;
      if (meta.net) {
        try {
          b = (await fetchNetBatch(meta.net)).get(address) || null;
        } catch (_) {
          /* fall through to the per-token sources */
        }
      }
      // 2) fall back to per-token lookups only if the batch didn't cover this token
      if (!b) {
        try {
          b = await basicsFromDexScreener(address);
        } catch (_) {
          b = await basicsFromGecko(address, candidates);
        }
      }
      // Fetch the logo and the 48h chart concurrently (both are best-effort).
      //   - Logo: manual local file (meta.logo) wins; else auto-fetch + inline. Stays
      //     undefined when there's no logo -> renderer shows plain text, no placeholder.
      //   - series: 48h/1h price sparkline; empty when unavailable -> no chart shown.
      const [iconUrl, series] = await Promise.all([
        meta.logo || meta.muted ? Promise.resolve(undefined) : resolveLogo(address, b.imageUrl),
        // muted coins aren't drawn, so their sparkline would be pure wasted calls
        meta.muted ? Promise.resolve([]) : tokenChart(b.net, b.pair, address),
      ]);
      const value = b.price;
      // my position (if I've recorded any buys for this coin)
      const position = computePosition(positionsFor(id, meta.name), value, b.marketCap);
      const metric = {
        ...base,
        name: meta.name || b.symbol || base.name,
        ok: true,
        value,
        changePct: b.changePct,
        marketCap: b.marketCap,
        iconUrl,
        series,
        position,
      };
      TOKEN_CACHE.set(id, { ts: Date.now(), metric });
      return metric;
    } catch (e) {
      // both sources failed -> reuse the last good numbers for a while
      const cached = TOKEN_CACHE.get(id);
      if (cached && Date.now() - cached.ts < TOKEN_TTL) {
        const mins = Math.round((Date.now() - cached.ts) / 60000);
        return { ...cached.metric, note: `stale ${mins}m (${String(e.message || e)})` };
      }
      return { ...base, ok: false, value: null, changePct: null, marketCap: null, series: [], note: String(e.message || e) };
    }
  };
}

/* ------------------------- US STOCKS (Tencent) ---------------------------- */

const STOCK_DEFS = [
  { id: 'spx', code: 'usINX', name: 'S&P 500', sub: 'Index', logo: 'sp500', accent: '#e2504a' },
  { id: 'ndx', code: 'usIXIC', name: 'Nasdaq', sub: 'Composite', logo: 'nasdaq', accent: '#2f7bff' },
  { id: 'hood', code: 'usHOOD', name: 'HOOD', sub: 'Robinhood Inc.', logo: 'robinhood', accent: '#00c805' },
  { id: 'soxx', code: 'usSOXX', name: 'Semis', sub: 'SOXX ETF', logo: 'soxx', accent: '#a855f7' },
];

async function tencentMinute(code) {
  try {
    const t = await fetchText(`https://web.ifzq.gtimg.cn/appstock/app/usMinute/query?code=${code}`);
    const j = JSON.parse(t);
    const key = Object.keys(j.data || {})[0];
    const rows = (j.data[key] && j.data[key].data && j.data[key].data.data) || [];
    return downsample(rows.map((r) => parseFloat(String(r).split(' ')[1])).filter((v) => !isNaN(v)));
  } catch (_) {
    return [];
  }
}

async function usStocks() {
  let quotes = {};
  try {
    const txt = await fetchText('https://qt.gtimg.cn/q=' + STOCK_DEFS.map((d) => d.code).join(','));
    for (const line of txt.split(';')) {
      const m = line.match(/v_(\w+)="([^"]*)"/);
      if (m) quotes[m[1]] = m[2].split('~');
    }
  } catch (_) {
    /* whole batch failed -> rows fall back to error state below */
  }

  return Promise.all(
    STOCK_DEFS.map(async (d) => {
      const base = { id: d.id, group: 'stocks', name: d.name, sub: d.sub, unit: 'index', logo: d.logo, accent: d.accent };
      const f = quotes[d.code];
      if (!f || !f[3]) return { ...base, ok: false, value: null, changePct: null, series: [], note: 'tencent no data' };
      const price = parseFloat(f[3]);
      const prev = parseFloat(f[4]);
      const changePct = prev ? ((price - prev) / prev) * 100 : null;
      const series = await tencentMinute(d.code);
      return { ...base, ok: true, value: price, changePct, series };
    })
  );
}

/* --------------------------- provider registry ---------------------------- */

// ---- Meme watchlist (swipe-right "MEME" page) -------------------------------
// Tokens tracked by CONTRACT ADDRESS via DexScreener (any chain, no API key).
// To watch another coin, append { id, address, name, sub, logo?, accent? }.
//   - id     : short unique key (a-z0-9-)
//   - address: the token contract address
//   - name   : shown as the row title (falls back to the on-chain symbol)
//   - sub    : small label under the name (e.g. "Cash Cat · RH")
//   - logo   : optional file renderer/assets/logos/<logo>.svg; omit for a glyph
//   - accent : optional brand color (reserved for future use)
// These render on page 2 (group 'meme'), NOT on the macro dashboard.
// `net` = GeckoTerminal network slug, used by the fallback source when DexScreener
// is unreachable (it also blocks/resets on some networks). Optional but recommended.
// `muted: true` = still fetched, but NOT shown on the page. Used for coins I've
// stopped actively watching (usually bagged/dead) where I only want to hear about it
// if the thing suddenly rips. Muted coins cost ~no extra API calls: they join their
// network's existing batched quote request and skip the chart fetch entirely.
const MEME_WATCH = [
  { id: 'cashcat', address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4', name: 'CASHCAT', sub: 'Cash Cat · RH', accent: '#00c805', net: 'robinhood', muted: true },
  { id: 'cate', address: 'Ai66LHZG9MCzg1WKdawwqduVAXpNDUuV8M3uyq5ppump', name: 'CATE', sub: 'Catecoin · SOL', accent: '#8b5cf6', net: 'solana' },
  { id: 'pons', address: '0x39dBED3a2bd333467115dE45665cC57F813C4571', name: 'PONS', sub: 'Pons · RH', accent: '#38bdf8', net: 'robinhood' },
  { id: 'bluechip', address: '0xB200000000000000000000cFbdF64a8706a94a01', name: 'BLUECHIP', sub: 'Blue Chip · BASE', accent: '#2563eb', net: 'base' },
  { id: 'artificial-inu', address: '0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18', name: 'AI', sub: 'Artificial Inu · RH', accent: '#22d3ee', net: 'robinhood' },
  { id: 'schiffy', address: '0x42aFA2124ca5a2B83898E46B2dA9a190995b1E18', name: 'SCHIFFY', sub: 'Schiffy · RH', accent: '#84cc16', net: 'robinhood' },
  { id: 'moo', address: '0xD9dB30BB0D2b8d2eae3826A1372117E058791e18', name: 'MOO', sub: 'Memory cow Moo · RH', accent: '#f472b6', net: 'robinhood' },
  { id: 'change', address: '0x8639b074da6a2903FAed8da95c0a3cB936f6AD91', name: 'CHANGE', sub: 'Spare Change · RH', accent: '#fbbf24', net: 'robinhood', muted: true },
  { id: 'goybeam', address: '0x1Fe2Abf68aad1d5b7A0339fBbFdbAd8E2b1d1E18', name: 'GOYBEAM', sub: 'Goybeam · RH', accent: '#a78bfa', net: 'robinhood', muted: true },
  { id: 'meme', address: '0x385F4f8ae47651ce5F58F5265395a669f8281e18', name: 'MEME', sub: 'A Meme Coin · RH', accent: '#fb7185', net: 'robinhood', muted: true },
  { id: 'stock', address: '0x4c11ddA6E46b6FB05CbFF870fb09954bfc3457fE', name: 'STOCK', sub: 'Stock Tokens · RH', accent: '#2dd4bf', net: 'robinhood', muted: true },
  { id: 'moonbase', address: '0xB200000000000000000000f065aAcB72155cC001', name: 'MOONBASE', sub: 'Moonbase · BASE', accent: '#818cf8', net: 'base' },
  { id: 'uranus', address: 'CTMV7yXV1mpucM7svPEtmVFBB8g6hqHGVPczmbYrj9Jb', name: 'URANUS', sub: 'Uranus · SOL', accent: '#38bdf8', net: 'solana' },
  { id: 'icoin', address: '0x5d6EF090a1461B11c9427aC319260122D1C61e18', name: 'ICOIN', sub: 'iCoin · RH', accent: '#e879f9', net: 'robinhood' },
];

// ---- Onchain projects (swipe-right page 3) -----------------------------------
// Same pipeline as MEME_WATCH (contract address -> price / mcap / logo / 48h chart /
// my position), just a separate bucket for real projects rather than memes.
const ONCHAIN_WATCH = [
  { id: 'nock', address: '0x9B5E262cF9bb04869ab40b19AF91D2dc85761722', name: 'NOCK', sub: 'Nockchain · BASE', accent: '#f59e0b', net: 'base' },
];

// Refresh cadence is matched to how fast each source actually changes, rather than
// polling everything on the same 45s tick. Prices (BTC/ETH + tokens) stay live;
// slow aggregates and the once-a-day sentiment index are cached.
const providers = [
  cached(cryptoGlobal, 10 * MIN), // 24h volume aggregate — moves slowly
  cached(fearGreed, 60 * MIN), // published once per day
  coinPrices, // BTC + ETH price (returns an array) — kept live
  cached(chainDex('sol', 'solana', 'SOL', { accent: '#14f195', logo: 'solana' }), 10 * MIN),
  cached(chainDex('bnb', 'bsc', 'BNB', { accent: '#f0b90b', logo: 'bnb' }), 10 * MIN),
  cached(chainDex('hood-chain', 'robinhood-chain', 'Robinhood', { accent: '#00c805', logo: 'robinhood' }), 10 * MIN),
  cached(chainDex('base', 'base', 'Base', { accent: '#0052ff', logo: 'base' }), 10 * MIN),
  // US equities are static outside the regular session
  cached(usStocks, () => (usMarketOpen() ? 45_000 : 30 * MIN)), // returns an array
  // Meme watchlist -> group 'meme' -> rendered on the swipe-right page.
  // `delayMs` staggers the coins ~250ms apart so a long watchlist doesn't hit the
  // token APIs as one simultaneous burst (which trips their per-second throttles).
  // No per-token stagger needed any more: tokens on the same network now share one
  // batched request, so a long watchlist is a handful of calls rather than dozens.
  ...MEME_WATCH.map((t) =>
    tokenDex(t.id, t.address, {
      group: 'meme',
      name: t.name,
      sub: t.sub,
      logo: t.logo,
      accent: t.accent,
      net: t.net,
      muted: t.muted,
    })
  ),
  // Onchain projects -> group 'onchain' -> rendered on page 3.
  ...ONCHAIN_WATCH.map((t) =>
    tokenDex(t.id, t.address, { group: 'onchain', name: t.name, sub: t.sub, logo: t.logo, accent: t.accent, net: t.net })
  ),
];

async function fetchSnapshot() {
  const results = await Promise.all(providers.map((p) => p().catch((e) => ({ ok: false, note: String(e) }))));
  const metrics = results.flat(); // usStocks returns an array
  return { ts: Date.now(), metrics };
}

module.exports = { fetchSnapshot, downsample, MEME_WATCH, ONCHAIN_WATCH };
