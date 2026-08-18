import { staticFile } from 'remotion';
import './widget.css';

const C = 97.39; // gauge circumference (r = 15.5)

function chgClass(v) {
  if (v == null) return 'flat';
  return v >= 0 ? 'up' : 'down';
}
function chgText(v) {
  if (v == null) return '·';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function Icon({ logo, name }) {
  if (logo) {
    return <img className="icon" src={staticFile(`logos/${logo}.svg`)} alt="" />;
  }
  return <div className="icon glyph">{(name || '•')[0]}</div>;
}

function PriceRow({ m }) {
  return (
    <div className="row">
      <Icon logo={m.logo} name={m.name} />
      <div className="meta">
        <div className="name">{m.name}</div>
        <div className="sub">{m.sub}</div>
      </div>
      <div className="right">
        <span className="value">{m.valueText}</span>
        <span className={`chg ${chgClass(m.chg)}`}>{chgText(m.chg)}</span>
      </div>
    </div>
  );
}

function FlowRow({ m }) {
  const width = Math.max(4, (m.share || 0) * 100);
  return (
    <div className="frow">
      <div className="frow-top">
        <Icon logo={m.logo} name={m.name} />
        <div className="meta">
          <div className="name">{m.name}</div>
          <div className="sub">{m.sub}</div>
        </div>
        <div className="right">
          <span className="value">{m.valueText}</span>
          <span className={`chg ${chgClass(m.chg)}`}>{chgText(m.chg)}</span>
        </div>
      </div>
      <div className="frow-bar">
        <div className="frow-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export const MarketGlass = ({
  fngVal,
  fngLabel,
  volText,
  volChg,
  coins,
  flows,
  stocks,
  accent,
  liveText,
  updatedText,
  sliderPos = 1,
  occlusion = 0.55,
}) => {
  const dashoffset = fngVal == null ? C : C * (1 - fngVal / 100);
  // occlusion = background-layer opacity ONLY (text/tooltips stay fully opaque).
  // 1 = wallpaper fully blocked, 0 = fully see-through, ~0.55 = frosted glass.
  const bgTop = (0.9 * occlusion).toFixed(3);
  const bgBot = (0.95 * occlusion).toFixed(3);
  const blur = (occlusion * 30).toFixed(1);
  return (
    <div
      className="widget"
      style={{
        '--accent': accent,
        background: `linear-gradient(158deg, rgba(38,44,62,${bgTop}) 0%, rgba(15,18,28,${bgBot}) 100%)`,
        backdropFilter: `blur(${blur}px) saturate(1.5)`,
        WebkitBackdropFilter: `blur(${blur}px) saturate(1.5)`,
      }}
    >
      <div className="titlebar">
        <div className="win-buttons">
          <span className="chip">📌</span>
          <span className="chip">↻</span>
          <span className="chip">✕</span>
        </div>
      </div>

      <div className="pulse">
        <div className="pulse-fng">
          <svg className="gauge" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="gauge-track" cx="18" cy="18" r="15.5" />
            <circle
              className="gauge-arc"
              cx="18"
              cy="18"
              r="15.5"
              style={{ strokeDashoffset: dashoffset }}
            />
          </svg>
          <div className="pulse-fng-txt">
            <div className="pulse-fng-val">{fngVal == null ? '—' : fngVal}</div>
            <div className="pulse-fng-lbl">{fngLabel}</div>
          </div>
        </div>
        <div className="pulse-sep" />
        <div className="pulse-vol">
          <div className="pulse-vol-label">TOTAL 24H VOLUME</div>
          <div className="pulse-vol-line">
            <span className="pulse-vol-val">{volText}</span>
            <span className={`chg ${chgClass(volChg)}`}>{chgText(volChg)}</span>
          </div>
        </div>
      </div>

      <div className="cols">
        <section className="col">
          <div className="col-head">
            <span className="dot" />
            Crypto
          </div>
          <div className="rows">
            {coins.map((m) => (
              <PriceRow key={m.name} m={m} />
            ))}
          </div>
        </section>

        <section className="col">
          <div className="col-head">
            <span className="dot dot-flow" />
            Money Flow
          </div>
          <div className="rows">
            {flows.map((m) => (
              <FlowRow key={m.name} m={m} />
            ))}
          </div>
        </section>

        <section className="col">
          <div className="col-head">
            <span className="dot" />
            US Stocks
          </div>
          <div className="rows">
            {stocks.map((m) => (
              <PriceRow key={m.name} m={m} />
            ))}
          </div>
        </section>
      </div>

      <div className="footer">
        <span>{liveText}</span>
        <span>{updatedText}</span>
      </div>

      <div className="slider">
        <span className="slider-label">OPACITY</span>
        <div className="slider-track">
          <div className="slider-fill" style={{ width: `${sliderPos * 100}%` }} />
          <div className="slider-knob" style={{ left: `${sliderPos * 100}%` }} />
        </div>
      </div>
    </div>
  );
};
