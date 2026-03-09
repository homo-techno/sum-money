import { useState, useEffect, useRef, useCallback } from 'react';

// ── UK Student Loan Repayment Calculator ──
// Source: GOV.UK 2025/26 student-loan-deduction-tables

// ── Loan plan configs ──
const LOAN_PLANS: Record<string, {
  label: string; threshold: number; rate: number;
  writeOffYears: number | null; writeOffAge: number | null;
  description: string;
}> = {
  plan1: { label: 'Plan 1', threshold: 26065, rate: 0.09, writeOffYears: 25, writeOffAge: 65, description: 'Started before Sept 2012 (England/Wales) or any time (NI)' },
  plan2: { label: 'Plan 2', threshold: 28470, rate: 0.09, writeOffYears: 30, writeOffAge: null, description: 'Started Sept 2012 onwards (England/Wales)' },
  plan4: { label: 'Plan 4', threshold: 32745, rate: 0.09, writeOffYears: 30, writeOffAge: null, description: 'Scotland' },
  plan5: { label: 'Plan 5', threshold: 25000, rate: 0.09, writeOffYears: 40, writeOffAge: null, description: 'Started Sept 2023 onwards (England)' },
  postgrad: { label: 'Postgraduate', threshold: 21000, rate: 0.06, writeOffYears: 30, writeOffAge: null, description: 'Postgraduate Master\'s or Doctoral loan' },
};

// ── Formatting ──
function fmtGBP(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '£0';
  return '£' + Math.round(n).toLocaleString('en-GB');
}
function formatCurrency(v: number): string { return v.toLocaleString('en-GB'); }
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

function CalcSelect({ id, label, options, value, onChange, helpText }: {
  id: string; label: string; options: { value: string; label: string }[]; value: string; onChange: (id: string, val: string) => void; helpText?: string;
}) {
  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        <select id={id} value={value} onChange={(e) => onChange(id, e.target.value)}>
          {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      </div>
      {helpText && <small style={{ color: 'var(--ink-muted)', fontSize: '0.72rem', marginTop: '4px', display: 'block', lineHeight: 1.3 }}>{helpText}</small>}
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
  const PROD = 'https://sum.money/uk/student-loan-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

export default function StudentLoanCalculator() {
  const completionTracked = useRef(false);

  const [balance, setBalance] = useState(45000);
  const [salary, setSalary] = useState(35000);
  const [plan, setPlan] = useState('plan2');
  const [salaryGrowth, setSalaryGrowth] = useState(3);

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calculate = useCallback(() => {
    const config = LOAN_PLANS[plan];
    if (!config) return;

    let remaining = balance;
    let currentSalary = salary;
    let totalRepaid = 0;
    let years = 0;
    const maxYears = config.writeOffYears || 40;

    // Simulate year by year
    while (remaining > 0 && years < maxYears) {
      const annualRepayment = Math.max(currentSalary - config.threshold, 0) * config.rate;
      const actualRepayment = Math.min(annualRepayment, remaining);
      remaining -= actualRepayment;
      totalRepaid += actualRepayment;
      currentSalary *= (1 + salaryGrowth / 100);
      years++;
    }

    const writtenOff = remaining;
    const monthlyRepayment = Math.max(salary - config.threshold, 0) * config.rate / 12;

    setResultLabel('Monthly repayment');
    setResultPrimary(fmtGBP(monthlyRepayment) + '/mo');
    setResultDetails([
      { label: 'Years to repay', value: remaining > 0 ? 'Written off after ' + maxYears + ' years' : years + ' years' },
      { label: 'Total repaid', value: fmtGBP(totalRepaid) },
      ...(writtenOff > 0 ? [{ label: 'Amount written off', value: fmtGBP(writtenOff), green: true }] : []),
      { label: 'Loan balance', value: fmtGBP(balance) },
      { label: 'Repayment threshold', value: fmtGBP(config.threshold) + '/yr' },
      { label: 'Repayment rate', value: (config.rate * 100) + '% above threshold' },
    ]);

    if (!completionTracked.current) {
      completionTracked.current = true;
      trackEvent('calc_complete', { variant: plan });
    }
  }, [balance, salary, plan, salaryGrowth]);

  useEffect(() => { calculate(); }, [calculate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('balance')) setBalance(get('balance', 45000));
    if (params.has('salary')) setSalary(get('salary', 35000));
    if (params.has('plan')) setPlan(params.get('plan') || 'plan2');
    if (params.has('growth')) setSalaryGrowth(get('growth', 3));
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    if (id === 'sl-balance') setBalance(val);
    else if (id === 'sl-salary') setSalary(val);
    else if (id === 'sl-growth') setSalaryGrowth(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'sl-plan') setPlan(val);
  };

  const getCurrentValues = () => ({ balance, salary, plan, growth: salaryGrowth });

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Student Loan Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Result copied'));
  };

  const planDesc = LOAN_PLANS[plan]?.description || '';

  return (
    <>
      <div className="calc-card animate-in delay-3">
        {showVersionBanner && (
          <div style={{ background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px', padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Calculator updated since this link was created.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        <div className="calc-section-label">Your student loan</div>
        <div className="inputs-grid">
          <CalcInput id="sl-balance" label="Loan balance" prefix="£" defaultValue={45000} value={balance} onChange={handleInput} />
          <CalcInput id="sl-salary" label="Annual salary" prefix="£" defaultValue={35000} value={salary} onChange={handleInput} />
          <CalcSelect id="sl-plan" label="Loan plan" options={Object.entries(LOAN_PLANS).map(([k, v]) => ({ value: k, label: v.label }))} value={plan} onChange={handleSelect}
            helpText={planDesc} />
        </div>
        <MoreOptions count={1}>
          <div className="inputs-grid">
            <CalcInput id="sl-growth" label="Salary growth" suffix="% per year" defaultValue={3} value={salaryGrowth} onChange={handleInput} helpText="Assumed annual salary increase" />
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

      <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '.78rem', color: 'var(--ink-muted)', fontStyle: 'italic' }}>
        Thresholds for tax year 2025/26. Does not include interest accrual on the loan balance.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
