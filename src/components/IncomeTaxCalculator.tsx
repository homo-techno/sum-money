import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'employee' | 'self-employed';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'employee', label: 'Employee', icon: '💼' },
  { id: 'self-employed', label: 'Self-Employed', icon: '🧑‍💻' },
];

// ── 2025 Federal Tax Brackets (IRS Rev. Proc. 2024-40) ──
type FilingStatus = 'single' | 'mfj' | 'hoh';

const BRACKETS_2025: Record<FilingStatus, Array<[number, number]>> = {
  single: [
    [11925, 0.10],
    [48475, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250525, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ],
  mfj: [
    [23850, 0.10],
    [96950, 0.12],
    [206700, 0.22],
    [394600, 0.24],
    [501050, 0.32],
    [751600, 0.35],
    [Infinity, 0.37],
  ],
  hoh: [
    [17000, 0.10],
    [64850, 0.12],
    [103350, 0.22],
    [197300, 0.24],
    [250500, 0.32],
    [626350, 0.35],
    [Infinity, 0.37],
  ],
};

// ── 2025 Standard Deductions (IRS Publication 17, 2025) ──
const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 15750,
  mfj: 31500,
  hoh: 23625,
};

// ── 2025 FICA / SE Constants ──
const SS_WAGE_BASE_2025 = 176100;
const SS_RATE_EMPLOYEE = 0.062;
const MEDICARE_RATE_EMPLOYEE = 0.0145;
const SS_RATE_SE = 0.124;
const MEDICARE_RATE_SE = 0.029;
const SE_NET_FACTOR = 0.9235; // IRS: multiply net profit by 92.35%
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLD: Record<FilingStatus, number> = {
  single: 200000,
  mfj: 250000,
  hoh: 200000,
};

const FILING_OPTIONS: Array<{ value: FilingStatus; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'mfj', label: 'Married Filing Jointly' },
  { value: 'hoh', label: 'Head of Household' },
];

// ── Tax engine ──
function calculateBracketTax(taxableIncome: number, status: FilingStatus): { tax: number; marginalRate: number } {
  const brackets = BRACKETS_2025[status];
  let tax = 0;
  let prev = 0;
  let marginalRate = 0.10;

  for (const [cap, rate] of brackets) {
    if (taxableIncome <= prev) break;
    const chunk = Math.min(taxableIncome, cap) - prev;
    tax += chunk * rate;
    marginalRate = rate;
    prev = cap;
  }

  return { tax, marginalRate };
}

// ── Formatting ──
function fmtUSD(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatCurrency(v: number): string {
  return v.toLocaleString('en-US');
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Soft warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  income: { min: 1000, max: 10000000, msgLow: 'Very low income. Did you mean annual income?', msgHigh: 'Unusually high income. Double-check.' },
  revenue: { min: 1000, max: 10000000, msgLow: 'Very low revenue.', msgHigh: 'Unusually high revenue.' },
  expenses: { min: 0, max: 10000000, msgLow: '', msgHigh: 'Expenses exceed typical amounts.' },
  '401k': { min: 0, max: 23500, msgLow: '', msgHigh: '2025 401(k) limit is $23,500. Excess may not be deductible.' },
  deductions: { min: 0, max: 500000, msgLow: '', msgHigh: 'Unusually high deductions.' },
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
    }}>
      {msg}
    </div>
  );
}

// ── Input component ──
function CalcInput({
  id, label, prefix, suffix, defaultValue, helpText,
  value, onChange,
}: {
  id: string;
  label: string;
  prefix?: string;
  suffix?: string;
  defaultValue: number;
  helpText?: string;
  value: number;
  onChange: (id: string, val: number) => void;
}) {
  const [displayValue, setDisplayValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) {
      if (prefix) {
        setDisplayValue(formatCurrency(value));
      } else {
        setDisplayValue(formatRate(value));
      }
    }
  }, [value, focused, prefix]);

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        {prefix && <span className="input-prefix">{prefix}</span>}
        <input
          ref={inputRef}
          type="text"
          id={id}
          className={prefix ? 'has-prefix' : suffix ? 'has-suffix' : ''}
          inputMode="decimal"
          value={focused ? String(value || '') : displayValue}
          onFocus={() => {
            setFocused(true);
            setTimeout(() => inputRef.current?.select(), 0);
          }}
          onBlur={() => {
            setFocused(false);
            setBlurred(true);
          }}
          onChange={(e) => {
            const clean = e.target.value.replace(/[^0-9.\-]/g, '');
            onChange(id, parseFloat(clean) || 0);
          }}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </div>
      {helpText && (
        <small style={{ color: 'var(--ink-muted)', fontSize: '0.72rem', marginTop: '4px', display: 'block', lineHeight: 1.3 }}>
          {helpText}
        </small>
      )}
      {blurred && <SoftWarning fieldId={id} value={value} />}
    </div>
  );
}

