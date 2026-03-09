import { useState, useEffect, useRef, useCallback } from 'react';

type FilingStatus = 'single' | 'mfj' | 'hoh';

const BRACKETS_2025: Record<FilingStatus, Array<[number, number]>> = {
  single: [[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[626350,.35],[Infinity,.37]],
  mfj: [[23850,.10],[96950,.12],[206700,.22],[394600,.24],[501050,.32],[751600,.35],[Infinity,.37]],
  hoh: [[17000,.10],[64850,.12],[103350,.22],[197300,.24],[250500,.32],[626350,.35],[Infinity,.37]],
};

function fmtUSD(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
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

const FILING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'mfj', label: 'Married Filing Jointly' },
  { value: 'hoh', label: 'Head of Household' },
];

function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

function buildShareURL(values: Record<string, number | string>) {
  const PROD = 'https://sum.money/us/tax-bracket-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

interface BracketBreakdown { range: string; rate: string; taxed: number; tax: number; }

export default function TaxBracketCalculator() {
  const completionTracked = useRef(false);

  const [income, setIncome] = useState(85000);
  const [filing, setFiling] = useState<FilingStatus>('single');

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [breakdown, setBreakdown] = useState<BracketBreakdown[]>([]);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calculate = useCallback(() => {
    const brackets = BRACKETS_2025[filing];
    let totalTax = 0;
    let prev = 0;
    let marginalRate = 0.10;
    const bd: BracketBreakdown[] = [];

    for (const [cap, rate] of brackets) {
      if (income <= prev) break;
      const taxed = Math.min(income, cap) - prev;
      const tax = taxed * rate;
      totalTax += tax;
      marginalRate = rate;
      const lo = prev === 0 ? '$0' : fmtUSD(prev + 1);
      const hi = cap === Infinity ? '+' : fmtUSD(cap);
      bd.push({ range: `${lo} – ${hi}`, rate: (rate * 100) + '%', taxed, tax });
      prev = cap;
    }

    const effectiveRate = income > 0 ? (totalTax / income) * 100 : 0;

    setResultLabel('Your marginal tax bracket');
    setResultPrimary((marginalRate * 100) + '%');
    setResultDetails([
      { label: 'Total federal tax', value: fmtUSD(totalTax) },
      { label: 'Effective rate', value: effectiveRate.toFixed(1) + '%' },
      { label: 'After-tax income', value: fmtUSD(income - totalTax), green: true },
    ]);
    setBreakdown(bd);
  }, [income, filing]);

  useEffect(() => {
    calculate();
    if (!completionTracked.current) { completionTracked.current = true; trackEvent('calc_complete', { variant: 'tax-bracket' }); }
  }, [calculate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('income')) return;
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('income')) setIncome(get('income', 85000));
    if (params.has('filing')) setFiling(params.get('filing') as FilingStatus || 'single');
  }, []);

  const handleInput = (id: string, val: number) => { if (id === 'income') setIncome(val); };
  const handleSelect = (id: string, val: string) => { if (id === 'filing') setFiling(val as FilingStatus); };
  const getCurrentValues = () => ({ income, filing });

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Tax Bracket Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };
  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const bracketText = breakdown.map(b => `${b.rate} on ${fmtUSD(b.taxed)} = ${fmtUSD(b.tax)}`).join('\n');
    navigator.clipboard.writeText(`${resultLabel}\n${resultPrimary}\n${details}\n\nBracket breakdown:\n${bracketText}\n\n${buildShareURL(getCurrentValues())}`).then(() => doShowFeedback('Result copied'));
  };

  return (
    <>
      <div className="calc-card animate-in delay-3">
        <div className="calc-section-label">Your income</div>
        <div className="inputs-grid">
          <CalcInput id="income" label="Taxable income" prefix="$" defaultValue={85000} value={income} onChange={handleInput} helpText="After deductions (AGI minus standard/itemized deduction)" />
          <CalcSelect id="filing" label="Filing status" options={FILING_OPTIONS} value={filing} onChange={handleSelect} />
        </div>

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

          {/* Bracket breakdown visual */}
          {breakdown.length > 0 && (
            <div style={{ marginTop: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
              <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--ink-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                Bracket Breakdown
              </div>
              {breakdown.map((b, i) => {
                const maxTax = breakdown.reduce((m, x) => Math.max(m, x.tax), 1);
                const pct = (b.tax / maxTax) * 100;
                return (
                  <div key={i} style={{ marginBottom: '6px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', color: 'var(--ink-muted)', marginBottom: '2px' }}>
                      <span>{b.rate} on {fmtUSD(b.taxed)}</span>
                      <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{fmtUSD(b.tax)}</span>
                    </div>
                    <div style={{ background: 'var(--bg-offset)', borderRadius: '3px', height: '6px', overflow: 'hidden' }}>
                      <div style={{ background: 'var(--accent)', height: '100%', width: `${pct}%`, borderRadius: '3px', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="result-actions" style={{ marginTop: '16px' }}>
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
      <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '.78rem', color: 'var(--ink-muted)', fontStyle: 'italic' }}>
        2025 federal income tax brackets. Does not include FICA or state taxes.
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
