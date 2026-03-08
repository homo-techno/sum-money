import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'first-home' | 'refinance' | 'early-payoff';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'first-home', label: 'First Home', icon: '🏠' },
  { id: 'refinance', label: 'Refinance', icon: '♻️' },
  { id: 'early-payoff', label: 'Early Payoff', icon: '⚡' },
];

// ── Soft warning rules ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  'fh-income': { min: 10000, max: 2000000, msgLow: 'This income is below US minimum wage. Double-check the value.', msgHigh: 'Unusually high income. Double-check the value.' },
  'fh-expenses': { min: 0, max: 5000, msgLow: '', msgHigh: 'This seems high for debt payments alone. Include only loans and credit cards — not rent, food, or utilities.' },
  'fh-rate': { min: 0.5, max: 20, msgLow: 'Unusually low rate for the US market.', msgHigh: 'Rates above 20% are unusual for US mortgages.' },
  'fh-down': { min: 0, max: 50, msgLow: '', msgHigh: "That's a very large down payment. Most buyers put 3-20% down." },
  'ref-current-rate': { min: 0.5, max: 20, msgLow: 'Unusually low rate.', msgHigh: 'Rates above 20% are unusual for US mortgages.' },
  'ref-new-rate': { min: 0.5, max: 20, msgLow: 'Unusually low rate.', msgHigh: 'Rates above 20% are unusual for US mortgages.' },
  'ep-rate': { min: 0.5, max: 20, msgLow: 'Unusually low rate.', msgHigh: 'Rates above 20% are unusual for US mortgages.' },
};

// ── Utility functions ──
function fmtUSD(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}

function monthlyPayment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate === 0) return principal / (years * 12);
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function totalInterest(principal: number, monthly: number, years: number): number {
  return (monthly * years * 12) - principal;
}

// ── Format helpers ──
function formatCurrency(v: number): string {
  return v.toLocaleString('en-US');
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(1);
}

