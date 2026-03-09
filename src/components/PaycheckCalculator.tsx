import { useState, useEffect, useRef, useCallback } from 'react';

type TabId = 'salary' | 'hourly';
interface TabConfig { id: TabId; label: string; icon: string; }
const TABS: TabConfig[] = [
  { id: 'salary', label: 'Salary', icon: '💼' },
  { id: 'hourly', label: 'Hourly', icon: '⏱️' },
];

// ── 2025 Federal Tax Brackets ──
type FilingStatus = 'single' | 'mfj' | 'hoh';
const BRACKETS_2025: Record<FilingStatus, Array<[number, number]>> = {
  single: [[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[626350,.35],[Infinity,.37]],
  mfj: [[23850,.10],[96950,.12],[206700,.22],[394600,.24],[501050,.32],[751600,.35],[Infinity,.37]],
  hoh: [[17000,.10],[64850,.12],[103350,.22],[197300,.24],[250500,.32],[626350,.35],[Infinity,.37]],
};
const STD_DED_2025: Record<FilingStatus, number> = { single: 15750, mfj: 31500, hoh: 23625 };
const SS_WAGE_BASE = 176100;
const SS_RATE = 0.062;
const MED_RATE = 0.0145;
const ADD_MED_RATE = 0.009;
const ADD_MED_THRESH: Record<FilingStatus, number> = { single: 200000, mfj: 250000, hoh: 200000 };

function calcBracketTax(taxableIncome: number, status: FilingStatus): number {
  const brackets = BRACKETS_2025[status];
  let tax = 0, prev = 0;
  for (const [cap, rate] of brackets) {
    if (taxableIncome <= prev) break;
    tax += (Math.min(taxableIncome, cap) - prev) * rate;
    prev = cap;
  }
  return tax;
}

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

const FILING_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'mfj', label: 'Married Filing Jointly' },
  { value: 'hoh', label: 'Head of Household' },
];

const FREQ_OPTIONS = [
  { value: 'weekly', label: 'Weekly (52/yr)' },
  { value: 'biweekly', label: 'Biweekly (26/yr)' },
  { value: 'semimonthly', label: 'Semi-monthly (24/yr)' },
  { value: 'monthly', label: 'Monthly (12/yr)' },
];

function getPeriodsPerYear(freq: string): number {
  switch (freq) {
    case 'weekly': return 52;
    case 'biweekly': return 26;
    case 'semimonthly': return 24;
    case 'monthly': return 12;
    default: return 26;
  }
}

function SoftWarning({ fieldId, value }: { fieldId: string; value: number }) {
  const rules: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
    salary: { min: 10000, max: 5000000, msgLow: 'Very low salary.', msgHigh: 'Unusually high salary.' },
    hourlyRate: { min: 5, max: 500, msgLow: 'Below federal minimum wage ($7.25).', msgHigh: 'Unusually high hourly rate.' },
  };
  const rule = rules[fieldId];
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

function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/us/paycheck-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

