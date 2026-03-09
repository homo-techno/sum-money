import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'annual' | 'contractor';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'annual', label: 'Annual → Monthly', icon: '💰' },
  { id: 'contractor', label: 'Contractor', icon: '📋' },
];

// ── UK 2025/26 Tax Constants ──
// Source: GOV.UK income-tax-rates, rates-and-thresholds-for-employers-2025-to-2026
const PERSONAL_ALLOWANCE = 12570;
const PA_TAPER_START = 100000;
const BASIC_BAND = 37700; // £12,571–£50,270 = 37,700 of taxable income
const HIGHER_LIMIT = 125140;
const BASIC_RATE = 0.20;
const HIGHER_RATE = 0.40;
const ADDITIONAL_RATE = 0.45;

const NI_PT = 12570;
const NI_UEL = 50270;
const NI_MAIN = 0.08;
const NI_UPPER = 0.02;

const STUDENT_LOAN_PLANS: Record<string, { threshold: number; rate: number; label: string }> = {
  none: { threshold: 0, rate: 0, label: 'None' },
  plan1: { threshold: 26065, rate: 0.09, label: 'Plan 1' },
  plan2: { threshold: 28470, rate: 0.09, label: 'Plan 2' },
  plan4: { threshold: 32745, rate: 0.09, label: 'Plan 4 (Scotland)' },
  plan5: { threshold: 25000, rate: 0.09, label: 'Plan 5' },
  postgrad: { threshold: 21000, rate: 0.06, label: 'Postgraduate' },
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
  const PROD = 'https://sum.money/uk/take-home-pay-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Tax engine ──
function getPA(income: number): number {
  if (income <= PA_TAPER_START) return PERSONAL_ALLOWANCE;
  return Math.max(PERSONAL_ALLOWANCE - Math.floor((income - PA_TAPER_START) / 2), 0);
}

function calcTax(income: number): number {
  const pa = getPA(income);
  const taxable = Math.max(income - pa, 0);
  let tax = 0;
  const basic = Math.min(taxable, BASIC_BAND);
  tax += basic * BASIC_RATE;
  const higher = Math.min(Math.max(taxable - BASIC_BAND, 0), HIGHER_LIMIT - PERSONAL_ALLOWANCE - BASIC_BAND);
  tax += higher * HIGHER_RATE;
  const additional = Math.max(taxable - BASIC_BAND - (HIGHER_LIMIT - PERSONAL_ALLOWANCE - BASIC_BAND), 0);
  tax += additional * ADDITIONAL_RATE;
  return tax;
}

function calcNI(salary: number): number {
  if (salary <= NI_PT) return 0;
  let ni = Math.min(Math.max(salary - NI_PT, 0), NI_UEL - NI_PT) * NI_MAIN;
  ni += Math.max(salary - NI_UEL, 0) * NI_UPPER;
  return ni;
}

function calcStudentLoan(salary: number, plan: string): number {
  const config = STUDENT_LOAN_PLANS[plan];
  if (!config || config.rate === 0) return 0;
  return Math.max(salary - config.threshold, 0) * config.rate;
}

// ── Main Component ──
export default function TakeHomePayCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('annual');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Annual tab
  const [annSalary, setAnnSalary] = useState(45000);
  const [annPension, setAnnPension] = useState(5);
  const [annStudentLoan, setAnnStudentLoan] = useState('none');
  const [annFrequency, setAnnFrequency] = useState('monthly');

  // Contractor tab
  const [conDayRate, setConDayRate] = useState(500);
  const [conDays, setConDays] = useState(220);
  const [conIr35, setConIr35] = useState('inside');
  const [conPension, setConPension] = useState(0);

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const visitedTabs = useRef<Set<TabId>>(new Set(['annual']));
  const savedTabValues = useRef<Record<string, Record<string, number | string>>>({});

  const calcAnnual = useCallback(() => {
    const salary = annSalary;
    const pensionAmt = salary * (annPension / 100);
    const taxableIncome = salary - pensionAmt;
    const incomeTax = calcTax(taxableIncome);
    const ni = calcNI(salary);
    const studentLoan = calcStudentLoan(salary, annStudentLoan);
    const takeHome = salary - incomeTax - ni - studentLoan - pensionAmt;

    const dividers: Record<string, number> = { monthly: 12, weekly: 52 };
    const freq = dividers[annFrequency] || 12;
    const freqLabel = annFrequency === 'weekly' ? 'Weekly' : 'Monthly';

    setResultLabel(freqLabel + ' take-home pay');
    setResultPrimary(fmtGBP(takeHome / freq) + '/' + (annFrequency === 'weekly' ? 'wk' : 'mo'));
    setResultDetails([
      { label: 'Annual take-home', value: fmtGBP(takeHome) },
      { label: 'Income tax', value: fmtGBP(incomeTax) + '/yr' },
      { label: 'National Insurance', value: fmtGBP(ni) + '/yr' },
      ...(studentLoan > 0 ? [{ label: 'Student loan', value: fmtGBP(studentLoan) + '/yr' }] : []),
      ...(pensionAmt > 0 ? [{ label: 'Pension (' + annPension + '%)', value: fmtGBP(pensionAmt) + '/yr' }] : []),
    ]);
  }, [annSalary, annPension, annStudentLoan, annFrequency]);

  const calcContractor = useCallback(() => {
    const annualGross = conDayRate * conDays;

    if (conIr35 === 'inside') {
      // Inside IR35: treated as employed — PAYE via umbrella company
      const pensionAmt = annualGross * (conPension / 100);
      const taxable = annualGross - pensionAmt;
      const incomeTax = calcTax(taxable);
      const ni = calcNI(annualGross);
      const takeHome = annualGross - incomeTax - ni - pensionAmt;

      setResultLabel('Monthly take-home (inside IR35)');
      setResultPrimary(fmtGBP(takeHome / 12) + '/mo');
      setResultDetails([
        { label: 'Equivalent annual salary', value: fmtGBP(annualGross) },
        { label: 'Annual take-home', value: fmtGBP(takeHome) },
        { label: 'Income tax', value: fmtGBP(incomeTax) + '/yr' },
        { label: 'National Insurance', value: fmtGBP(ni) + '/yr' },
        { label: 'Daily rate', value: fmtGBP(conDayRate) + '/day' },
      ]);
    } else {
      // Outside IR35: paid through own Ltd company — simplified
      // Corporation tax 19%/25%, then dividends
      // Simplified: take salary at PA level, rest as dividends
      const optimalSalary = PERSONAL_ALLOWANCE; // £12,570 — no tax, no NI above threshold
      const grossProfit = annualGross;
      const corpTaxRate = grossProfit > 250000 ? 0.25 : grossProfit > 50000 ? 0.265 : 0.19; // marginal relief simplified
      const profitAfterSalary = grossProfit - optimalSalary;
      const corpTax = profitAfterSalary * (grossProfit <= 50000 ? 0.19 : 0.25);
      const dividendPool = profitAfterSalary - corpTax;
      const dividendAllowance = 500; // 2025/26
      const taxableDividends = Math.max(dividendPool - dividendAllowance, 0);

      // Dividend tax: 8.75% basic, 33.75% higher, 39.35% additional
      // Remaining basic band after salary: £50,270 - £12,570 = £37,700
      const basicRemaining = 37700;
      let dividendTax = 0;
      const basicDiv = Math.min(taxableDividends, basicRemaining);
      dividendTax += basicDiv * 0.0875;
      const higherDiv = Math.min(Math.max(taxableDividends - basicRemaining, 0), HIGHER_LIMIT - PERSONAL_ALLOWANCE - BASIC_BAND);
      dividendTax += higherDiv * 0.3375;
      const additionalDiv = Math.max(taxableDividends - basicRemaining - (HIGHER_LIMIT - PERSONAL_ALLOWANCE - BASIC_BAND), 0);
      dividendTax += additionalDiv * 0.3935;

      const totalTakeHome = optimalSalary + dividendPool - dividendTax;
      const pensionAmt = totalTakeHome * (conPension / 100);
      const netTakeHome = totalTakeHome - pensionAmt;

      setResultLabel('Monthly take-home (outside IR35)');
      setResultPrimary(fmtGBP(netTakeHome / 12) + '/mo');
      setResultDetails([
        { label: 'Annual gross', value: fmtGBP(annualGross) },
        { label: 'Salary (tax-efficient)', value: fmtGBP(optimalSalary) + '/yr' },
        { label: 'Corporation tax', value: fmtGBP(corpTax) },
        { label: 'Dividends', value: fmtGBP(dividendPool) },
        { label: 'Dividend tax', value: fmtGBP(dividendTax) },
        { label: 'Annual take-home', value: fmtGBP(netTakeHome), green: true },
      ]);
    }
  }, [conDayRate, conDays, conIr35, conPension]);

  useEffect(() => {
    switch (activeTab) {
      case 'annual': calcAnnual(); break;
      case 'contractor': calcContractor(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcAnnual, calcContractor]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['annual', 'contractor'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'annual') {
      if (params.has('salary')) setAnnSalary(get('salary', 45000));
      if (params.has('pension')) setAnnPension(get('pension', 5));
      if (params.has('studentLoan')) setAnnStudentLoan(params.get('studentLoan') || 'none');
      if (params.has('frequency')) setAnnFrequency(params.get('frequency') || 'monthly');
    }
    if (tabId === 'contractor') {
      if (params.has('dayRate')) setConDayRate(get('dayRate', 500));
      if (params.has('days')) setConDays(get('days', 220));
      if (params.has('ir35')) setConIr35(params.get('ir35') || 'inside');
      if (params.has('pension')) setConPension(get('pension', 0));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'annual': savedTabValues.current['annual'] = { salary: annSalary, pension: annPension, studentLoan: annStudentLoan, frequency: annFrequency }; break;
      case 'contractor': savedTabValues.current['contractor'] = { dayRate: conDayRate, days: conDays, ir35: conIr35, pension: conPension }; break;
    }
  }, [activeTab, annSalary, annPension, annStudentLoan, annFrequency, conDayRate, conDays, conIr35, conPension]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const s = savedTabValues.current[tabId];
    if (!s) return;
    switch (tabId) {
      case 'annual': setAnnSalary(s.salary as number); setAnnPension(s.pension as number); setAnnStudentLoan(s.studentLoan as string); setAnnFrequency(s.frequency as string); break;
      case 'contractor': setConDayRate(s.dayRate as number); setConDays(s.days as number); setConIr35(s.ir35 as string); setConPension(s.pension as number); break;
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'a-salary': setAnnSalary, 'a-pension': setAnnPension,
      'c-dayRate': setConDayRate, 'c-days': setConDays, 'c-pension': setConPension,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'a-studentLoan') setAnnStudentLoan(val);
    else if (id === 'a-frequency') setAnnFrequency(val);
    else if (id === 'c-ir35') setConIr35(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'annual': return { salary: annSalary, pension: annPension, studentLoan: annStudentLoan, frequency: annFrequency };
      case 'contractor': return { dayRate: conDayRate, days: conDays, ir35: conIr35, pension: conPension };
    }
  };

  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    saveCurrentTabValues();
    if (visitedTabs.current.has(tabId)) restoreTabValues(tabId);
    else visitedTabs.current.add(tabId);
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prevTab, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Take-Home Pay Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Result copied'));
  };

  const SL_OPTIONS = Object.entries(STUDENT_LOAN_PLANS).map(([k, v]) => ({ value: k, label: v.label }));

  return (
    <>
      <div className="tabs animate-in delay-3" role="tablist">
        {TABS.map((tab) => (
          <button key={tab.id} className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            role="tab" aria-selected={activeTab === tab.id} onClick={() => switchTab(tab.id)}>
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

        {activeTab === 'annual' && (
          <div>
            <div className="calc-section-label">Your salary</div>
            <div className="inputs-grid">
              <CalcInput id="a-salary" label="Annual salary" prefix="£" defaultValue={45000} value={annSalary} onChange={handleInput} />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="a-pension" label="Pension contribution" suffix="%" defaultValue={5} value={annPension} onChange={handleInput} helpText="Auto-enrolment minimum is 5%" />
                <CalcSelect id="a-studentLoan" label="Student loan plan" options={SL_OPTIONS} value={annStudentLoan} onChange={handleSelect} />
                <CalcSelect id="a-frequency" label="Pay frequency" options={[
                  { value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' },
                ]} value={annFrequency} onChange={handleSelect} />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'contractor' && (
          <div>
            <div className="calc-section-label">Your contract</div>
            <div className="inputs-grid">
              <CalcInput id="c-dayRate" label="Daily rate" prefix="£" defaultValue={500} value={conDayRate} onChange={handleInput} />
              <CalcInput id="c-days" label="Working days per year" suffix="days" defaultValue={220} value={conDays} onChange={handleInput} helpText="Typically 220–230 (52 weeks minus holidays/sick)" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcSelect id="c-ir35" label="IR35 status" options={[
                  { value: 'inside', label: 'Inside IR35' }, { value: 'outside', label: 'Outside IR35' },
                ]} value={conIr35} onChange={handleSelect} />
                <CalcInput id="c-pension" label="Pension contribution" suffix="%" defaultValue={0} value={conPension} onChange={handleInput} />
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
        Tax year 2025/26. England, Wales & Northern Ireland rates.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