// ── Select component ──
function CalcSelect({
  id, label, options, value, onChange,
}: {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (id: string, val: string) => void;
}) {
  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        <select id={id} value={value} onChange={(e) => onChange(id, e.target.value)}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── More Options toggle ──
function MoreOptions({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={`more-options-toggle ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="arrow">▼</span> More options ({count})
      </button>
      <div className={`more-options ${open ? 'show' : ''}`}>
        {children}
      </div>
    </>
  );
}

// ── Event tracking ──
function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', JSON.stringify(payload));
    }
  } catch { /* silent fail */ }
}

// ── Share URL ──
function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/us/income-tax-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname
    : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) {
    params.set(key, String(val));
  }
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Main Calculator Component ──
export default function IncomeTaxCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('employee');
  const completionTracked = useRef<Record<string, boolean>>({});

  // ── State: Employee ──
  const [empIncome, setEmpIncome] = useState(95000);
  const [empFiling, setEmpFiling] = useState<FilingStatus>('single');
  const [empDeduction, setEmpDeduction] = useState(STANDARD_DEDUCTION_2025.single);
  const [emp401k, setEmp401k] = useState(0);
  const [empOtherDed, setEmpOtherDed] = useState(0);

  // ── State: Self-Employed ──
  const [seRevenue, setSeRevenue] = useState(120000);
  const [seFiling, setSeFiling] = useState<FilingStatus>('single');
  const [seExpenses, setSeExpenses] = useState(20000);
  const [seDeduction, setSeDeduction] = useState(STANDARD_DEDUCTION_2025.single);
  const [seOtherDed, setSeOtherDed] = useState(0);

  // ── State: result ──
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  // ── State: version banner ──
  const [showVersionBanner, setShowVersionBanner] = useState(false);

  // ── State: copy feedback ──
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  // ── Tab state storage ──
  const savedTabValues = useRef<Record<string, Record<string, number | string>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['employee']));

  // ── Auto-fill standard deduction when filing status changes ──
  useEffect(() => {
    setEmpDeduction(STANDARD_DEDUCTION_2025[empFiling]);
  }, [empFiling]);

  useEffect(() => {
    setSeDeduction(STANDARD_DEDUCTION_2025[seFiling]);
  }, [seFiling]);

  // ── Calculation: Employee ──
  const calcEmployee = useCallback(() => {
    const gross = empIncome;
    const preTaxDeductions = emp401k;
    const agi = Math.max(gross - preTaxDeductions, 0);
    const taxableIncome = Math.max(agi - empDeduction - empOtherDed, 0);

    const { tax: federalTax, marginalRate } = calculateBracketTax(taxableIncome, empFiling);

    // FICA (employee portion)
    const ssTax = Math.min(gross, SS_WAGE_BASE_2025) * SS_RATE_EMPLOYEE;
    let medicareTax = gross * MEDICARE_RATE_EMPLOYEE;
    // Additional Medicare Tax
    const addMedThreshold = ADDITIONAL_MEDICARE_THRESHOLD[empFiling];
    if (gross > addMedThreshold) {
      medicareTax += (gross - addMedThreshold) * ADDITIONAL_MEDICARE_RATE;
    }
    const ficaTax = ssTax + medicareTax;

    const totalTax = federalTax + ficaTax;
    const takeHome = gross - totalTax;
    const effectiveRate = gross > 0 ? (federalTax / gross) * 100 : 0;

    setResultLabel('Your take-home pay');
    setResultPrimary(fmtUSD(takeHome) + '/yr');
    setResultDetails([
      { label: 'Monthly', value: fmtUSD(takeHome / 12) },
      { label: 'Federal income tax', value: fmtUSD(federalTax) },
      { label: 'FICA (SS + Medicare)', value: fmtUSD(ficaTax) },
      { label: 'Effective tax rate', value: effectiveRate.toFixed(1) + '%' },
      { label: 'Marginal rate', value: (marginalRate * 100) + '%' },
    ]);
  }, [empIncome, empFiling, empDeduction, emp401k, empOtherDed]);

  // ── Calculation: Self-Employed ──
  const calcSelfEmployed = useCallback(() => {
    const netProfit = Math.max(seRevenue - seExpenses, 0);

    // SE tax
    const seBase = netProfit * SE_NET_FACTOR;
    const ssSE = Math.min(seBase, SS_WAGE_BASE_2025) * SS_RATE_SE;
    let medSE = seBase * MEDICARE_RATE_SE;
    // Additional Medicare
    const addMedThreshold = ADDITIONAL_MEDICARE_THRESHOLD[seFiling];
    if (seBase > addMedThreshold) {
      medSE += (seBase - addMedThreshold) * ADDITIONAL_MEDICARE_RATE;
    }
    const seTax = ssSE + medSE;

    // Deductible half of SE tax
    const halfSE = seTax / 2;

    // AGI and taxable income
    const agi = Math.max(netProfit - halfSE, 0);
    const taxableIncome = Math.max(agi - seDeduction - seOtherDed, 0);

    const { tax: incomeTax, marginalRate } = calculateBracketTax(taxableIncome, seFiling);

    const totalTax = seTax + incomeTax;
    const quarterly = totalTax / 4;
    const effectiveRate = netProfit > 0 ? (totalTax / netProfit) * 100 : 0;

    setResultLabel('Estimated tax owed');
    setResultPrimary(fmtUSD(totalTax) + '/yr');
    setResultDetails([
      { label: 'Quarterly payment', value: fmtUSD(quarterly) },
      { label: 'Self-employment tax', value: fmtUSD(seTax) },
      { label: 'Federal income tax', value: fmtUSD(incomeTax) },
      { label: 'Effective rate', value: effectiveRate.toFixed(1) + '%' },
      { label: 'Marginal rate', value: (marginalRate * 100) + '%' },
    ]);
  }, [seRevenue, seFiling, seExpenses, seDeduction, seOtherDed]);

  // ── Recalculate on input change ──
  useEffect(() => {
    switch (activeTab) {
      case 'employee': calcEmployee(); break;
      case 'self-employed': calcSelfEmployed(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcEmployee, calcSelfEmployed]);

  // ── Load from URL on mount ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;

    const tabId = params.get('tab') as TabId;
    if (['employee', 'self-employed'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }

    const get = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null ? parseFloat(v) || fallback : fallback;
    };
    const getStr = (key: string, fallback: string) => params.get(key) || fallback;

    if (tabId === 'employee' || !tabId) {
      if (params.has('income')) setEmpIncome(get('income', 95000));
      if (params.has('filing')) {
        const f = getStr('filing', 'single') as FilingStatus;
        setEmpFiling(f);
        if (!params.has('deduction')) setEmpDeduction(STANDARD_DEDUCTION_2025[f]);
      }
      if (params.has('deduction')) setEmpDeduction(get('deduction', STANDARD_DEDUCTION_2025.single));
      if (params.has('401k')) setEmp401k(get('401k', 0));
      if (params.has('other')) setEmpOtherDed(get('other', 0));
    }
    if (tabId === 'self-employed') {
      if (params.has('revenue')) setSeRevenue(get('revenue', 120000));
      if (params.has('filing')) {
        const f = getStr('filing', 'single') as FilingStatus;
        setSeFiling(f);
        if (!params.has('deduction')) setSeDeduction(STANDARD_DEDUCTION_2025[f]);
      }
      if (params.has('deduction')) setSeDeduction(get('deduction', STANDARD_DEDUCTION_2025.single));
      if (params.has('expenses')) setSeExpenses(get('expenses', 20000));
      if (params.has('other')) setSeOtherDed(get('other', 0));
    }

    const urlVersion = params.get('v');
    const updatedAt = '2026-03-08';
    if (urlVersion && urlVersion < updatedAt) {
      setShowVersionBanner(true);
    }
  }, []);

  // ── Save / restore tab values ──
  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'employee':
        savedTabValues.current['employee'] = {
          income: empIncome, filing: empFiling, deduction: empDeduction,
          '401k': emp401k, other: empOtherDed,
        };
        break;
      case 'self-employed':
        savedTabValues.current['self-employed'] = {
          revenue: seRevenue, filing: seFiling, deduction: seDeduction,
          expenses: seExpenses, other: seOtherDed,
        };
        break;
    }
  }, [activeTab, empIncome, empFiling, empDeduction, emp401k, empOtherDed, seRevenue, seFiling, seDeduction, seExpenses, seOtherDed]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const saved = savedTabValues.current[tabId];
    if (!saved) return;
    switch (tabId) {
      case 'employee':
        setEmpIncome(saved.income as number);
        setEmpFiling(saved.filing as FilingStatus);
        setEmpDeduction(saved.deduction as number);
        setEmp401k(saved['401k'] as number);
        setEmpOtherDed(saved.other as number);
        break;
      case 'self-employed':
        setSeRevenue(saved.revenue as number);
        setSeFiling(saved.filing as FilingStatus);
        setSeDeduction(saved.deduction as number);
        setSeExpenses(saved.expenses as number);
        setSeOtherDed(saved.other as number);
        break;
    }
  }, []);

  // ── Input handlers ──
  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'e-income': setEmpIncome, 'e-deduction': setEmpDeduction,
      'e-401k': setEmp401k, 'e-other': setEmpOtherDed,
      's-revenue': setSeRevenue, 's-deduction': setSeDeduction,
      's-expenses': setSeExpenses, 's-other': setSeOtherDed,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'e-filing') setEmpFiling(val as FilingStatus);
    else if (id === 's-filing') setSeFiling(val as FilingStatus);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'employee':
        return { income: empIncome, filing: empFiling, deduction: empDeduction, '401k': emp401k, other: empOtherDed };
      case 'self-employed':
        return { revenue: seRevenue, filing: seFiling, deduction: seDeduction, expenses: seExpenses, other: seOtherDed };
    }
  };

  // ── Tab switch with field transfer ──
  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    saveCurrentTabValues();

    if (visitedTabs.current.has(tabId)) {
      restoreTabValues(tabId);
    } else {
      visitedTabs.current.add(tabId);
      // Transfer filing status between tabs on first visit
      if (tabId === 'self-employed') {
        setSeFiling(empFiling);
        setSeDeduction(STANDARD_DEDUCTION_2025[empFiling]);
      } else if (tabId === 'employee') {
        setEmpFiling(seFiling);
        setEmpDeduction(STANDARD_DEDUCTION_2025[seFiling]);
      }
    }

    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prevTab, to: tabId, tab: tabId });
  };

  // ── Share / Copy ──
  const doShowFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setShowFeedback(true);
    setTimeout(() => setShowFeedback(false), 2200);
  };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) {
      navigator.share({ title: 'US Income Tax Calculator 2025 — sum.money', url });
    } else {
      navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
    }
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Result copied'));
  };

  return (
    <>
      {/* TABS */}
      <div className="tabs animate-in delay-3" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => switchTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      {/* CALCULATOR CARD */}
      <div className="calc-card animate-in delay-4">

        {/* Version banner */}
        {showVersionBanner && (
          <div style={{
            background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px',
            padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            Calculator updated since this link was created. Your inputs are preserved, but the result reflects current data.
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }}
              onClick={() => setShowVersionBanner(false)}
            >
              ×
            </button>
          </div>
        )}

        {/* EMPLOYEE */}
        {activeTab === 'employee' && (
          <div>
            <div className="calc-section-label">Your income</div>
            <div className="inputs-grid">
              <CalcInput id="e-income" label="Annual income" prefix="$" defaultValue={95000} value={empIncome} onChange={handleInput} />
              <CalcSelect id="e-filing" label="Filing status" options={FILING_OPTIONS} value={empFiling} onChange={handleSelect} />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="e-deduction" label="Standard deduction" prefix="$" defaultValue={STANDARD_DEDUCTION_2025.single} value={empDeduction} onChange={handleInput} helpText="Auto-filled for your filing status. Edit for itemized." />
                <CalcInput id="e-401k" label="401(k) contribution" prefix="$" defaultValue={0} value={emp401k} onChange={handleInput} helpText="Pre-tax contributions reduce taxable income" />
                <CalcInput id="e-other" label="Other pre-tax deductions" prefix="$" defaultValue={0} value={empOtherDed} onChange={handleInput} helpText="HSA, traditional IRA, etc." />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* SELF-EMPLOYED */}
        {activeTab === 'self-employed' && (
          <div>
            <div className="calc-section-label">Your business</div>
            <div className="inputs-grid">
              <CalcInput id="s-revenue" label="Annual revenue" prefix="$" defaultValue={120000} value={seRevenue} onChange={handleInput} />
              <CalcSelect id="s-filing" label="Filing status" options={FILING_OPTIONS} value={seFiling} onChange={handleSelect} />
            </div>
            <div className="inputs-grid" style={{ marginTop: '12px' }}>
              <CalcInput id="s-expenses" label="Business expenses" prefix="$" defaultValue={20000} value={seExpenses} onChange={handleInput} helpText="Deductible expenses reduce net profit" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="s-deduction" label="Standard deduction" prefix="$" defaultValue={STANDARD_DEDUCTION_2025.single} value={seDeduction} onChange={handleInput} helpText="Auto-filled for your filing status. Edit for itemized." />
                <CalcInput id="s-other" label="Other deductions" prefix="$" defaultValue={0} value={seOtherDed} onChange={handleInput} helpText="SEP-IRA, health insurance premiums, etc." />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* RESULT */}
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

      {/* Tax year note */}
      <div style={{
        textAlign: 'center', marginTop: '12px', fontSize: '.78rem',
        color: 'var(--ink-muted)', fontStyle: 'italic',
      }}>
        Updated for tax year 2025. Federal income tax only — does not include state taxes.
      </div>

      {/* Copy feedback toast */}
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
