'use strict';

/* ------------------------------ formatting ------------------------------- */

function fmtUsd(n) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}

function fmtIndex(n) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPrice(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Sub-cent memecoins need significant digits, not fixed decimals: at 4 decimals
  // $0.0002236 and $0.0003645 both collapse to "$0.0002"/"$0.0004".
  if (n < 0.01) return '$' + n.toLocaleString('en-US', { maximumSignificantDigits: 3 });
  return '$' + n.toFixed(4);
}

function fmtValue(m) {
  if (m.value == null) return '—';
  if (m.unit === 'usd') return fmtUsd(m.value);
  if (m.unit === 'usd-price') return fmtPrice(m.value);
  if (m.unit === 'index') return fmtIndex(m.value);
  return String(m.value);
}

function chgClass(v) {
  if (v == null) return 'flat';
  return v >= 0 ? 'up' : 'down';
}

function chgText(v) {
  if (v == null) return '·';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

/* --------------------------------- icons --------------------------------- */

function iconHtml(m) {
  if (m.logo) {
    return `<img class="icon" src="assets/logos/${m.logo}.svg" alt="" onerror="this.outerHTML='<div class=&quot;icon glyph&quot;>${(m.name || '•')[0]}</div>'" />`;
  }
  return `<div class="icon glyph">${(m.name || '•')[0]}</div>`;
}

/* ------------------------------ row builders ----------------------------- */

function priceRow(m) {
  const dim = m.ok ? '' : 'dim';
  // With a recorded buy, the sub line becomes my average entry + P/L% (more useful
  // than the static "Price" label, and keeps the row the same height).
  const p = m.position;
  // Kept terse on purpose: this sub line has ~87px in the narrow Crypto column, so
  // "MY @ $103,500 -12.34%" would clip. One decimal is plenty at a glance.
  const plShort = (v) => (v == null ? '·' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
  const sub = p
    ? `MY ${fmtPrice(p.entryPrice)} <span class="pos-pl ${chgClass(p.plPct)}">${plShort(p.plPct)}</span>`
    : m.sub || '';
  return `
    <div class="row ${dim}" title="${p ? 'my avg entry ' + fmtPrice(p.entryPrice) + ' · invested $' + p.invested.toFixed(2) : m.note || ''}">
      ${iconHtml(m)}
      <div class="meta">
        <div class="name">${m.name}</div>
        <div class="sub">${sub}</div>
      </div>
      <div class="right">
        <span class="value">${fmtValue(m)}</span>
        <span class="chg ${chgClass(m.changePct)}">${chgText(m.changePct)}</span>
      </div>
    </div>`;
}

function stockRow(m) {
  const dim = m.ok ? '' : 'dim';
  return `
    <div class="row ${dim}" title="${m.note || ''}">
      ${iconHtml(m)}
      <div class="meta">
        <div class="name">${m.name}</div>
        <div class="sub">${m.sub || ''}</div>
      </div>
      <div class="right">
        <span class="value">${fmtValue(m)}</span>
        <span class="chg ${chgClass(m.changePct)}">${chgText(m.changePct)}</span>
      </div>
    </div>`;
}

function flowRow(m, maxVal) {
  const dim = m.ok ? '' : 'dim';
  const share = m.value != null && maxVal > 0 ? Math.max(4, (m.value / maxVal) * 100) : 0;
  return `
    <div class="frow ${dim}" title="${m.note || ''}">
      <div class="frow-top">
        ${iconHtml(m)}
        <div class="meta">
          <div class="name">${m.name}</div>
          <div class="sub">${m.sub || ''}</div>
        </div>
        <div class="right">
          <span class="value">${fmtValue(m)}</span>
          <span class="chg ${chgClass(m.changePct)}">${chgText(m.changePct)}</span>
        </div>
      </div>
      <div class="frow-bar"><div class="frow-fill" style="width:${share}%"></div></div>
    </div>`;
}

// Compact 48h price sparkline (line + faint area), colored by the 48h trend.
// Returns '' when there aren't enough points, so the row simply shows no chart.
function sparklineSvg(series) {
  if (!Array.isArray(series) || series.length < 2) return '';
  const w = 66;
  const h = 22;
  const pad = 1.5;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const n = series.length;
  const X = (i) => pad + (i / (n - 1)) * (w - 2 * pad);
  const Y = (v) => h - pad - ((v - min) / range) * (h - 2 * pad);
  let d = '';
  for (let i = 0; i < n; i++) d += (i ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(series[i]).toFixed(1);
  const area = `${d} L${X(n - 1).toFixed(1)},${(h - pad).toFixed(1)} L${X(0).toFixed(1)},${(h - pad).toFixed(1)} Z`;
  const up = series[n - 1] >= series[0];
  return `<svg class="spark ${up ? 'spark-up' : 'spark-down'}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="spark-area" d="${area}" /><path class="spark-line" d="${d}" /></svg>`;
}

// Meme watch row: [logo?] name/sub · 48h chart · market cap · price/change.
// The logo is shown ONLY when we actually have an image (auto-fetched data URI, or a
// manually configured local file). With no image we render pure text and reserve NO
// space for an icon — a failed image also removes itself so nothing is left behind.
function memeRow(m) {
  const dim = m.ok ? '' : 'dim';
  let icon = '';
  if (m.iconUrl) {
    icon = `<img class="icon" src="${m.iconUrl}" alt="" onerror="this.remove()" />`;
  } else if (m.logo) {
    icon = `<img class="icon" src="assets/logos/${m.logo}.svg" alt="" onerror="this.remove()" />`;
  }
  const mc = m.marketCap != null ? fmtUsd(m.marketCap) : '—';
  const chart = sparklineSvg(m.series);
  // my position: entry market cap + P/L%. The cell is ALWAYS rendered (empty when I
  // hold nothing) so every column — charts included — lines up across all rows.
  const p = m.position;
  const posCol = p
    ? `<div class="pos-label">MY @ ${fmtUsd(p.entryMcap)}</div>
       <div class="pos-line"><span class="chg ${chgClass(p.plPct)}">${chgText(p.plPct)}</span></div>`
    : '';
  return `
    <div class="mrow ${dim}" title="${m.note || ''}">
      <div class="mrow-id">
        ${icon}
        <div class="meta">
          <div class="name">${m.name}</div>
          <div class="sub">${m.sub || ''}</div>
        </div>
      </div>
      <div class="mrow-chart" title="48h · 1h">${chart}</div>
      <div class="mrow-mc">
        <div class="mc-label">MCAP</div>
        <div class="mc-val">${mc}</div>
      </div>
      <div class="right">
        <span class="value">${fmtValue(m)}</span>
        <span class="chg ${chgClass(m.changePct)}">${chgText(m.changePct)}</span>
      </div>
      <div class="mrow-pos">${posCol}</div>
    </div>`;
}

/* ------------------------------- rendering ------------------------------- */

function render(snap) {
  const metrics = snap.metrics || [];
  const find = (id) => metrics.find((m) => m.id === id);

  // 体温条 — Fear & Greed dial
  const fng = find('fng');
  const arc = document.getElementById('fng-arc');
  const C = 97.39;
  if (fng && fng.ok && fng.value != null) {
    document.getElementById('fng-val').textContent = fng.value;
    document.getElementById('fng-lbl').textContent = (fng.label || 'Fear & Greed').toUpperCase();
    arc.style.strokeDashoffset = (C * (1 - fng.value / 100)).toFixed(2);
  } else {
    document.getElementById('fng-val').textContent = '—';
    document.getElementById('fng-lbl').textContent = 'FEAR & GREED';
    arc.style.strokeDashoffset = C;
  }

  // 体温条 — total 24h volume
  const global = find('cg-global');
  document.getElementById('vol-val').textContent = global && global.ok ? fmtUsd(global.value) : '—';
  const volChg = document.getElementById('vol-chg');
  volChg.className = 'chg ' + chgClass(global && global.ok ? global.changePct : null);
  volChg.textContent = chgText(global && global.ok ? global.changePct : null);

  // columns
  const cryptoPrices = metrics.filter((m) => m.group === 'crypto' && m.unit === 'usd-price');
  const flow = metrics.filter((m) => m.group === 'crypto' && m.unit === 'usd');
  const stocks = metrics.filter((m) => m.group === 'stocks');

  document.getElementById('crypto-rows').innerHTML = cryptoPrices.map(priceRow).join('');

  const maxFlow = Math.max(0, ...flow.map((m) => m.value || 0));
  document.getElementById('flow-rows').innerHTML = flow.map((m) => flowRow(m, maxFlow)).join('');

  document.getElementById('stock-rows').innerHTML = stocks.map(stockRow).join('');

  // pages 2 & 3 — token lists (same row layout, different buckets)
  const renderList = (group, rowsId, countId, emptyMsg) => {
    // `muted` coins are still fetched (for pump alerts) but deliberately not drawn
    const items = metrics.filter((m) => m.group === group && !m.muted);
    const rowsEl = document.getElementById(rowsId);
    if (rowsEl) {
      rowsEl.innerHTML = items.length
        ? items.map(memeRow).join('')
        : `<div class="list-empty">${emptyMsg}</div>`;
    }
    const countEl = document.getElementById(countId);
    if (countEl) countEl.textContent = items.length ? String(items.length) : '';
  };
  renderList('meme', 'meme-rows', 'meme-count', 'No meme coins on the watchlist yet.');
  renderList('onchain', 'onchain-rows', 'onchain-count', 'No onchain projects on the watchlist yet.');

  // footer
  const okCount = metrics.filter((m) => m.ok).length;
  document.getElementById('status').textContent = `${okCount}/${metrics.length} live`;
  document.getElementById('updated').textContent =
    'Updated ' + new Date(snap.ts).toLocaleTimeString('en-US', { hour12: false });
}

/* -------------------------------- wiring --------------------------------- */

window.api.onSnapshot(render);
window.api.onSnapshotError((msg) => {
  document.getElementById('status').textContent = 'Error: ' + msg;
});

document.getElementById('refresh').addEventListener('click', () => {
  document.getElementById('status').textContent = 'Refreshing…';
  window.api.refreshNow();
});
document.getElementById('close').addEventListener('click', () => window.api.closeApp());
document.getElementById('pin').addEventListener('click', async (e) => {
  // capture the button now: after `await`, event.currentTarget is null and
  // event.target could be the inner <svg>/<path> rather than the button.
  const btn = e.currentTarget;
  const pinned = await window.api.togglePin();
  btn.style.opacity = pinned ? '1' : '0.4';
});

/* ------------------ page carousel (macro ⟷ meme watch) ------------------- */
(function initPager() {
  const pages = document.getElementById('pages');
  const deck = document.getElementById('deck');
  const dots = Array.from(document.querySelectorAll('.pager-dot'));
  if (!pages || !deck) return;
  const PAGE_COUNT = dots.length || 3; // market · meme watch · onchain project
  let page = 0;
  let locked = false;
  let unlock = null;

  function go(p) {
    p = Math.max(0, Math.min(PAGE_COUNT - 1, p));
    if (p === page) return;
    page = p;
    pages.style.setProperty('--page', String(page));
    dots.forEach((d, i) => d.classList.toggle('is-active', i === page));
  }

  // click the dots to jump to a page
  dots.forEach((d) => d.addEventListener('click', () => go(Number(d.dataset.page))));

  // trackpad two-finger horizontal swipe (vertical wheel still scrolls lists)
  deck.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical intent -> let it scroll
      e.preventDefault();
      if (Math.abs(e.deltaX) < 18) return; // ignore tiny nudges
      clearTimeout(unlock);
      unlock = setTimeout(() => (locked = false), 200); // release shortly after momentum ends
      if (locked) return; // at most one page change per gesture
      locked = true;
      go(page + (e.deltaX > 0 ? 1 : -1));
    },
    { passive: false }
  );

  // arrow keys as a keyboard fallback
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(page + 1);
    else if (e.key === 'ArrowLeft') go(page - 1);
  });
})();

