import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'employed' | 'self-employed';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'employed', label: 'Employed', icon: '💼' },
  { id: 'self-employed', label: 'Self-Employed', icon: '🧑‍💻' },
];

// ── UK 2025/26 Tax Year Constants ──
// Source: https://www.gov.uk/income-tax-rates
// Source: https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2025-to-2026
const PERSONAL_ALLOWANCE = 12570;
const PA_TAPER_START = 100000; // PA reduced by £1 per £2 above £100K
const BASIC_RATE_LIMIT = 50270; // £12,571–£50,270
const HIGHER_RATE_LIMIT = 125140; // £50,271–£125,140
const BASIC_RATE = 0.20;
const HIGHER_RATE = 0.40;
const ADDITIONAL_RATE = 0.45;

// Employee NI (Class 1 Primary) 2025/26
const NI_PRIMARY_THRESHOLD = 12570; // annual
const NI_UPPER_EARNINGS_LIMIT = 50270;
const NI_RATE_MAIN = 0.08; // 8% between PT and UEL
const NI_RATE_UPPER = 0.02; // 2% above UEL

// Self-employed NI (Class 4) 2025/26
const NI_CLASS2_WEEKLY = 3.50;
const NI_CLASS4_LOWER = 12570;
const NI_CLASS4_UPPER = 50270;
const NI_CLASS4_MAIN = 0.06; // 6%
const NI_CLASS4_UPPER_RATE = 0.02; // 2%

// Student loan thresholds 2025/26
// Source: https://www.gov.uk/government/publications/sl3-student-loan-deduction-tables
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

// ── Soft warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  salary: { min: 5000, max: 1000000, msgLow: 'Very low salary. Did you mean annual salary?', msgHigh: 'Unusually high salary. Double-check.' },
  profit: { min: 1000, max: 1000000, msgLow: 'Very low profit.', msgHigh: 'Unusually high profit.' },
};

