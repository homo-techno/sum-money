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

const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  income: { min: 15000, max: 5000000, msgLow: 'Very low income.', msgHigh: 'Unusually high income.' },
  debts: { min: 0, max: 20000, msgLow: '', msgHigh: 'Very high monthly debts. Are these monthly amounts?' },
};

function SoftWarning({ fieldId, value }: { fieldId: string; value: number }) {
  const rule = SOFT_WARNINGS[fieldId];
  if (!rule) return null;
  let msg = '';
  if (value > 0 && value < rule.min && rule.msgLow) msg = rule.msgLow;
  else if (value > rule.max && rule.msgHigh) msg = rule.msgHigh;
  if (!msg) return null;
  return <div style={{ fontSize: '.78rem', color: '#b8860b', background: '#fef9ec', border: '1px solid #f0e6c8', borderRadius: '4px', padding: '6px 10px', marginTop: '4px', lineHeight: 1.4 }}>{msg}</div>;
}

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
          onChange={(e) => { onChange(id, parseFloat(e.target.value.replace(/[^0-9.\-]/g, '')) || 0); }}
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
  const PROD = 'https://sum.money/us/home-affordability-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

const TERM_OPTIONS = [
  { value: '15', label: '15 years' },
  { value: '20', label: '20 years' },
  { value: '30', label: '30 years' },
];

export default function HomeAffordabilityCalculator() {
  const completionTracked = useRef(false);

  const [income, setIncome] = useState(85000);
  const [debts, setDebts] = useState(500);
  const [downPayment, setDownPayment] = useState(60000);
  const [rate, setRate] = useState(6.5);
  const [term, setTerm] = useState('30');
  const [dtiLimit, setDtiLimit] = useState(36);
  const [propertyTaxRate, setPropertyTaxRate] = useState(1.1);
  const [insurance, setInsurance] = useState(1500);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calculate = useCallback(() => {
    const monthlyIncome = income / 12;
    const maxTotalPayment = monthlyIncome * (dtiLimit / 100) - debts;

    if (maxTotalPayment <= 0) {
      setResultLabel('Cannot afford a home');
      setResultPrimary('$0');
      setResultDetails([{ label: 'Your debts exceed the DTI limit', value: 'Reduce debts or increase income', red: true }]);
      return;
    }

    // Iteratively solve for max home price
    // PITI = P&I + tax + insurance
    // We need to find max loan where P&I + tax + insurance = maxTotalPayment
    const years = parseInt(term);
    const months = years * 12;
    const monthlyRate = rate / 100 / 12;

    // Binary search for max home price
    let lo = 0, hi = 5000000;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      const loan = mid - downPayment;
      if (loan <= 0) { hi = mid; continue; }

      let pi: number;
      if (monthlyRate === 0) { pi = loan / months; }
      else {
        const factor = Math.pow(1 + monthlyRate, months);
        pi = loan * (monthlyRate * factor) / (factor - 1);
      }
      const monthlyTax = mid * (propertyTaxRate / 100) / 12;
      const monthlyIns = insurance / 12;
      const piti = pi + monthlyTax + monthlyIns;

      if (piti < maxTotalPayment) lo = mid;
      else hi = mid;
    }

    const maxPrice = Math.round(lo);
    const maxLoan = Math.max(maxPrice - downPayment, 0);

    // Calculate actual PITI
    let pi: number;
    if (monthlyRate === 0) { pi = maxLoan / months; }
    else {
      const factor = Math.pow(1 + monthlyRate, months);
      pi = maxLoan * (monthlyRate * factor) / (factor - 1);
    }
    const monthlyTax = maxPrice * (propertyTaxRate / 100) / 12;
    const monthlyIns = insurance / 12;
    const piti = pi + monthlyTax + monthlyIns;
    const actualDti = monthlyIncome > 0 ? ((piti + debts) / monthlyIncome) * 100 : 0;

    setResultLabel('Maximum home price');
    setResultPrimary(fmtUSD(maxPrice));
    setResultDetails([
      { label: 'Maximum loan', value: fmtUSD(maxLoan) },
      { label: 'Monthly payment (PITI)', value: fmtUSD2(piti) },
      { label: 'P&I', value: fmtUSD(pi) },
      { label: 'Property tax', value: fmtUSD(monthlyTax) + '/mo' },
      { label: 'Insurance', value: fmtUSD(monthlyIns) + '/mo' },
      { label: 'DTI ratio', value: actualDti.toFixed(1) + '%' },
    ]);
  }, [income, debts, downPayment, rate, term, dtiLimit, propertyTaxRate, insurance]);

  useEffect(() => {
    calculate();
    if (!completionTracked.current) { completionTracked.current = true; trackEvent('calc_complete', { variant: 'home-affordability' }); }
  }, [calculate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('income')) return;
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('income')) setIncome(get('income', 85000));
    if (params.has('debts')) setDebts(get('debts', 500));
    if (params.has('down')) setDownPayment(get('down', 60000));
    if (params.has('rate')) setRate(get('rate', 6.5));
    if (params.has('term')) setTerm(params.get('term') || '30');
    if (params.has('dti')) setDtiLimit(get('dti', 36));
    if (params.has('taxRate')) setPropertyTaxRate(get('taxRate', 1.1));
    if (params.has('insurance')) setInsurance(get('insurance', 1500));
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      income: setIncome, debts: setDebts, down: setDownPayment, rate: setRate,
      dti: setDtiLimit, taxRate: setPropertyTaxRate, insurance: setInsurance,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => { if (id === 'term') setTerm(val); };
  const getCurrentValues = () => ({ income, debts, down: downPayment, rate, term, dti: dtiLimit, taxRate: propertyTaxRate, insurance });

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Home Affordability Calculator — sum.money', url });
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

        <div className="calc-section-label">Your finances</div>
        <div className="inputs-grid">
          <CalcInput id="income" label="Annual income" prefix="$" defaultValue={85000} value={income} onChange={handleInput} />
          <CalcInput id="debts" label="Monthly debts" prefix="$" defaultValue={500} value={debts} onChange={handleInput} helpText="Car payments, student loans, credit cards, etc." />
        </div>

        <MoreOptions count={6}>
          <div className="inputs-grid">
            <CalcInput id="down" label="Down payment" prefix="$" defaultValue={60000} value={downPayment} onChange={handleInput} />
            <CalcInput id="rate" label="Interest rate" suffix="%" defaultValue={6.5} value={rate} onChange={handleInput} />
            <CalcSelect id="term" label="Loan term" options={TERM_OPTIONS} value={term} onChange={handleSelect} />
            <CalcInput id="dti" label="DTI limit" suffix="%" defaultValue={36} value={dtiLimit} onChange={handleInput} helpText="Max debt-to-income ratio (36% is standard)" />
            <CalcInput id="taxRate" label="Property tax rate" suffix="%" defaultValue={1.1} value={propertyTaxRate} onChange={handleInput} helpText="Annual rate, varies by county" />
            <CalcInput id="insurance" label="Homeowner's insurance" prefix="$" defaultValue={1500} value={insurance} onChange={handleInput} helpText="Annual premium" />
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