/* ---- background-opacity slider (background layer ONLY; text stays 100%) ---- */
(function initOpacitySlider() {
  const widget = document.querySelector('.widget');
  const track = document.getElementById('slider-track');
  const fill = document.getElementById('slider-fill');
  const knob = document.getElementById('slider-knob');
  if (!widget || !track) return;
  const KEY = 'mt-bg-occlusion';

  let occ = parseFloat(localStorage.getItem(KEY));
  if (isNaN(occ)) occ = 0.55; // frosted-glass default

  function apply(v) {
    occ = Math.max(0, Math.min(1, v));
    // occlusion drives the BACKGROUND layer only (text/tooltips stay 100%).
    // Everything is CSS so the transition is perfectly smooth:
    //   alpha + blur + shadow all interpolate together, 0 = fully see-through.
    widget.style.setProperty('--bg-a1', (occ * 0.9).toFixed(3));
    widget.style.setProperty('--bg-a2', (occ * 0.95).toFixed(3));
    widget.style.setProperty('--bg-blur', (occ * 30).toFixed(1) + 'px');
    widget.style.setProperty('--bg-shadow', (occ * 0.45).toFixed(3));
    const pct = (occ * 100).toFixed(1) + '%';
    fill.style.width = pct;
    knob.style.left = pct;
    localStorage.setItem(KEY, String(occ));
  }

  const ratio = (e) => {
    const r = track.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  };

  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    apply(ratio(e));
  });
  track.addEventListener('pointermove', (e) => {
    if (dragging) apply(ratio(e));
  });
  const stop = () => {
    dragging = false;
  };
  track.addEventListener('pointerup', stop);
  track.addEventListener('pointercancel', stop);

  apply(occ);
})();
