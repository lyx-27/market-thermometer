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
  const pinned = await window.api.togglePin();
  e.target.style.opacity = pinned ? '1' : '0.4';
});

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
