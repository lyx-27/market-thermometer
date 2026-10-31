'use strict';
/*
 * Record a buy into positions.json (shown as "my position" in Meme Watch).
 *
 *   node record-buy.js <coinId> <amountUSD> [entryMcap]
 *
 *   node record-buy.js cate 500            -> captures the CURRENT market cap as entry
 *   node record-buy.js ai   300 90000000   -> explicit entry market cap ($90M)
 *
 * <coinId> matches an id in MEME_WATCH (src/data/providers.js): cate, pons, bluechip, ai, ...
 * Multiple buys for the same coin are dollar-weighted into one average entry.
 */

const fs = require('fs');
const path = require('path');

const POS = path.join(__dirname, 'positions.json');

function usage(msg) {
  if (msg) console.error('Error: ' + msg + '\n');
  console.log('Usage: node record-buy.js <coinId> <amountUSD> [entryMcap]');
  console.log('  node record-buy.js cate 500            # capture current mcap');
  console.log('  node record-buy.js ai 300 90000000     # explicit entry mcap ($90M)');
  process.exit(msg ? 1 : 0);
}

(async () => {
  const [, , idArg, amountStr, mcapStr] = process.argv;
  if (!idArg || !amountStr) usage(!idArg ? 'coinId required' : 'amountUSD required');
  const amount = Number(amountStr);
  if (!(amount > 0)) usage('amountUSD must be a positive number');

  // resolve input to a canonical coin id (accepts id OR display name, any case).
  // Meme coins are tracked by entry MARKET CAP; BTC/ETH by entry PRICE.
  const { MEME_WATCH, ONCHAIN_WATCH, fetchSnapshot } = require('./src/data/providers');
  const PRICE_BASIS = [
    { id: 'btc', name: 'BTC' },
    { id: 'eth', name: 'ETH' },
  ];
  const TOKENS = [...MEME_WATCH, ...(ONCHAIN_WATCH || [])];
  const match = (c) =>
    c.id.toLowerCase() === idArg.toLowerCase() || String(c.name || '').toLowerCase() === idArg.toLowerCase();
  const coin = TOKENS.find(match) || PRICE_BASIS.find(match);
  if (!coin) {
    usage(`unknown coin "${idArg}". Valid: ${[...TOKENS, ...PRICE_BASIS].map((c) => c.id).join(', ')}`);
  }
  const id = coin.id;
  const byPrice = PRICE_BASIS.some((c) => c.id === id); // BTC/ETH -> entry price basis
  const levelName = byPrice ? 'entryPrice' : 'entryMcap';

  let level = mcapStr != null ? Number(mcapStr) : null; // entry mcap, or entry price for BTC/ETH
  let price = null;
  if (level != null && !(level > 0)) usage(`${levelName} must be a positive number`);

  if (level == null) {
    console.log(`Fetching current ${byPrice ? 'price' : 'market cap'} for "${coin.name}" (${id})...`);
    const snap = await fetchSnapshot();
    const m = snap.metrics.find((x) => x.id === id);
    if (!m || !m.ok || !(m.value > 0) || (!byPrice && !(m.marketCap > 0))) {
      usage(`could not fetch current data for "${id}". Pass ${levelName} explicitly, e.g. node record-buy.js ${id} ${amount} ${byPrice ? '65000' : '50000000'}`);
    }
    price = m.value;
    level = byPrice ? m.value : m.marketCap;
    console.log(`captured: price=$${price}${byPrice ? '' : `  mcap=$${Math.round(level).toLocaleString()}`}`);
  }

  const data = fs.existsSync(POS) ? JSON.parse(fs.readFileSync(POS, 'utf8') || '{}') : {};
  if (!Array.isArray(data[id])) data[id] = [];
  const buy = byPrice ? { amount, price: level } : { amount, mcap: level };
  if (!byPrice && price != null) buy.price = price;
  buy.ts = new Date().toISOString();
  data[id].push(buy);
  fs.writeFileSync(POS, JSON.stringify(data, null, 2) + '\n');

  const invested = data[id].reduce((s, b) => s + (Number(b.amount) || 0), 0);
  console.log(
    `\nrecorded buy for ${id}: $${amount} @ ${byPrice ? 'price $' + level : 'mcap $' + Math.round(level).toLocaleString()}`
  );
  console.log(`${id} now has ${data[id].length} buy(s), total invested $${invested.toLocaleString()}`);
  console.log('(the widget picks it up on the next 45s refresh, or restart it)');
  process.exit(0);
})().catch((e) => {
  console.error('Failed:', e && e.message);
  process.exit(1);
});
