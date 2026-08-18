# 市场温度计 · Market Thermometer

A macOS frosted-glass desktop widget for a **one-glance read of the market** — crypto prices, on-chain money flow, US stocks, and market sentiment, all in a single always-on pane.

![demo](docs/demo.gif)

## Why

Exchange apps show you only crypto, need a login, and demand you open them. Market Thermometer sits quietly on your desktop and answers three questions at a glance:

- **How hot is the market?** — Fear & Greed dial + total 24h volume.
- **Where is money flowing?** — per-chain 24h DEX volume (Solana / BNB / Robinhood chain).
- **What are prices doing?** — BTC / ETH and US indices (S&P 500, Nasdaq, HOOD, Semis).

Everything updates automatically. Drag the bottom slider to set the widget's background transparency (frosted-glass ↔ see-through).

## Features

- **Market temperature strip** — Fear & Greed gauge + total crypto 24h volume.
- **On-chain money flow** — 24h DEX volume per chain with relative-share bars.
- **Crypto & US stocks** — BTC/ETH prices and major US indices, with up/down deltas.
- **Adjustable background opacity** — a slider to control how much wallpaper shows through (text always stays fully readable).
- **Ambient & private** — no login, no account, runs locally; floats on top, visible on all Spaces.
- **China-network friendly** — DefiLlama + Tencent quotes go direct; CoinGecko can route through a local proxy.

## Requirements

- macOS
- [Node.js](https://nodejs.org/) ≥ 18

## Install & Run

```bash
npm install
npm start
```

Or double-click **`启动组件.command`** (runs in the background; you can close the terminal window afterwards).

The widget appears in the top-right of your screen. Hover it to reveal pin / refresh / close.

## API Key Setup

The widget works out of the box for most data (DefiLlama, Tencent, alternative.me). For CoinGecko global stats and BTC/ETH price it uses a **free CoinGecko demo key**:

1. Create a free key at the [CoinGecko developer dashboard](https://www.coingecko.com/en/developers/dashboard). It looks like `CG-xxxxxxxxxxxxxxxxxxxxxxxx`.
2. Provide it in **either** way:
   - Create a file named `api key` in the project root containing the key (this file is git-ignored), **or**
   - Set an environment variable: `export CG_DEMO_KEY=CG-your-key`.

See `.env.example` for all configurable variables.

### Optional: proxy

If CoinGecko is blocked on your network, route only its requests through a local HTTP proxy:

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

## Tech

Electron + vanilla JS renderer. All network access happens in the main process (no CORS). Data refreshes every 45s.

## License

MIT
