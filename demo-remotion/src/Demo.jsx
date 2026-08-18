import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  interpolateColors,
  spring,
  Easing,
} from 'remotion';
import { MarketGlass } from './MarketGlass';

const WW = 486;
const WH = 288;
const ORANGE = '#ff9a3c';

/* ------------------------------ formatting ------------------------------- */
function fmtUsd(n) {
  const abs = Math.abs(n);
  if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
}
function fmtPrice(n) {
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '$' + n.toFixed(4);
}
function fmtIndex(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function tri(frame, a, b) {
  return interpolate(frame, [a, (a + b) / 2, b], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

/* ----------------------- animated orange highlight ----------------------- */
function Highlight({ frame, rect, from, to }) {
  if (frame < from - 2 || frame > to + 14) return null;
  const { l, t, w, h } = rect;
  const r = 11;
  const perim = 2 * (w + h);
  const drawn = interpolate(frame, [from, from + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const fade = frame > to ? interpolate(frame, [to, to + 14], [1, 0], { extrapolateRight: 'clamp' }) : 1;
  const glow = 0.5 + 0.5 * Math.sin(frame / 5);
  // glow reduced ~60% so it doesn't wash out the content inside the ring
  return (
    <svg width={WW} height={WH} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', opacity: fade }}>
      <rect x={l} y={t} width={w} height={h} rx={r} ry={r}
        fill="rgba(255,154,60,0.04)" stroke={ORANGE} strokeWidth={2}
        strokeDasharray={perim} strokeDashoffset={perim * (1 - drawn)}
        style={{ filter: `drop-shadow(0 0 ${2 + glow * 2}px rgba(255,154,60,${0.26 + glow * 0.14}))` }} />
    </svg>
  );
}

/* --------------------------------- demo ---------------------------------- */
export const Demo = ({ orientation = 'landscape' }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const portrait = orientation === 'portrait';

  // widget kept centered (fixes "too low")
  const widgetLeft = (W - WW) / 2;
  const widgetTop = portrait ? (H - WH) / 2 - 60 : (H - WH) / 2;
  const wx = widgetLeft + WW / 2;
  const wy = widgetTop + WH / 2;
  const cx = W / 2;
  const cy = H / 2;

  // feature rects (local to widget)
  const rPulse = { l: 9, t: 22, w: 468, h: 48 };
  const rCrypto = { l: 9, t: 72, w: 150, h: 120 };
  const rFlowStock = { l: 166, t: 72, w: 311, h: 174 };
  const rTime = { l: 286, t: 248, w: 191, h: 14 };
  const rSlider = { l: 9, t: 266, w: 468, h: 18 };
  const cxScene = (r) => widgetLeft + r.l + r.w / 2;
  const cyScene = (r) => widgetTop + r.t + r.h / 2;

  // ---- camera: widget always vertically centered (fy = wy); pan horizontally + zoom ----
  const Cx = cxScene(rCrypto);
  const Mx = cxScene(rFlowStock);
  const KF =    [0,  58, 130, 152, 214, 236, 300, 322, 386, 404, 452, 470, 522, 540];
  const zoomA = [1,   1, 1.85, 2.3, 2.3, 3.0, 3.0, 2.15, 2.15, 2.7, 2.7, 2.5, 2.5, 1.5];
  const fxA =   [cx, cx, wx,  wx,  wx,  Cx,  Cx,  Mx,  Mx,  wx,  wx,  wx,  wx,  wx];
  const ease = { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };
  const zoom = interpolate(frame, KF, zoomA, ease);
  const fx = interpolate(frame, KF, fxA, ease);
  const fy = wy; // vertical always centered
  const camX = cx - fx * zoom;
  const camY = cy - fy * zoom;

  // ---- cursor + click (establishing) ----
  const dockY = H - 78;
  const cursorX = interpolate(frame, [0, 48], [cx - 30, cx + 20], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const cursorY = interpolate(frame, [0, 48], [H * 0.6, dockY], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const press = interpolate(frame, [48, 52, 58], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const cursorOpacity = interpolate(frame, [60, 78], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // ---- widget appear ----
  const appear = spring({ frame: frame - 54, fps, config: { damping: 15, mass: 0.9 } });
  const appearScale = interpolate(appear, [0, 1], [0.9, 1]);
  const appearY = interpolate(appear, [0, 1], [24, 0]);
  const appearBlur = interpolate(appear, [0, 1], [16, 0]);

  // ---- data ----
  const grow = (from, to, a = 66, b = 150) => interpolate(frame, [a, b], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const eVol = tri(frame, 152, 214);
  const eCrypto = tri(frame, 236, 300);
  const eFlow = tri(frame, 322, 386);
  const s1 = Math.sin(frame / 6);
  const s2 = Math.sin(frame / 7 + 1.3);

  const fngBase = frame < 150 ? 48 : interpolate(frame, [150, 208], [48, 62], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fngVal = Math.round(fngBase + eVol * s1 * 2);
  const fngLabel = fngVal >= 54 ? 'GREED' : fngVal >= 46 ? 'NEUTRAL' : 'FEAR';

  const volVal = grow(0, 128.4e9) + eVol * s1 * 0.7e9;
  const volChg = grow(0, 12.7) + eVol * s1 * 0.6;
  const btc = grow(0, 97320) + eCrypto * s1 * 150;
  const eth = grow(0, 3480) + eCrypto * s2 * 9;
  const solV = grow(0, 2.4e9) + eFlow * s1 * 0.12e9;
  const bnbV = grow(0, 1.1e9) + eFlow * s2 * 0.06e9;
  const hoodV = grow(0, 1.8e8) + eFlow * s1 * 0.15e8;
  const maxFlow = 2.4e9;
  const barGrow = interpolate(frame, [120, 210], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const coins = [
    { name: 'BTC', sub: 'Price', logo: 'bitcoin', valueText: fmtPrice(btc), chg: 2.41 + eCrypto * s1 * 0.3 },
    { name: 'ETH', sub: 'Price', logo: 'ethereum', valueText: fmtPrice(eth), chg: 1.83 + eCrypto * s2 * 0.25 },
  ];
  const flows = [
    { name: 'SOL', sub: '24H DEX Vol', logo: 'solana', valueText: fmtUsd(solV), chg: 18.2 + eFlow * s1 * 0.8, share: (solV / maxFlow) * barGrow },
    { name: 'BNB', sub: '24H DEX Vol', logo: 'bnb', valueText: fmtUsd(bnbV), chg: 6.4 + eFlow * s2 * 0.5, share: (bnbV / maxFlow) * barGrow },
    { name: 'Robinhood', sub: '24H DEX Vol', logo: 'robinhood', valueText: fmtUsd(hoodV), chg: 42.5 + eFlow * s1 * 1.1, share: (hoodV / maxFlow) * barGrow },
  ];
  const stocks = [
    { name: 'S&P 500', sub: 'Index', logo: 'sp500', valueText: fmtIndex(grow(0, 6120.34) + eFlow * s2 * 3), chg: 0.52 + eFlow * s2 * 0.12 },
    { name: 'Nasdaq', sub: 'Composite', logo: 'nasdaq', valueText: fmtIndex(grow(0, 20140.22) + eFlow * s1 * 6), chg: 0.81 + eFlow * s1 * 0.15 },
    { name: 'HOOD', sub: 'Robinhood Inc.', logo: 'robinhood', valueText: fmtPrice(grow(0, 58.31) + eFlow * s2 * 0.2), chg: 3.12 + eFlow * s2 * 0.3 },
    { name: 'Semis', sub: 'SOXX ETF', logo: 'soxx', valueText: fmtPrice(grow(0, 245.1)), chg: 1.18 },
  ];

  const accent = interpolateColors(frame, [300, 340], ['rgba(255,255,255,0.88)', 'rgba(120,200,255,0.96)']);
  const clockMs = 1700000000000 + Math.floor((frame / fps) * 1000) * 41;
  const updatedText = 'Updated ' + new Date(clockMs).toLocaleTimeString('en-US', { hour12: false });

  // ---- BACKGROUND occlusion slider (text/tooltips always 100%) ----
  // rests at 55 (frosted glass); demo sweeps 100 -> 0 -> back to 55.
  const occlusion = interpolate(frame, [470, 482, 512, 526], [0.55, 1.0, 0.0, 0.55], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const sliderPos = occlusion; // knob reflects background occlusion
  const wrapperOpacity = appear; // only the entrance fade — never fades text afterwards

  const titleP = spring({ frame: frame - 528, fps, config: { damping: 18 } });

  // callouts placed right above their focused module (screen space, orange border)
  const callouts = [
    { from: 152, to: 214, text: 'Fear & Greed + Volume', rect: rPulse },
    { from: 236, to: 300, text: 'BTC + ETH', rect: rCrypto },
    { from: 322, to: 386, text: 'Money Flow + Stocks', rect: rFlowStock },
    { from: 404, to: 452, text: 'Realtime Updates', rect: rTime },
    { from: 470, to: 516, text: 'Drag = Transparency', rect: rSlider },
  ];

  return (
    <AbsoluteFill style={{ background: '#0a0c12' }}>
      <AbsoluteFill style={{ transform: `translate(${camX}px, ${camY}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        <Img src={staticFile('desktop.jpg')} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />

        {frame < 80 && (
          <div style={{ opacity: cursorOpacity }}>
            <svg width="30" height="30" viewBox="0 0 24 24"
              style={{ position: 'absolute', left: cursorX, top: cursorY, transform: `scale(${1 - press * 0.2})`, filter: 'drop-shadow(0 3px 5px rgba(0,0,0,0.5))', zIndex: 50 }}>
              <path d="M4 2 L4 20 L9 15 L12.5 22 L15 21 L11.5 14 L18 14 Z" fill="#fff" stroke="#222" strokeWidth="1" />
            </svg>
          </div>
        )}

        {frame >= 32 && (
          <div style={{ position: 'absolute', left: widgetLeft, top: widgetTop, width: WW, height: WH, transform: `translateY(${appearY}px) scale(${appearScale})`, opacity: wrapperOpacity, filter: `blur(${appearBlur}px)` }}>
            <MarketGlass
              fngVal={fngVal} fngLabel={fngLabel} volText={fmtUsd(volVal)} volChg={volChg}
              coins={coins} flows={flows} stocks={stocks} accent={accent}
              liveText="9/9 live" updatedText={updatedText} sliderPos={sliderPos} occlusion={occlusion} />
            <Highlight frame={frame} rect={rPulse} from={152} to={214} />
            <Highlight frame={frame} rect={rCrypto} from={236} to={300} />
            <Highlight frame={frame} rect={rFlowStock} from={322} to={386} />
            <Highlight frame={frame} rect={rTime} from={404} to={452} />
            <Highlight frame={frame} rect={rSlider} from={470} to={516} />
          </div>
        )}
      </AbsoluteFill>

      {/* orange-bordered labels, glued just above each focused module */}
      {callouts.map((c, i) => {
        const inP = spring({ frame: frame - c.from, fps, config: { damping: 16, mass: 0.7 } });
        const outP = frame > c.to ? interpolate(frame, [c.to, c.to + 12], [0, 1], { extrapolateRight: 'clamp' }) : 0;
        const opacity = Math.max(0, inP - outP);
        if (opacity <= 0.001) return null;
        const rCx = widgetLeft + c.rect.l + c.rect.w / 2;
        const rCy = widgetTop + c.rect.t + c.rect.h / 2;
        const sx = cx + (rCx - fx) * zoom;
        const sy = cy + (rCy - fy) * zoom;
        const labelY = sy - (c.rect.h * zoom) / 2 - 38;
        const labelX = Math.max(160, Math.min(W - 160, sx));
        return (
          <div key={i}
            style={{
              position: 'absolute', left: labelX, top: labelY,
              transform: `translate(-50%, ${interpolate(inP, [0, 1], [14, 0])}px)`,
              opacity,
              padding: '8px 18px', borderRadius: 999,
              background: 'rgba(20,12,4,0.55)',
              border: `1.5px solid ${ORANGE}`,
              backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
              color: '#fff', fontFamily: '-apple-system, "SF Pro Display", sans-serif',
              fontSize: 24, fontWeight: 600, whiteSpace: 'nowrap',
              boxShadow: `0 8px 26px rgba(0,0,0,0.4)`,
            }}>
            {c.text}
          </div>
        );
      })}

      {frame > 528 && (
        <div style={{ position: 'absolute', bottom: 58, left: '50%', transform: `translate(-50%, ${interpolate(titleP, [0, 1], [18, 0])}px)`, opacity: titleP, textAlign: 'center' }}>
          <div style={{ color: '#fff', fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", -apple-system, sans-serif', fontSize: 46, fontWeight: 700, letterSpacing: 4, textShadow: '0 4px 20px rgba(0,0,0,0.55)' }}>
            市场温度计
          </div>
          <div style={{ color: 'rgba(255,255,255,0.78)', fontFamily: '-apple-system, "SF Pro Display", sans-serif', fontSize: 19, fontWeight: 500, letterSpacing: 5, textTransform: 'uppercase', marginTop: 7 }}>
            Market Thermometer
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
