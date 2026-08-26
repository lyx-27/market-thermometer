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
  try {
    const { data } = await fetchJson('https://api.coingecko.com/api/v3/global', { proxy: true, headers: CG_HEADERS });
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
  const mk = (d, extra) => ({ id: d.id, group: 'crypto', name: d.name, sub: 'Price', unit: 'usd-price', logo: d.logo, accent: d.accent, ...extra });
  try {
    const arr = await fetchJson(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum&sparkline=true&price_change_percentage=24h',
      { proxy: true, headers: CG_HEADERS }
    );
    const map = {};
    arr.forEach((c) => (map[c.id] = c));
    return PRICE_DEFS.map((d) => {
      const c = map[d.gecko];
      if (!c) return mk(d, { ok: false, value: null, changePct: null, series: [] });
      return mk(d, { ok: true, value: c.current_price, changePct: c.price_change_percentage_24h, series: downsample(c.sparkline_in_7d.price) });
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

// Resolved meme-token logos, cached by address (value = data URI, or null when the
// token has no logo). Keeps us from re-downloading the image on every 45s refresh.
const LOGO_CACHE = new Map();

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
    return null;
  }
  try {
    const uri = await fetchDataUri(shrinkLogo(imageUrl), { proxy: true }).catch(() =>
      fetchDataUri(shrinkLogo(imageUrl))
    );
    LOGO_CACHE.set(address, uri);
    return uri;
  } catch (_) {
    return undefined;
  }
}

// 48h price sparkline (1h candles) via GeckoTerminal's free OHLCV endpoint.
// Cached ~5min per pool (the data is hourly, so no need to refetch every 45s).
const CHART_CACHE = new Map(); // "net/pair" -> { ts, series }
const CHART_TTL = 5 * 60 * 1000;
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

async function tokenChart(chainId, pair) {
  if (!chainId || !pair) return [];
  const net = GT_NET[chainId] || chainId;
  const key = `${net}/${pair}`;
  const cached = CHART_CACHE.get(key);
  if (cached && Date.now() - cached.ts < CHART_TTL) return cached.series;
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
    if (series.length >= 2) CHART_CACHE.set(key, { ts: Date.now(), series });
    return series.length >= 2 ? series : cached ? cached.series : [];
  } catch (_) {
    return cached ? cached.series : []; // keep last good chart if a refresh fails
  }
}

// Any DEX-traded token, looked up by CONTRACT ADDRESS via DexScreener (any chain,
// no API key). Shown as PRICE with its 24h change ("涨幅") + market cap. When a token
// trades in several pools we take the deepest-liquidity pair as the canonical quote.
function tokenDex(id, address, meta = {}) {
  return async function () {
    const base = { id, group: 'crypto', name: meta.name || id.toUpperCase(), sub: 'Price', unit: 'usd-price', ...meta };
    const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;
    try {
      // DexScreener is intermittently blocked on CN networks (like CoinGecko), so
      // try the local proxy first, then fall back to a direct connection.
      let j;
      try {
        j = await fetchJson(url, { proxy: true, timeout: 12000 });
      } catch (_) {
        j = await fetchJson(url, { timeout: 12000 });
      }
      const pairs = (j && j.pairs) || [];
      if (!pairs.length) throw new Error('no DEX pairs');
      const best = pairs.reduce((a, b) =>
        ((b.liquidity && b.liquidity.usd) || 0) > ((a.liquidity && a.liquidity.usd) || 0) ? b : a
      );
      const sym = (best.baseToken && best.baseToken.symbol) || base.name;
      const pc = best.priceChange || {};
      const marketCap =
        best.marketCap != null ? Number(best.marketCap) : best.fdv != null ? Number(best.fdv) : null;
      // Fetch the logo and the 48h chart concurrently (both are best-effort).
      //   - Logo: manual local file (meta.logo) wins; else auto-fetch + inline. Stays
      //     undefined when there's no logo -> renderer shows plain text, no placeholder.
      //   - series: 48h/1h price sparkline; empty when unavailable -> no chart shown.
      const [iconUrl, series] = await Promise.all([
        meta.logo ? Promise.resolve(undefined) : resolveLogo(address, best.info && best.info.imageUrl),
        tokenChart(best.chainId, best.pairAddress),
      ]);
      return {
        ...base,
        name: meta.name || sym,
        ok: true,
        value: Number(best.priceUsd),
        changePct: pc.h24 != null ? Number(pc.h24) : null,
        marketCap,
        iconUrl,
        series,
      };
    } catch (e) {
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
const MEME_WATCH = [
  { id: 'cashcat', address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4', name: 'CASHCAT', sub: 'Cash Cat · RH', accent: '#00c805' },
  { id: 'cate', address: 'Ai66LHZG9MCzg1WKdawwqduVAXpNDUuV8M3uyq5ppump', name: 'CATE', sub: 'Catecoin · SOL', accent: '#8b5cf6' },
  { id: 'pons', address: '0x39dBED3a2bd333467115dE45665cC57F813C4571', name: 'PONS', sub: 'Pons · RH', accent: '#38bdf8' },
  { id: 'bnbcat', address: '0x3EFBfFf95576e1d23cF6Ead0AcD2E73F4d6A7777', name: 'BNBCAT', sub: 'Binance Cat · BSC', accent: '#f0b90b' },
  { id: 'bluechip', address: '0xB200000000000000000000cFbdF64a8706a94a01', name: 'BLUECHIP', sub: 'Blue Chip · BASE', accent: '#2563eb' },
  { id: 'cyberleek', address: 'ApZuxdpzMrbEYTGEzeY9afh5pj9d6qPRJCTgQYiipbKg', name: 'CYBERLEEK', sub: 'CyberLeek · SOL', accent: '#22c55e' },
];

const providers = [
  cryptoGlobal,
  fearGreed,
  coinPrices, // BTC + ETH price (returns an array)
  chainDex('sol', 'solana', 'SOL', { accent: '#14f195', logo: 'solana' }),
  chainDex('bnb', 'bsc', 'BNB', { accent: '#f0b90b', logo: 'bnb' }),
  chainDex('hood-chain', 'robinhood-chain', 'Robinhood', { accent: '#00c805', logo: 'robinhood' }),
  chainDex('base', 'base', 'Base', { accent: '#0052ff', logo: 'base' }),
  usStocks, // returns an array -> flattened below
  // Meme watchlist -> group 'meme' -> rendered on the swipe-right page.
  ...MEME_WATCH.map((t) =>
    tokenDex(t.id, t.address, { group: 'meme', name: t.name, sub: t.sub, logo: t.logo, accent: t.accent })
  ),
];

async function fetchSnapshot() {
  const results = await Promise.all(providers.map((p) => p().catch((e) => ({ ok: false, note: String(e) }))));
  const metrics = results.flat(); // usStocks returns an array
  return { ts: Date.now(), metrics };
}

module.exports = { fetchSnapshot, downsample };
