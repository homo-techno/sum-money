import { useState, useEffect, useRef, useCallback } from 'react';

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

function CalcInput({ id, label, prefix, suffix, defaultValue, helpText, value, onChange }: {
  id: string; label: string; prefix?: string; suffix?: string; defaultValue: number; helpText?: string;
  value: number; onChange: (id: string, val: number) => void;
}) {
  const [displayValue, setDisplayValue] = useState('');
  const [focused, setFocused] = useState(false);
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
          onBlur={() => setFocused(false)}
          onChange={(e) => { onChange(id, parseFloat(e.target.value.replace(/[^0-9.\-]/g, '')) || 0); }}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </div>
      {helpText && <small style={{ color: 'var(--ink-muted)', fontSize: '0.72rem', marginTop: '4px', display: 'block', lineHeight: 1.3 }}>{helpText}</small>}
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
  const PROD = 'https://sum.money/us/mortgage-refinance-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

function calcPayment(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 100 / 12;
  if (r === 0) return principal / months;
  const factor = Math.pow(1 + r, months);
  return principal * (r * factor) / (factor - 1);
}

const TERM_OPTIONS = [
  { value: '10', label: '10 years' }, { value: '15', label: '15 years' },
  { value: '20', label: '20 years' }, { value: '25', label: '25 years' },
  { value: '30', label: '30 years' },
];

export default function MortgageRefinanceCalculator() {
  const completionTracked = useRef(false);

  const [balance, setBalance] = useState(280000);
  const [currentRate, setCurrentRate] = useState(7.5);
  const [newRate, setNewRate] = useState(6.0);
  const [remainingTerm, setRemainingTerm] = useState('25');
  const [newTerm, setNewTerm] = useState('30');
  const [closingCosts, setClosingCosts] = useState(3000);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calculate = useCallback(() => {
    const remainMonths = parseInt(remainingTerm) * 12;
    const newMonths = parseInt(newTerm) * 12;

    const oldPayment = calcPayment(balance, currentRate, remainMonths);
    const newPayment = calcPayment(balance, newRate, newMonths);

    const monthlySavings = oldPayment - newPayment;
    const oldTotalCost = oldPayment * remainMonths;
    const newTotalCost = newPayment * newMonths + closingCosts;
    const lifetimeSavings = oldTotalCost - newTotalCost;

    const breakEvenMonth = monthlySavings > 0 ? Math.ceil(closingCosts / monthlySavings) : 0;
    const breakEvenYears = Math.floor(breakEvenMonth / 12);
    const breakEvenMos = breakEvenMonth % 12;
    const breakEvenStr = monthlySavings > 0
      ? (breakEvenYears > 0 ? `${breakEvenYears}y ${breakEvenMos}m` : `${breakEvenMos} months`)
      : 'Never';

    const worthIt = monthlySavings > 0 && lifetimeSavings > 0;

    setResultLabel(monthlySavings > 0 ? 'Monthly savings' : 'Monthly increase');
    setResultPrimary((monthlySavings >= 0 ? '' : '+') + fmtUSD2(Math.abs(monthlySavings)) + '/mo');
    setResultDetails([
      { label: 'Current payment', value: fmtUSD2(oldPayment) },
      { label: 'New payment', value: fmtUSD2(newPayment), green: monthlySavings > 0 },
      { label: 'Break-even', value: breakEvenStr },
      { label: 'Total savings over life', value: fmtUSD(lifetimeSavings), green: lifetimeSavings > 0, red: lifetimeSavings < 0 },
      { label: 'Verdict', value: worthIt ? 'Refinance makes sense' : 'Not worth refinancing', green: worthIt, red: !worthIt },
    ]);
  }, [balance, currentRate, newRate, remainingTerm, newTerm, closingCosts]);

  useEffect(() => {
    calculate();
    if (!completionTracked.current) { completionTracked.current = true; trackEvent('calc_complete', { variant: 'mortgage-refi' }); }
  }, [calculate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('balance')) return;
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('balance')) setBalance(get('balance', 280000));
    if (params.has('currentRate')) setCurrentRate(get('currentRate', 7.5));
    if (params.has('newRate')) setNewRate(get('newRate', 6.0));
    if (params.has('remainTerm')) setRemainingTerm(params.get('remainTerm') || '25');
    if (params.has('newTerm')) setNewTerm(params.get('newTerm') || '30');
    if (params.has('closing')) setClosingCosts(get('closing', 3000));
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      balance: setBalance, currentRate: setCurrentRate, newRate: setNewRate, closing: setClosingCosts,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'remainTerm') setRemainingTerm(val);
    else if (id === 'newTerm') setNewTerm(val);
  };

  const getCurrentValues = () => ({ balance, currentRate, newRate, remainTerm: remainingTerm, newTerm, closing: closingCosts });

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Mortgage Refinance Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };
  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    navigator.clipboard.writeText(`${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(getCurrentValues())}`).then(() => doShowFeedback('Result copied'));
  };

  return (
    <>
      <div className="calc-card animate-in delay-3">
        {showVersionBanner && (
          <div style={{ background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px', padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Calculator updated since this link was created.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        <div className="calc-section-label">Current mortgage</div>
        <div className="inputs-grid">
          <CalcInput id="balance" label="Current loan balance" prefix="$" defaultValue={280000} value={balance} onChange={handleInput} />
          <CalcInput id="currentRate" label="Current rate" suffix="%" defaultValue={7.5} value={currentRate} onChange={handleInput} />
          <CalcInput id="newRate" label="New rate" suffix="%" defaultValue={6.0} value={newRate} onChange={handleInput} />
        </div>

        <MoreOptions count={3}>
          <div className="inputs-grid">
            <CalcSelect id="remainTerm" label="Remaining term" options={TERM_OPTIONS} value={remainingTerm} onChange={handleSelect} />
            <CalcSelect id="newTerm" label="New term" options={TERM_OPTIONS} value={newTerm} onChange={handleSelect} />
            <CalcInput id="closing" label="Closing costs" prefix="$" defaultValue={3000} value={closingCosts} onChange={handleInput} helpText="Typical: $2,000-$6,000" />
          </div>
        </MoreOptions>

        <div className="result-card">
          <div className="result-label">{resultLabel}</div>
          <div className="result-primary">{resultPrimary}</div>
          <div className="result-details">
            {resultDetails.map((d, i) => (
              <div key={i} className="result-detail">
                <span className="result-detail-label">{d.label}</span>
                <span className={`result-detail-value ${d.green ? 'green' : ''} ${d.red ? 'red' : ''}`}>{d.value}</span>
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
