import { useState, useEffect, useRef, useCallback } from 'react';

// ── Constants ──
const LAUFZEIT_OPTIONS = [
  { value: '12', label: '12 Monate (1 Jahr)' },
  { value: '24', label: '24 Monate (2 Jahre)' },
  { value: '36', label: '36 Monate (3 Jahre)' },
  { value: '48', label: '48 Monate (4 Jahre)' },
  { value: '60', label: '60 Monate (5 Jahre)' },
  { value: '72', label: '72 Monate (6 Jahre)' },
  { value: '84', label: '84 Monate (7 Jahre)' },
];

// ── Annuity formula ──
function berechneRate(betrag: number, zinsSatz: number, monate: number): number {
  if (zinsSatz === 0) return betrag / monate;
  const r = zinsSatz / 100 / 12;
  return betrag * (r * Math.pow(1 + r, monate)) / (Math.pow(1 + r, monate) - 1);
}

// Effektivzins via bisection (includes Bearbeitungsgebühr)
function berechneEffektivzins(betrag: number, gebuehr: number, rate: number, monate: number): number {
  const nettoAuszahlung = betrag - gebuehr;
  if (nettoAuszahlung <= 0 || rate <= 0) return 0;
  let low = 0, high = 1; // monthly rate
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    let pv = 0;
    for (let m = 1; m <= monate; m++) {
      pv += rate / Math.pow(1 + mid, m);
    }
    if (pv > nettoAuszahlung) low = mid;
    else high = mid;
  }
  return ((low + high) / 2) * 12 * 100; // annual %
}

// ── Formatting ──
function fmtEUR(n: number, dec = 0): string {
  if (!isFinite(n) || isNaN(n)) return '0 €';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  }).format(n);
}

function formatNumber(v: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(v);
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Soft Warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  betrag: { min: 500, max: 500000, msgLow: 'Sehr kleiner Kreditbetrag.', msgHigh: 'Ungewöhnlich hoher Kreditbetrag.' },
  zins: { min: 0.5, max: 25, msgLow: 'Ungewöhnlich niedriger Zinssatz.', msgHigh: 'Ungewöhnlich hoher Zinssatz.' },
  gebuehr: { min: 0, max: 10000, msgLow: '', msgHigh: 'Hohe Bearbeitungsgebühr.' },
};

function SoftWarning({ fieldId, value }: { fieldId: string; value: number }) {
  const rule = SOFT_WARNINGS[fieldId];
  if (!rule) return null;
  let msg = '';
  if (value > 0 && value < rule.min && rule.msgLow) msg = rule.msgLow;
  else if (value > rule.max && rule.msgHigh) msg = rule.msgHigh;
  if (!msg) return null;
  return (
    <div style={{
      fontSize: '.78rem', color: '#b8860b', background: '#fef9ec',
      border: '1px solid #f0e6c8', borderRadius: '4px', padding: '6px 10px',
      marginTop: '4px', lineHeight: 1.4,
    }}>{msg}</div>
  );
}

// ── CalcInput ──
function CalcInput({ id, label, prefix, suffix, value, onChange, warnId }: {
  id: string; label: string; prefix?: string; suffix?: string;
  value: number; onChange: (id: string, val: number) => void; warnId?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const display = focused ? String(value || '') : prefix ? formatNumber(value) : formatRate(value);

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        {prefix && <span className="input-prefix">{prefix}</span>}
        <input
          ref={inputRef} type="text" id={id}
          className={prefix ? 'has-prefix' : suffix ? 'has-suffix' : ''}
          inputMode="decimal" value={display}
          onFocus={() => { setFocused(true); setTimeout(() => inputRef.current?.select(), 0); }}
          onBlur={() => { setFocused(false); setBlurred(true); }}
          onChange={(e) => onChange(id, parseFloat(e.target.value.replace(/[^0-9.\-]/g, '')) || 0)}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </div>
      {blurred && <SoftWarning fieldId={warnId || id} value={value} />}
    </div>
  );
}

// ── CalcSelect ──
function CalcSelect({ id, label, options, value, onChange }: {
  id: string; label: string; options: Array<{ value: string; label: string }>;
  value: string; onChange: (id: string, val: string) => void;
}) {
  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        <select id={id} value={value} onChange={(e) => onChange(id, e.target.value)}>
          {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>
    </div>
  );
}

