# 市场温度计 · Market Thermometer

A frosted-glass desktop widget (macOS & Windows) for a **one-glance read of the market** — crypto prices, on-chain money flow, US stocks, and market sentiment, plus a swipe-away **meme-coin watchlist** — all in a single always-on pane.

![demo](docs/demo.gif)

## Why

Exchange apps show you only crypto, need a login, and demand you open them. Market Thermometer sits quietly on your desktop and answers a few questions at a glance:

- **How hot is the market?** — Fear & Greed dial + total 24h volume.
- **Where is money flowing?** — per-chain 24h DEX volume (Solana / BNB / Robinhood / Base).
- **What are prices doing?** — BTC / ETH and US indices (S&P 500, Nasdaq, HOOD, Semis).
- **What are my meme coins doing?** — swipe to a personal watchlist: price, 24h change, market cap and a 48h mini-chart per coin.

Everything updates automatically. Drag the bottom slider to set the widget's background transparency (frosted-glass ↔ see-through).

## Features

- **Market temperature strip** — Fear & Greed gauge + total crypto 24h volume.
- **On-chain money flow** — 24h DEX volume per chain with relative-share bars.
- **Crypto & US stocks** — BTC/ETH prices and major US indices, with up/down deltas.
- **Meme-coin watch page** — swipe right to a second page that tracks any tokens by contract address: price, 24h change, market cap, an auto-fetched logo, and a 48h / 1h sparkline.
- **Adjustable background opacity** — a slider to control how much wallpaper shows through (text always stays fully readable).
- **Ambient & private** — no login, no account, runs locally; floats on top, visible on all Spaces.
- **China-network friendly** — DefiLlama + Tencent quotes go direct; CoinGecko / DexScreener / GeckoTerminal can route through a local proxy.

## Requirements

- macOS, or Windows 10/11
- [Node.js](https://nodejs.org/) ≥ 18

## Install & Run

```bash
npm install
npm start
```

Or, to run in the background (you can close the terminal afterwards):

- **macOS** — double-click **`启动组件.command`**
- **Windows** — double-click **`start.bat`** (details in [WINDOWS.md](WINDOWS.md))

The widget appears in the top-right of your screen. Hover it to reveal pin / refresh / close.

## Meme Watch

Swipe right — a two-finger horizontal trackpad swipe, the dots in the footer, or the ← / → arrow keys — to reach a second page that tracks your own meme coins. Swipe back for the original macro dashboard. Each row shows:

- **Logo** — auto-fetched from the token's listing; if none is available it degrades to plain text with no placeholder.
- **Price & 24h change**.
- **Market cap** — falls back to fully-diluted valuation (FDV) when a market cap isn't reported.
- **48h mini-chart** — a 1-hour-resolution sparkline, tinted green/red by the 48h trend.

### Add or remove a coin

Edit the `MEME_WATCH` list near the top of `src/data/providers.js`:

```js
const MEME_WATCH = [
  { id: 'cashcat', address: '0x020bfC…018b4', name: 'CASHCAT', sub: 'Cash Cat · RH' },
  { id: 'cate',    address: 'Ai66…pump',      name: 'CATE',    sub: 'Catecoin · SOL' },
  // add a line: { id, address, name, sub }  — id lowercase & unique
];
```

Any token listed on DexScreener works — EVM or Solana, just use its contract address. Market cap, logo and the 48h chart are filled in automatically; restart the widget to apply.

## API Key Setup

The widget works out of the box for most data (DefiLlama, Tencent, alternative.me, DexScreener, GeckoTerminal). For CoinGecko global stats and BTC/ETH price it uses a **free CoinGecko demo key**:

1. Create a free key at the [CoinGecko developer dashboard](https://www.coingecko.com/en/developers/dashboard). It looks like `CG-xxxxxxxxxxxxxxxxxxxxxxxx`.
2. Provide it in **either** way:
   - Create a file named `api key` in the project root containing the key (this file is git-ignored), **or**
   - Set an environment variable: `export CG_DEMO_KEY=CG-your-key`.

See `.env.example` for all configurable variables.

### Optional: proxy

If CoinGecko, DexScreener or GeckoTerminal are blocked on your network, route their requests through a local HTTP proxy (DefiLlama, Tencent and alternative.me always stay direct):

```bash
export MARKET_PROXY=http://127.0.0.1:7897
```

## Data Sources

| Data | Source |
|------|--------|
| Per-chain 24h DEX volume | DefiLlama |
| Crypto Fear & Greed | alternative.me |
| Global volume, BTC/ETH price | CoinGecko (demo key; proxy-capable) |
| US indices & stocks | Tencent quotes |
| Meme-coin price, market cap & logo | DexScreener (proxy-capable) |
| Meme-coin 48h price chart | GeckoTerminal (proxy-capable) |

## Tech

Electron + vanilla JS renderer. All network access happens in the main process (no CORS). Data refreshes every 45s; meme-coin logos and 48h charts are cached to stay light on their APIs.

## License

MIT