// ── Soft Warning component ──
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
  id, label, prefix, suffix, defaultValue, helpText, pattern,
  value, onChange,
}: {
  id: string;
  label: string;
  prefix?: string;
  suffix?: string;
  defaultValue: number;
  helpText?: string;
  pattern?: string;
  value: number;
  onChange: (id: string, val: number) => void;

}) {
  const [displayValue, setDisplayValue] = useState(
    prefix ? formatCurrency(defaultValue) : formatRate(defaultValue)
  );
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) {
      setDisplayValue(prefix ? formatCurrency(value) : formatRate(value));
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
          pattern={pattern || '[0-9]*'}
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
  options: { value: string; label: string }[];
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
  const PROD = 'https://sum.money/us/mortgage';
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
export default function MortgageCalculator() {
  // ── State: active tab ──
  const [activeTab, setActiveTab] = useState<TabId>('first-home');
  const completionTracked = useRef<Record<string, boolean>>({});

  // ── State: First Home ──
  const [fhIncome, setFhIncome] = useState(85000);
  const [fhExpenses, setFhExpenses] = useState(600);
  const [fhRate, setFhRate] = useState(6.5);
  const [fhTerm, setFhTerm] = useState('30');
  const [fhDown, setFhDown] = useState(10);

  // ── State: Refinance ──
  const [refBalance, setRefBalance] = useState(280000);
  const [refCurrentRate, setRefCurrentRate] = useState(7.5);
  const [refNewRate, setRefNewRate] = useState(6.0);
  const [refRemaining, setRefRemaining] = useState('25');

  // ── State: Early Payoff ──
  const [epBalance, setEpBalance] = useState(300000);
  const [epExtra, setEpExtra] = useState(200);
  const [epRate, setEpRate] = useState(6.5);
  const [epTerm, setEpTerm] = useState('30');

  // ── State: result ──
  const [resultLabel, setResultLabel] = useState('You can afford up to');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean }>>([]);

  // ── State: version banner ──
  const [showVersionBanner, setShowVersionBanner] = useState(false);

  // ── State: copy feedback ──
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  // ── Calculation functions ──
  const calcFirstHome = useCallback(() => {
    const income = fhIncome;
    const expenses = fhExpenses;
    const rate = fhRate;
    const term = parseInt(fhTerm);
    const downPct = fhDown;

    const maxMonthly = (income / 12) * 0.28 - expenses;

    if (maxMonthly <= 0) {
      setResultLabel('You can afford up to');
      setResultPrimary('$0');
      setResultDetails([{ label: 'Note', value: 'Your debt payments exceed 28% of your gross income. Consider reducing monthly debts or increasing income.' }]);
      return;
    }

    const r = rate / 100 / 12;
    const n = term * 12;

    let price: number;
    if (r === 0) {
      price = (maxMonthly * n) / (1 - downPct / 100);
    } else {
      price = (maxMonthly * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n))) / (1 - downPct / 100);
    }

    for (let i = 0; i < 10; i++) {
      const taxIns = price * (0.011 + 0.0035) / 12;
      const availableForMortgage = maxMonthly - taxIns;
      if (availableForMortgage <= 0) { price = 0; break; }
      let loan: number;
      if (r === 0) {
        loan = availableForMortgage * n;
      } else {
        loan = availableForMortgage * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
      }
      price = loan / (1 - downPct / 100);
    }
    if (price < 0) price = 0;

    const downPayment = price * (downPct / 100);
    const loanAmount = price - downPayment;
    const mp = monthlyPayment(loanAmount, rate, term);
    const ti = totalInterest(loanAmount, mp, term);

    setResultLabel('You can afford up to');
    setResultPrimary(fmtUSD(price));
    setResultDetails([
      { label: 'Monthly payment', value: fmtUSD(mp) },
      { label: 'Down payment', value: fmtUSD(downPayment) },
      { label: 'Total interest', value: fmtUSD(ti) },
    ]);
  }, [fhIncome, fhExpenses, fhRate, fhTerm, fhDown]);

  const calcRefinance = useCallback(() => {
    const balance = refBalance;
    const currentRate = refCurrentRate;
    const newRate = refNewRate;
    const remaining = parseInt(refRemaining);

    const currentMP = monthlyPayment(balance, currentRate, remaining);
    const newMP = monthlyPayment(balance, newRate, remaining);
    const monthlySavings = currentMP - newMP;
    const totalSavings = monthlySavings * remaining * 12;

    setResultLabel('Refinancing saves you');
    setResultPrimary(fmtUSD(Math.max(0, totalSavings)));
    setResultDetails([
      { label: 'Current payment', value: fmtUSD(currentMP) },
      { label: 'New payment', value: fmtUSD(newMP) },
      { label: 'Monthly savings', value: fmtUSD(Math.max(0, monthlySavings)), green: true },
    ]);
  }, [refBalance, refCurrentRate, refNewRate, refRemaining]);

  const calcEarlyPayoff = useCallback(() => {
    const balance = epBalance;
    const extra = epExtra;
    const rate = epRate;
    const term = parseInt(epTerm);

    const baseMP = monthlyPayment(balance, rate, term);
    const r = rate / 100 / 12;

    let bal = balance;
    let months = 0;
    let totalPaidExtra = 0;
    const maxMonths = term * 12;

    if (baseMP > 0 && r >= 0) {
      while (bal > 0.01 && months < maxMonths) {
        const interest = bal * r;
        const principal = baseMP + extra - interest;
        if (principal <= 0) { months = maxMonths; break; }
        bal -= principal;
        if (bal < 0) { totalPaidExtra += baseMP + extra + bal; break; }
        totalPaidExtra += baseMP + extra;
        months++;
      }
    }

    const originalTotal = baseMP * term * 12;
    const saved = originalTotal - totalPaidExtra;
    const yearsSaved = term - (months / 12);

    setResultLabel('You save with extra payments');
    setResultPrimary(fmtUSD(Math.max(0, saved)));
    setResultDetails([
      { label: 'Paid off in', value: (months / 12).toFixed(1) + ' years' },
      { label: 'Years saved', value: yearsSaved.toFixed(1) + ' years', green: true },
      { label: 'Base payment', value: fmtUSD(baseMP) + '/mo' },
    ]);
  }, [epBalance, epExtra, epRate, epTerm]);

  // ── Recalculate on input change ──
  useEffect(() => {
    switch (activeTab) {
      case 'first-home': calcFirstHome(); break;
      case 'refinance': calcRefinance(); break;
      case 'early-payoff': calcEarlyPayoff(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcFirstHome, calcRefinance, calcEarlyPayoff]);

  // ── Load from URL on mount ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;

    const tabId = params.get('tab') as TabId;
    if (['first-home', 'refinance', 'early-payoff'].includes(tabId)) {
      setActiveTab(tabId);
    }

    // Apply params to the correct tab state
    const get = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null ? parseFloat(v) || fallback : fallback;
    };
    const getStr = (key: string, fallback: string) => params.get(key) || fallback;

    if (tabId === 'first-home' || !tabId) {
      if (params.has('fh-income')) setFhIncome(get('fh-income', 85000));
      if (params.has('fh-expenses')) setFhExpenses(get('fh-expenses', 600));
      if (params.has('fh-rate')) setFhRate(get('fh-rate', 6.5));
      if (params.has('fh-term')) setFhTerm(getStr('fh-term', '30'));
      if (params.has('fh-down')) setFhDown(get('fh-down', 10));
    }
    if (tabId === 'refinance') {
      if (params.has('ref-balance')) setRefBalance(get('ref-balance', 280000));
      if (params.has('ref-current-rate')) setRefCurrentRate(get('ref-current-rate', 7.5));
      if (params.has('ref-new-rate')) setRefNewRate(get('ref-new-rate', 6.0));
      if (params.has('ref-remaining')) setRefRemaining(getStr('ref-remaining', '25'));
    }
    if (tabId === 'early-payoff') {
      if (params.has('ep-balance')) setEpBalance(get('ep-balance', 300000));
      if (params.has('ep-extra')) setEpExtra(get('ep-extra', 200));
      if (params.has('ep-rate')) setEpRate(get('ep-rate', 6.5));
      if (params.has('ep-term')) setEpTerm(getStr('ep-term', '30'));
    }

    // Version banner
    const urlVersion = params.get('v');
    const updatedAt = '2026-03-08';
    if (urlVersion && urlVersion < updatedAt) {
      setShowVersionBanner(true);
    }
  }, []);

  // ── Input change handler ──
  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'fh-income': setFhIncome, 'fh-expenses': setFhExpenses,
      'fh-rate': setFhRate, 'fh-down': setFhDown,
      'ref-balance': setRefBalance, 'ref-current-rate': setRefCurrentRate,
      'ref-new-rate': setRefNewRate,
      'ep-balance': setEpBalance, 'ep-extra': setEpExtra, 'ep-rate': setEpRate,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    const setters: Record<string, (v: string) => void> = {
      'fh-term': setFhTerm, 'ref-remaining': setRefRemaining, 'ep-term': setEpTerm,
    };
    setters[id]?.(val);
  };

  // ── Get current values for share URL ──
  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'first-home':
        return { 'fh-income': fhIncome, 'fh-expenses': fhExpenses, 'fh-rate': fhRate, 'fh-term': fhTerm, 'fh-down': fhDown };
      case 'refinance':
        return { 'ref-balance': refBalance, 'ref-current-rate': refCurrentRate, 'ref-new-rate': refNewRate, 'ref-remaining': refRemaining };
      case 'early-payoff':
        return { 'ep-balance': epBalance, 'ep-extra': epExtra, 'ep-rate': epRate, 'ep-term': epTerm };
    }
  };

  // ── Tab switch ──
  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
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
    const canShare = typeof navigator.share === 'function';
    trackEvent('share_click', { method: canShare ? 'native' : 'clipboard', tab: activeTab });
    if (canShare) {
      navigator.share({ title: 'Mortgage Calculator — sum.money', url });
    } else {
      navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
    }
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Result copied'));
  };

  const termOptions = [
    { value: '10', label: '10 years' },
    { value: '15', label: '15 years' },
    { value: '20', label: '20 years' },
    { value: '25', label: '25 years' },
    { value: '30', label: '30 years' },
  ];

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
            Calculator updated since this link was created. Your inputs are preserved, but the result reflects current rates.
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }}
              onClick={() => setShowVersionBanner(false)}
            >
              ×
            </button>
          </div>
        )}

        {/* FIRST HOME */}
        {activeTab === 'first-home' && (
          <div>
            <div className="calc-section-label">Your finances</div>
            <div className="inputs-grid">
              <CalcInput id="fh-income" label="Annual income" prefix="$" defaultValue={85000} value={fhIncome} onChange={handleInput} />
              <CalcInput id="fh-expenses" label="Monthly debt payments" prefix="$" defaultValue={600} value={fhExpenses} onChange={handleInput} helpText="Loans & credit cards only — not rent or groceries" />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="fh-rate" label="Interest rate" suffix="%" defaultValue={6.5} value={fhRate} onChange={handleInput} />
                <CalcSelect id="fh-term" label="Loan term" options={[
                  { value: '15', label: '15 years' },
                  { value: '20', label: '20 years' },
                  { value: '25', label: '25 years' },
                  { value: '30', label: '30 years' },
                ]} value={fhTerm} onChange={handleSelect} />
                <CalcInput id="fh-down" label="Down payment" suffix="%" defaultValue={10} value={fhDown} onChange={handleInput} />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* REFINANCE */}
        {activeTab === 'refinance' && (
          <div>
            <div className="calc-section-label">Compare rates</div>
            <div className="inputs-grid">
              <CalcInput id="ref-balance" label="Remaining balance" prefix="$" defaultValue={280000} value={refBalance} onChange={handleInput} />
              <CalcInput id="ref-current-rate" label="Current rate" suffix="%" defaultValue={7.5} value={refCurrentRate} onChange={handleInput} />
              <CalcInput id="ref-new-rate" label="New offered rate" suffix="%" defaultValue={6.0} value={refNewRate} onChange={handleInput} />
            </div>
            <MoreOptions count={1}>
              <div className="inputs-grid">
                <CalcSelect id="ref-remaining" label="Remaining years" options={termOptions} value={refRemaining} onChange={handleSelect} />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* EARLY PAYOFF */}
        {activeTab === 'early-payoff' && (
          <div>
            <div className="calc-section-label">Your mortgage</div>
            <div className="inputs-grid">
              <CalcInput id="ep-balance" label="Loan balance" prefix="$" defaultValue={300000} value={epBalance} onChange={handleInput} />
              <CalcInput id="ep-extra" label="Extra monthly payment" prefix="$" defaultValue={200} value={epExtra} onChange={handleInput} />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="ep-rate" label="Interest rate" suffix="%" defaultValue={6.5} value={epRate} onChange={handleInput} />
                <CalcSelect id="ep-term" label="Remaining term" options={termOptions} value={epTerm} onChange={handleSelect} />
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
                <span className={`result-detail-value ${d.green ? 'green' : ''}`}>{d.value}</span>
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

      {/* Copy feedback toast */}
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
