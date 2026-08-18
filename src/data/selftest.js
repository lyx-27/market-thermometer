'use strict';

// Quick connectivity/self-test you can run on YOUR machine:  npm run check-apis
// It fetches one live snapshot and prints which sources are reachable.

const { fetchSnapshot } = require('./providers');

(async () => {
  console.log('Fetching a live snapshot from all sources...\n');
  const snap = await fetchSnapshot();
  let okCount = 0;
  for (const m of snap.metrics) {
    const status = m.ok ? 'OK ' : 'ERR';
    if (m.ok) okCount++;
    const val = m.value == null ? '—' : m.value;
    const chg = m.changePct == null ? '' : ` (${m.changePct >= 0 ? '+' : ''}${Number(m.changePct).toFixed(2)}%)`;
    const pts = m.series ? `${m.series.length}pts` : '0pts';
    console.log(
      `[${status}] ${String(m.name || m.id).padEnd(14)} ${String(val).padEnd(16)}${chg.padEnd(12)} ${pts}` +
        (m.note ? `  <- ${m.note}` : '')
    );
  }
  console.log(`\n${okCount}/${snap.metrics.length} sources reachable.`);
  process.exit(0);
})();