function SoftWarning({ fieldId, value }: { fieldId: string; value: number }) {
  const rule = SOFT_WARNINGS[fieldId];
  if (!rule) return null;
  let msg = '';
  if (value > 0 && value < rule.min && rule.msgLow) msg = rule.msgLow;
  else if (value > rule.max && rule.msgHigh) msg = rule.msgHigh;
  if (!msg) return null;
  return (
    <div style={{ fontSize: '.78rem', color: '#b8860b', background: '#fef9ec', border: '1px solid #f0e6c8', borderRadius: '4px', padding: '6px 10px', marginTop: '4px', lineHeight: 1.4 }}>{msg}</div>
  );
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
  const PROD = 'https://sum.money/uk/income-tax-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Tax engine ──
function getPersonalAllowance(income: number): number {
  if (income <= PA_TAPER_START) return PERSONAL_ALLOWANCE;
  const reduction = Math.floor((income - PA_TAPER_START) / 2);
  return Math.max(PERSONAL_ALLOWANCE - reduction, 0);
}

function calculateIncomeTax(income: number): { tax: number; marginalRate: number } {
  const pa = getPersonalAllowance(income);
  const taxable = Math.max(income - pa, 0);
  let tax = 0;
  let marginalRate = 0;

  // Basic rate: up to (BASIC_RATE_LIMIT - PA)
  const basicBand = Math.max(BASIC_RATE_LIMIT - PERSONAL_ALLOWANCE, 0); // £37,700
  const basicTaxable = Math.min(taxable, basicBand);
  if (basicTaxable > 0) { tax += basicTaxable * BASIC_RATE; marginalRate = 0.20; }

  // Higher rate
  const higherBand = Math.max(HIGHER_RATE_LIMIT - BASIC_RATE_LIMIT, 0);
  const higherTaxable = Math.min(Math.max(taxable - basicBand, 0), higherBand);
  if (higherTaxable > 0) { tax += higherTaxable * HIGHER_RATE; marginalRate = 0.40; }

  // Additional rate
  const additionalTaxable = Math.max(taxable - basicBand - higherBand, 0);
  if (additionalTaxable > 0) { tax += additionalTaxable * ADDITIONAL_RATE; marginalRate = 0.45; }

  // Effective marginal rate in PA taper zone (£100K–£125,140) is actually 60%
  if (income > PA_TAPER_START && income <= HIGHER_RATE_LIMIT) marginalRate = 0.60;

  return { tax, marginalRate };
}

function calculateEmployeeNI(salary: number): number {
  if (salary <= NI_PRIMARY_THRESHOLD) return 0;
  let ni = 0;
  ni += Math.min(Math.max(salary - NI_PRIMARY_THRESHOLD, 0), NI_UPPER_EARNINGS_LIMIT - NI_PRIMARY_THRESHOLD) * NI_RATE_MAIN;
  ni += Math.max(salary - NI_UPPER_EARNINGS_LIMIT, 0) * NI_RATE_UPPER;
  return ni;
}

function calculateStudentLoan(salary: number, plan: string): number {
  const config = STUDENT_LOAN_PLANS[plan];
  if (!config || config.rate === 0) return 0;
  return Math.max(salary - config.threshold, 0) * config.rate;
}

// ── Main Component ──
export default function UkIncomeTaxCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('employed');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Employed
  const [empSalary, setEmpSalary] = useState(45000);
  const [empTaxCode, setEmpTaxCode] = useState('1257L');
  const [empPension, setEmpPension] = useState(5);
  const [empStudentLoan, setEmpStudentLoan] = useState('none');

  // Self-employed
  const [seProfit, setSeProfit] = useState(55000);
  const [sePension, setSePension] = useState(0);
  const [seStudentLoan, setSeStudentLoan] = useState('none');

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const savedTabValues = useRef<Record<string, Record<string, number | string>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['employed']));

  // ── Calculation: Employed ──
  const calcEmployed = useCallback(() => {
    const salary = empSalary;
    const pensionContribution = salary * (empPension / 100);
    const taxableIncome = salary - pensionContribution; // pension is pre-tax

    const { tax: incomeTax, marginalRate } = calculateIncomeTax(taxableIncome);
    const ni = calculateEmployeeNI(salary); // NI on full salary (pension doesn't reduce NI for salary sacrifice — simplified)
    const studentLoan = calculateStudentLoan(salary, empStudentLoan);

    const totalDeductions = incomeTax + ni + studentLoan + pensionContribution;
    const takeHome = salary - totalDeductions;
    const effectiveRate = salary > 0 ? ((incomeTax + ni) / salary) * 100 : 0;

    setResultLabel('Your take-home pay');
    setResultPrimary(fmtGBP(takeHome) + '/yr');
    setResultDetails([
      { label: 'Monthly', value: fmtGBP(takeHome / 12) },
      { label: 'Income tax', value: fmtGBP(incomeTax) },
      { label: 'National Insurance', value: fmtGBP(ni) },
      ...(studentLoan > 0 ? [{ label: 'Student loan', value: fmtGBP(studentLoan) }] : []),
      ...(pensionContribution > 0 ? [{ label: 'Pension (' + empPension + '%)', value: fmtGBP(pensionContribution) }] : []),
      { label: 'Effective rate', value: effectiveRate.toFixed(1) + '%' },
      { label: 'Marginal rate', value: (marginalRate * 100) + '%' },
    ]);
  }, [empSalary, empTaxCode, empPension, empStudentLoan]);

  // ── Calculation: Self-Employed ──
  const calcSelfEmployed = useCallback(() => {
    const profit = seProfit;
    const pensionContribution = profit * (sePension / 100);
    const taxableProfit = profit - pensionContribution;

    const { tax: incomeTax, marginalRate } = calculateIncomeTax(taxableProfit);

    // Class 2 NI: auto-credited from 2024/25 onwards — no cost to pay
    const class2NI = 0;

    // Class 4 NI
    let class4NI = 0;
    class4NI += Math.min(Math.max(profit - NI_CLASS4_LOWER, 0), NI_CLASS4_UPPER - NI_CLASS4_LOWER) * NI_CLASS4_MAIN;
    class4NI += Math.max(profit - NI_CLASS4_UPPER, 0) * NI_CLASS4_UPPER_RATE;

    const totalNI = class2NI + class4NI;
    const studentLoan = calculateStudentLoan(profit, seStudentLoan);

    const totalTax = incomeTax + totalNI + studentLoan;
    const quarterly = totalTax / 4;
    const effectiveRate = profit > 0 ? ((incomeTax + totalNI) / profit) * 100 : 0;

    setResultLabel('Total tax owed');
    setResultPrimary(fmtGBP(totalTax) + '/yr');
    setResultDetails([
      { label: 'Set aside quarterly', value: fmtGBP(quarterly) },
      { label: 'Income tax', value: fmtGBP(incomeTax) },
      { label: 'Class 4 NI', value: fmtGBP(class4NI) },
      ...(studentLoan > 0 ? [{ label: 'Student loan', value: fmtGBP(studentLoan) }] : []),
      ...(pensionContribution > 0 ? [{ label: 'Pension (' + sePension + '%)', value: fmtGBP(pensionContribution) }] : []),
      { label: 'Effective rate', value: effectiveRate.toFixed(1) + '%' },
      { label: 'Marginal rate', value: (marginalRate * 100) + '%' },
    ]);
  }, [seProfit, sePension, seStudentLoan]);

  useEffect(() => {
    switch (activeTab) {
      case 'employed': calcEmployed(); break;
      case 'self-employed': calcSelfEmployed(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcEmployed, calcSelfEmployed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['employed', 'self-employed'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'employed') {
      if (params.has('salary')) setEmpSalary(get('salary', 45000));
      if (params.has('taxCode')) setEmpTaxCode(params.get('taxCode') || '1257L');
      if (params.has('pension')) setEmpPension(get('pension', 5));
      if (params.has('studentLoan')) setEmpStudentLoan(params.get('studentLoan') || 'none');
    }
    if (tabId === 'self-employed') {
      if (params.has('profit')) setSeProfit(get('profit', 55000));
      if (params.has('pension')) setSePension(get('pension', 0));
      if (params.has('studentLoan')) setSeStudentLoan(params.get('studentLoan') || 'none');
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'employed': savedTabValues.current['employed'] = { salary: empSalary, taxCode: empTaxCode, pension: empPension, studentLoan: empStudentLoan }; break;
      case 'self-employed': savedTabValues.current['self-employed'] = { profit: seProfit, pension: sePension, studentLoan: seStudentLoan }; break;
    }
  }, [activeTab, empSalary, empTaxCode, empPension, empStudentLoan, seProfit, sePension, seStudentLoan]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const s = savedTabValues.current[tabId];
    if (!s) return;
    switch (tabId) {
      case 'employed': setEmpSalary(s.salary as number); setEmpTaxCode(s.taxCode as string); setEmpPension(s.pension as number); setEmpStudentLoan(s.studentLoan as string); break;
      case 'self-employed': setSeProfit(s.profit as number); setSePension(s.pension as number); setSeStudentLoan(s.studentLoan as string); break;
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'e-salary': setEmpSalary, 'e-pension': setEmpPension,
      's-profit': setSeProfit, 's-pension': setSePension,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'e-studentLoan') setEmpStudentLoan(val);
    else if (id === 's-studentLoan') setSeStudentLoan(val);
  };

  const handleTaxCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmpTaxCode(e.target.value.toUpperCase());
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'employed': return { salary: empSalary, taxCode: empTaxCode, pension: empPension, studentLoan: empStudentLoan };
      case 'self-employed': return { profit: seProfit, pension: sePension, studentLoan: seStudentLoan };
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
    if (navigator.share) navigator.share({ title: 'UK Income Tax Calculator 2025/26 — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Result copied'));
  };

  const STUDENT_LOAN_OPTIONS = Object.entries(STUDENT_LOAN_PLANS).map(([key, val]) => ({ value: key, label: val.label }));

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
            Calculator updated since this link was created. Your inputs are preserved, but the result reflects current data.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'employed' && (
          <div>
            <div className="calc-section-label">Your salary</div>
            <div className="inputs-grid">
              <CalcInput id="e-salary" label="Annual salary" prefix="£" defaultValue={45000} value={empSalary} onChange={handleInput} />
              <div className="input-group">
                <label htmlFor="e-taxCode">Tax code</label>
                <div className="input-wrapper">
                  <input type="text" id="e-taxCode" value={empTaxCode} onChange={handleTaxCodeChange}
                    style={{ textTransform: 'uppercase' }} />
                </div>
                <small style={{ color: 'var(--ink-muted)', fontSize: '0.72rem', marginTop: '4px', display: 'block', lineHeight: 1.3 }}>
                  Find on your payslip. 1257L is the standard 2025/26 code.
                </small>
              </div>
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="e-pension" label="Pension contribution" suffix="%" defaultValue={5} value={empPension} onChange={handleInput} helpText="Auto-enrolment minimum is 5%" />
                <CalcSelect id="e-studentLoan" label="Student loan plan" options={STUDENT_LOAN_OPTIONS} value={empStudentLoan} onChange={handleSelect} />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'self-employed' && (
          <div>
            <div className="calc-section-label">Your business</div>
            <div className="inputs-grid">
              <CalcInput id="s-profit" label="Annual profit" prefix="£" defaultValue={55000} value={seProfit} onChange={handleInput} helpText="Revenue minus business expenses" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="s-pension" label="Pension contribution" suffix="%" defaultValue={0} value={sePension} onChange={handleInput} />
                <CalcSelect id="s-studentLoan" label="Student loan plan" options={STUDENT_LOAN_OPTIONS} value={seStudentLoan} onChange={handleSelect} />
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
        Tax year 2025/26 (6 April 2025 – 5 April 2026). England, Wales & Northern Ireland rates.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
