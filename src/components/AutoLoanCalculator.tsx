import { useState, useEffect, useRef, useCallback } from 'react';

// ── Formatting ──
function fmtUSD(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtUSD2(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0.00';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatCurrency(v: number): string { return v.toLocaleString('en-US'); }
function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Soft warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  price: { min: 1000, max: 500000, msgLow: 'Very low vehicle price.', msgHigh: 'Unusually high vehicle price.' },
  down: { min: 0, max: 500000, msgLow: '', msgHigh: 'Down payment seems very high.' },
  rate: { min: 0.1, max: 25, msgLow: '', msgHigh: 'Interest rate above 25% is unusually high.' },
  tradein: { min: 0, max: 200000, msgLow: '', msgHigh: 'Unusually high trade-in value.' },
};

function SoftWarning({ fieldId, value }: { fieldId: string; value: number }) {
  const rule = SOFT_WARNINGS[fieldId];
  if (!rule) return null;
  let msg = '';
  if (value > 0 && value < rule.min && rule.msgLow) msg = rule.msgLow;
  else if (value > rule.max && rule.msgHigh) msg = rule.msgHigh;
  if (!msg) return null;
  return (
    <div style={{ fontSize: '.78rem', color: '#b8860b', background: '#fef9ec', border: '1px solid #f0e6c8', borderRadius: '4px', padding: '6px 10px', marginTop: '4px', lineHeight: 1.4 }}>
      {msg}
    </div>
  );
}

// ── Input component ──
function CalcInput({ id, label, prefix, suffix, defaultValue, helpText, value, onChange }: {
  id: string; label: string; prefix?: string; suffix?: string; defaultValue: number; helpText?: string;
  value: number; onChange: (id: string, val: number) => void;
}) {
  const [displayValue, setDisplayValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) setDisplayValue(prefix ? formatCurrency(value) : formatRate(value));
  }, [value, focused, prefix]);

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        {prefix && <span className="input-prefix">{prefix}</span>}
        <input ref={inputRef} type="text" id={id} className={prefix ? 'has-prefix' : suffix ? 'has-suffix' : ''}
          inputMode="decimal" value={focused ? String(value || '') : displayValue}
          onFocus={() => { setFocused(true); setTimeout(() => inputRef.current?.select(), 0); }}
          onBlur={() => { setFocused(false); setBlurred(true); }}
          onChange={(e) => { const clean = e.target.value.replace(/[^0-9.\-]/g, ''); onChange(id, parseFloat(clean) || 0); }}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </div>
      {helpText && <small style={{ color: 'var(--ink-muted)', fontSize: '0.72rem', marginTop: '4px', display: 'block', lineHeight: 1.3 }}>{helpText}</small>}
      {blurred && <SoftWarning fieldId={id} value={value} />}
    </div>
  );
}

function CalcSelect({ id, label, options, value, onChange }: {
  id: string; label: string; options: { value: string; label: string }[]; value: string; onChange: (id: string, val: string) => void;
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

function MoreOptions({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`more-options-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} type="button">
        <span className="arrow">▼</span> More options ({count})
      </button>
      <div className={`more-options ${open ? 'show' : ''}`}>{children}</div>
    </>
  );
}

function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

function buildShareURL(values: Record<string, number | string>) {
  const PROD = 'https://sum.money/us/auto-loan-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

const TERM_OPTIONS = [
  { value: '24', label: '24 months (2 years)' },
  { value: '36', label: '36 months (3 years)' },
  { value: '48', label: '48 months (4 years)' },
  { value: '60', label: '60 months (5 years)' },
  { value: '72', label: '72 months (6 years)' },
  { value: '84', label: '84 months (7 years)' },
];

export default function AutoLoanCalculator() {
  const completionTracked = useRef(false);
  const [price, setPrice] = useState(35000);
  const [down, setDown] = useState(5000);
  const [rate, setRate] = useState(6.5);
  const [term, setTerm] = useState('60');
  const [tradein, setTradein] = useState(0);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string }>>([]);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calculate = useCallback(() => {
    const loanAmount = Math.max(price - down - tradein, 0);
    const months = parseInt(term);
    const monthlyRate = rate / 100 / 12;

    let payment: number;
    if (monthlyRate === 0) {
      payment = loanAmount / months;
    } else {
      const factor = Math.pow(1 + monthlyRate, months);
      payment = loanAmount * (monthlyRate * factor) / (factor - 1);
    }

    const totalPaid = payment * months;
    const totalInterest = totalPaid - loanAmount;

    setResultLabel('Your monthly payment');
    setResultPrimary(fmtUSD2(payment));
    setResultDetails([
      { label: 'Loan amount', value: fmtUSD(loanAmount) },
      { label: 'Total interest', value: fmtUSD(totalInterest) },
      { label: 'Total cost', value: fmtUSD(totalPaid + down + tradein) },
    ]);
  }, [price, down, rate, term, tradein]);

  useEffect(() => {
    calculate();
    if (!completionTracked.current) { completionTracked.current = true; trackEvent('calc_complete', { variant: 'auto-loan' }); }
  }, [calculate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('price') && !params.has('down')) return;
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('price')) setPrice(get('price', 35000));
    if (params.has('down')) setDown(get('down', 5000));
    if (params.has('rate')) setRate(get('rate', 6.5));
    if (params.has('term')) setTerm(params.get('term') || '60');
    if (params.has('tradein')) setTradein(get('tradein', 0));
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    if (id === 'price') setPrice(val);
    else if (id === 'down') setDown(val);
    else if (id === 'rate') setRate(val);
    else if (id === 'tradein') setTradein(val);
  };

  const handleSelect = (id: string, val: string) => { if (id === 'term') setTerm(val); };
  const getCurrentValues = () => ({ price, down, rate, term, tradein });

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Auto Loan Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };
  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Result copied'));
  };

  return (
    <>
      <div className="calc-card animate-in delay-3">
        {showVersionBanner && (
          <div style={{ background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px', padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Calculator updated since this link was created. Your inputs are preserved, but the result reflects current data.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        <div className="calc-section-label">Vehicle details</div>
        <div className="inputs-grid">
          <CalcInput id="price" label="Vehicle price" prefix="$" defaultValue={35000} value={price} onChange={handleInput} />
          <CalcInput id="down" label="Down payment" prefix="$" defaultValue={5000} value={down} onChange={handleInput} />
        </div>

        <MoreOptions count={3}>
          <div className="inputs-grid">
            <CalcInput id="rate" label="Interest rate (APR)" suffix="%" defaultValue={6.5} value={rate} onChange={handleInput} />
            <CalcSelect id="term" label="Loan term" options={TERM_OPTIONS} value={term} onChange={handleSelect} />
            <CalcInput id="tradein" label="Trade-in value" prefix="$" defaultValue={0} value={tradein} onChange={handleInput} />
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
              Share
            </button>
            <button className="btn btn-ghost" onClick={handleCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Copy result
            </button>
          </div>
        </div>
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