// ── MoreOptions ──
function MoreOptions({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`more-options-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} type="button">
        <span className="arrow">▼</span> Weitere Optionen ({count})
      </button>
      <div className={`more-options ${open ? 'show' : ''}`}>{children}</div>
    </>
  );
}

// ── Event tracking ──
function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

// ── Share URL ──
function buildShareURL(values: Record<string, number | string>) {
  const PROD = 'https://sum.money/de/kreditrechner';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Main Component ──
export default function KreditrechnerCalculator() {
  const completionTracked = useRef(false);

  const [betrag, setBetrag] = useState(15000);
  const [zins, setZins] = useState(5.5);
  const [laufzeit, setLaufzeit] = useState('48');
  const [gebuehr, setGebuehr] = useState(0);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calc = useCallback(() => {
    const monate = parseInt(laufzeit);
    const rate = berechneRate(betrag, zins, monate);
    const gesamtkosten = rate * monate;
    const zinskosten = gesamtkosten - betrag;
    const effektivzins = gebuehr > 0
      ? berechneEffektivzins(betrag, gebuehr, rate, monate)
      : zins;

    setResultLabel('Monatliche Rate');
    setResultPrimary(fmtEUR(rate, 2));

    setResultDetails([
      { label: 'Gesamtkosten', value: fmtEUR(gesamtkosten, 2) },
      { label: 'Zinskosten', value: fmtEUR(zinskosten, 2) },
      { label: 'Effektiver Jahreszins', value: `${effektivzins.toFixed(2).replace('.', ',')} %` },
      { label: 'Laufzeit', value: `${monate} Monate` },
    ]);

    if (!completionTracked.current) {
      completionTracked.current = true;
      trackEvent('calc_complete', { variant: 'kredit' });
    }
  }, [betrag, zins, laufzeit, gebuehr]);

  useEffect(() => { calc(); }, [calc]);

  // URL parsing
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const g = (k: string, fb: number) => { const v = p.get(k); return v !== null ? parseFloat(v) || fb : fb; };
    if (p.has('betrag')) setBetrag(g('betrag', 15000));
    if (p.has('zins')) setZins(g('zins', 5.5));
    if (p.has('laufzeit')) setLaufzeit(p.get('laufzeit') || '48');
    if (p.has('gebuehr')) setGebuehr(g('gebuehr', 0));
    const urlV = p.get('v');
    if (urlV && urlV < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    const m: Record<string, (v: number) => void> = {
      'kr-betrag': setBetrag, 'kr-zins': setZins, 'kr-gebuehr': setGebuehr,
    };
    m[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'kr-laufzeit') setLaufzeit(val);
  };

  const doShowFeedback = (msg: string) => {
    setFeedbackMsg(msg); setShowFeedback(true);
    setTimeout(() => setShowFeedback(false), 2200);
  };

  const handleShare = () => {
    const url = buildShareURL({ betrag, zins, laufzeit, gebuehr });
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Kreditrechner — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link in Zwischenablage kopiert'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL({ betrag, zins, laufzeit, gebuehr })}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Ergebnis kopiert'));
  };

  return (
    <>
      <div className="calc-card animate-in delay-3">
        {showVersionBanner && (
          <div style={{
            background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px',
            padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            Rechner wurde seit Erstellung dieses Links aktualisiert.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        <div className="inputs-grid">
          <CalcInput id="kr-betrag" label="Kreditbetrag" prefix="€" value={betrag} onChange={handleInput} warnId="betrag" />
          <CalcInput id="kr-zins" label="Sollzins (p.a.)" suffix="%" value={zins} onChange={handleInput} warnId="zins" />
        </div>
        <MoreOptions count={2}>
          <div className="inputs-grid">
            <CalcSelect id="kr-laufzeit" label="Laufzeit" options={LAUFZEIT_OPTIONS} value={laufzeit} onChange={handleSelect} />
            <CalcInput id="kr-gebuehr" label="Bearbeitungsgebühr" prefix="€" value={gebuehr} onChange={handleInput} warnId="gebuehr" />
          </div>
        </MoreOptions>

        <div className="result-card">
          <div className="result-label">{resultLabel}</div>
          <div className="result-primary">{resultPrimary}</div>
          <div className="result-details">
            {resultDetails.map((d, i) => (
              <div key={i} className="result-detail">
                <span className="result-detail-label">{d.label}</span>
                <span className="result-detail-value">{d.value}</span>
              </div>
            ))}
          </div>
          <div className="result-actions">
            <button className="btn btn-primary" onClick={handleShare}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              Teilen
            </button>
            <button className="btn btn-ghost" onClick={handleCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Ergebnis kopieren
            </button>
          </div>
        </div>
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