export default function PaycheckCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('salary');
  const completionTracked = useRef<Record<string, boolean>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['salary']));

  // Salary tab
  const [sSalary, setSSalary] = useState(75000);
  const [sFiling, setSFiling] = useState<FilingStatus>('single');
  const [sFreq, setSFreq] = useState('biweekly');
  const [s401k, setS401k] = useState(0);
  const [sHealth, setSHealth] = useState(0);

  // Hourly tab
  const [hRate, setHRate] = useState(30);
  const [hHours, setHHours] = useState(40);
  const [hFiling, setHFiling] = useState<FilingStatus>('single');
  const [hFreq, setHFreq] = useState('biweekly');
  const [h401k, setH401k] = useState(0);
  const [hHealth, setHHealth] = useState(0);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  function computePaycheck(annualGross: number, filing: FilingStatus, freq: string, annual401k: number, healthPerPaycheck: number) {
    const periods = getPeriodsPerYear(freq);
    const annualHealth = healthPerPaycheck * periods;
    const preTaxDeductions = annual401k + annualHealth;
    const agi = Math.max(annualGross - preTaxDeductions, 0);
    const taxableIncome = Math.max(agi - STD_DED_2025[filing], 0);
    const federalTax = calcBracketTax(taxableIncome, filing);

    // FICA on gross (before 401k/health)
    const ssTax = Math.min(annualGross, SS_WAGE_BASE) * SS_RATE;
    let medTax = annualGross * MED_RATE;
    if (annualGross > ADD_MED_THRESH[filing]) medTax += (annualGross - ADD_MED_THRESH[filing]) * ADD_MED_RATE;
    const fica = ssTax + medTax;

    const totalTax = federalTax + fica;
    const annualNet = annualGross - totalTax - preTaxDeductions;
    const perPaycheck = annualNet / periods;

    return { annualGross, federalTax, fica, preTaxDeductions, annualNet, perPaycheck, periods };
  }

  const calcSalary = useCallback(() => {
    const r = computePaycheck(sSalary, sFiling, sFreq, s401k, sHealth);
    const freqLabel = sFreq === 'weekly' ? 'weekly' : sFreq === 'biweekly' ? 'biweekly' : sFreq === 'semimonthly' ? 'semi-monthly' : 'monthly';
    setResultLabel(`Your ${freqLabel} paycheck`);
    setResultPrimary(fmtUSD2(r.perPaycheck));
    setResultDetails([
      { label: 'Gross pay (per paycheck)', value: fmtUSD2(r.annualGross / r.periods) },
      { label: 'Federal tax', value: fmtUSD(r.federalTax / r.periods) },
      { label: 'FICA (SS + Medicare)', value: fmtUSD(r.fica / r.periods) },
      { label: 'Deductions', value: fmtUSD(r.preTaxDeductions / r.periods) },
      { label: 'Annual net pay', value: fmtUSD(r.annualNet), green: true },
    ]);
  }, [sSalary, sFiling, sFreq, s401k, sHealth]);

  const calcHourly = useCallback(() => {
    const annualGross = hRate * hHours * 52;
    const r = computePaycheck(annualGross, hFiling, hFreq, h401k, hHealth);
    const freqLabel = hFreq === 'weekly' ? 'weekly' : hFreq === 'biweekly' ? 'biweekly' : hFreq === 'semimonthly' ? 'semi-monthly' : 'monthly';
    setResultLabel(`Your ${freqLabel} paycheck`);
    setResultPrimary(fmtUSD2(r.perPaycheck));
    setResultDetails([
      { label: 'Gross pay (per paycheck)', value: fmtUSD2(r.annualGross / r.periods) },
      { label: 'Federal tax', value: fmtUSD(r.federalTax / r.periods) },
      { label: 'FICA (SS + Medicare)', value: fmtUSD(r.fica / r.periods) },
      { label: 'Deductions', value: fmtUSD(r.preTaxDeductions / r.periods) },
      { label: 'Annual salary equivalent', value: fmtUSD(annualGross) },
      { label: 'Annual net pay', value: fmtUSD(r.annualNet), green: true },
    ]);
  }, [hRate, hHours, hFiling, hFreq, h401k, hHealth]);

  useEffect(() => {
    if (activeTab === 'salary') calcSalary(); else calcHourly();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcSalary, calcHourly]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['salary', 'hourly'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'salary') {
      if (params.has('salary')) setSSalary(get('salary', 75000));
      if (params.has('filing')) setSFiling(params.get('filing') as FilingStatus || 'single');
      if (params.has('freq')) setSFreq(params.get('freq') || 'biweekly');
      if (params.has('401k')) setS401k(get('401k', 0));
      if (params.has('health')) setSHealth(get('health', 0));
    } else {
      if (params.has('rate')) setHRate(get('rate', 30));
      if (params.has('hours')) setHHours(get('hours', 40));
      if (params.has('filing')) setHFiling(params.get('filing') as FilingStatus || 'single');
      if (params.has('freq')) setHFreq(params.get('freq') || 'biweekly');
      if (params.has('401k')) setH401k(get('401k', 0));
      if (params.has('health')) setHHealth(get('health', 0));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      's-salary': setSSalary, 's-401k': setS401k, 's-health': setSHealth,
      'h-rate': setHRate, 'h-hours': setHHours, 'h-401k': setH401k, 'h-health': setHHealth,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 's-filing') setSFiling(val as FilingStatus);
    else if (id === 's-freq') setSFreq(val);
    else if (id === 'h-filing') setHFiling(val as FilingStatus);
    else if (id === 'h-freq') setHFreq(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    if (activeTab === 'salary') return { salary: sSalary, filing: sFiling, freq: sFreq, '401k': s401k, health: sHealth };
    return { rate: hRate, hours: hHours, filing: hFiling, freq: hFreq, '401k': h401k, health: hHealth };
  };

  const switchTab = (tabId: TabId) => {
    const prev = activeTab;
    if (!visitedTabs.current.has(tabId)) {
      visitedTabs.current.add(tabId);
      if (tabId === 'hourly') { setHFiling(sFiling); setHFreq(sFreq); }
      if (tabId === 'salary') { setSFiling(hFiling); setSFreq(hFreq); }
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prev, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Paycheck Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };
  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    navigator.clipboard.writeText(`${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`).then(() => doShowFeedback('Result copied'));
  };

  return (
    <>
      <div className="tabs animate-in delay-3" role="tablist">
        {TABS.map((tab) => (
          <button key={tab.id} className={`tab ${activeTab === tab.id ? 'active' : ''}`} role="tab"
            aria-selected={activeTab === tab.id} onClick={() => switchTab(tab.id)}>
            <span className="tab-icon">{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <div className="calc-card animate-in delay-4">
        {showVersionBanner && (
          <div style={{ background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px', padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Calculator updated since this link was created.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'salary' && (
          <div>
            <div className="calc-section-label">Your salary</div>
            <div className="inputs-grid">
              <CalcInput id="s-salary" label="Annual salary" prefix="$" defaultValue={75000} value={sSalary} onChange={handleInput} />
              <CalcSelect id="s-freq" label="Pay frequency" options={FREQ_OPTIONS} value={sFreq} onChange={handleSelect} />
              <CalcSelect id="s-filing" label="Filing status" options={FILING_OPTIONS} value={sFiling} onChange={handleSelect} />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="s-401k" label="401(k) contribution (annual)" prefix="$" defaultValue={0} value={s401k} onChange={handleInput} helpText="Pre-tax, reduces taxable income" />
                <CalcInput id="s-health" label="Health insurance (per paycheck)" prefix="$" defaultValue={0} value={sHealth} onChange={handleInput} helpText="Pre-tax health premium" />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'hourly' && (
          <div>
            <div className="calc-section-label">Your hourly pay</div>
            <div className="inputs-grid">
              <CalcInput id="h-rate" label="Hourly rate" prefix="$" defaultValue={30} value={hRate} onChange={handleInput} />
              <CalcInput id="h-hours" label="Hours per week" defaultValue={40} value={hHours} onChange={handleInput} />
              <CalcSelect id="h-freq" label="Pay frequency" options={FREQ_OPTIONS} value={hFreq} onChange={handleSelect} />
              <CalcSelect id="h-filing" label="Filing status" options={FILING_OPTIONS} value={hFiling} onChange={handleSelect} />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="h-401k" label="401(k) contribution (annual)" prefix="$" defaultValue={0} value={h401k} onChange={handleInput} helpText="Pre-tax, reduces taxable income" />
                <CalcInput id="h-health" label="Health insurance (per paycheck)" prefix="$" defaultValue={0} value={hHealth} onChange={handleInput} helpText="Pre-tax health premium" />
              </div>
            </MoreOptions>
          </div>
        )}

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
        Federal tax only — does not include state or local taxes. Updated for tax year 2025.
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
