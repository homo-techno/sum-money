import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'first-time' | 'remortgage' | 'overpayment';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'first-time', label: 'First-Time Buyer', icon: '🏠' },
  { id: 'remortgage', label: 'Remortgage', icon: '🔄' },
  { id: 'overpayment', label: 'Overpayment', icon: '💷' },
];

// ── Formatting ──
function fmtGBP(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '£0';
  return '£' + Math.round(n).toLocaleString('en-GB');
}

function formatCurrency(v: number): string {
  return v.toLocaleString('en-GB');
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Soft warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  income: { min: 5000, max: 500000, msgLow: 'Very low income. Did you mean annual income?', msgHigh: 'Unusually high income. Double-check.' },
  balance: { min: 5000, max: 5000000, msgLow: 'Very low balance.', msgHigh: 'Unusually high balance.' },
  debts: { min: 0, max: 50000, msgLow: '', msgHigh: 'Unusually high monthly debts.' },
  overpayment: { min: 10, max: 50000, msgLow: '', msgHigh: 'Unusually high monthly overpayment.' },
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
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
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

// ── Event tracking ──
function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

// ── Share URL ──
function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/uk/mortgage-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Annuity formula ──
function monthlyPayment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) return principal / (years * 12);
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// ── Main Component ──
export default function UkMortgageCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('first-time');
  const completionTracked = useRef<Record<string, boolean>>({});

  // First-Time Buyer
  const [ftIncome, setFtIncome] = useState(45000);
  const [ftDebts, setFtDebts] = useState(0);
  const [ftRate, setFtRate] = useState(4.5);
  const [ftTerm, setFtTerm] = useState('25');
  const [ftDeposit, setFtDeposit] = useState(10);

  // Remortgage
  const [rmBalance, setRmBalance] = useState(200000);
  const [rmCurrentRate, setRmCurrentRate] = useState(5.5);
  const [rmNewRate, setRmNewRate] = useState(4.0);
  const [rmRemaining, setRmRemaining] = useState(20);
  const [rmErc, setRmErc] = useState(0);

  // Overpayment
  const [opBalance, setOpBalance] = useState(250000);
  const [opOverpayment, setOpOverpayment] = useState(200);
  const [opRate, setOpRate] = useState(4.5);
  const [opRemaining, setOpRemaining] = useState(25);

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const savedTabValues = useRef<Record<string, Record<string, number | string>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['first-time']));

  // ── Calculation: First-Time Buyer ──
  const calcFirstTime = useCallback(() => {
    const income = ftIncome;
    const multiplier = 4.5; // typical UK mortgage income multiplier
    const maxMortgage = income * multiplier;
    const depositPct = ftDeposit / 100;
    const maxPrice = maxMortgage / (1 - depositPct);
    const depositAmount = maxPrice * depositPct;
    const ltv = ((maxPrice - depositAmount) / maxPrice) * 100;
    const term = parseInt(ftTerm);
    const payment = monthlyPayment(maxMortgage, ftRate, term);
    const totalRepaid = payment * term * 12;
    const totalInterest = totalRepaid - maxMortgage;

    // Affordability check: monthly payment + debts vs income
    const monthlyIncome = income / 12;
    const dti = monthlyIncome > 0 ? ((payment + ftDebts) / monthlyIncome) * 100 : 0;

    setResultLabel('Maximum property price');
    setResultPrimary(fmtGBP(maxPrice));
    setResultDetails([
      { label: 'Mortgage amount', value: fmtGBP(maxMortgage) },
      { label: 'Deposit required', value: fmtGBP(depositAmount) },
      { label: 'Monthly repayment', value: fmtGBP(payment) },
      { label: 'Total interest', value: fmtGBP(totalInterest) },
      { label: 'LTV ratio', value: ltv.toFixed(0) + '%' },
      ...(dti > 45 ? [{ label: 'Debt-to-income', value: dti.toFixed(0) + '% — may be hard to get approved', red: true }] : []),
    ]);
  }, [ftIncome, ftDebts, ftRate, ftTerm, ftDeposit]);

  // ── Calculation: Remortgage ──
  const calcRemortgage = useCallback(() => {
    const balance = rmBalance;
    const remaining = rmRemaining;
    const currentPayment = monthlyPayment(balance, rmCurrentRate, remaining);
    const newPayment = monthlyPayment(balance, rmNewRate, remaining);
    const monthlySavings = currentPayment - newPayment;
    const totalSavings = monthlySavings * remaining * 12 - rmErc;
    const breakEven = rmErc > 0 && monthlySavings > 0 ? Math.ceil(rmErc / monthlySavings) : 0;

    setResultLabel(monthlySavings > 0 ? 'Monthly savings' : 'Monthly change');
    setResultPrimary((monthlySavings >= 0 ? '' : '+') + fmtGBP(Math.abs(monthlySavings)) + '/mo');
    setResultDetails([
      { label: 'Current payment', value: fmtGBP(currentPayment) + '/mo' },
      { label: 'New payment', value: fmtGBP(newPayment) + '/mo', green: newPayment < currentPayment },
      ...(rmErc > 0 ? [{ label: 'Early repayment charge', value: fmtGBP(rmErc), red: true }] : []),
      ...(breakEven > 0 ? [{ label: 'Break-even', value: breakEven + ' months' }] : []),
      { label: 'Total savings', value: fmtGBP(totalSavings), green: totalSavings > 0, red: totalSavings < 0 },
      { label: 'Verdict', value: totalSavings > 0 ? 'Worth remortgaging ✓' : 'Not worth it at this rate', green: totalSavings > 0, red: totalSavings <= 0 },
    ]);
  }, [rmBalance, rmCurrentRate, rmNewRate, rmRemaining, rmErc]);

  // ── Calculation: Overpayment ──
  const calcOverpayment = useCallback(() => {
    const balance = opBalance;
    const rate = opRate / 100 / 12;
    const remaining = opRemaining;
    const normalPayment = monthlyPayment(balance, opRate, remaining);

    // Simulate with overpayment
    let bal = balance;
    let monthsWithOverpay = 0;
    let totalInterestWithOverpay = 0;
    const totalPayment = normalPayment + opOverpayment;

    while (bal > 0 && monthsWithOverpay < remaining * 12) {
      const interest = bal * rate;
      totalInterestWithOverpay += interest;
      const principal = totalPayment - interest;
      if (principal <= 0) break; // payment doesn't cover interest
      bal -= principal;
      monthsWithOverpay++;
      if (bal <= 0) break;
    }

    // Normal scenario
    const normalTotalInterest = normalPayment * remaining * 12 - balance;
    const interestSaved = normalTotalInterest - totalInterestWithOverpay;
    const timeSavedMonths = remaining * 12 - monthsWithOverpay;
    const timeSavedYears = Math.floor(timeSavedMonths / 12);
    const timeSavedRemMonths = timeSavedMonths % 12;

    let timeSavedStr = '';
    if (timeSavedYears > 0) timeSavedStr += timeSavedYears + 'y ';
    timeSavedStr += timeSavedRemMonths + 'm';

    setResultLabel('Interest saved');
    setResultPrimary(fmtGBP(interestSaved));
    setResultDetails([
      { label: 'Time saved', value: timeSavedStr, green: true },
      { label: 'New payoff', value: Math.floor(monthsWithOverpay / 12) + 'y ' + (monthsWithOverpay % 12) + 'm' },
      { label: 'Normal interest', value: fmtGBP(normalTotalInterest) },
      { label: 'With overpayment', value: fmtGBP(totalInterestWithOverpay), green: true },
      { label: 'Monthly payment', value: fmtGBP(totalPayment) + ' (incl. ' + fmtGBP(opOverpayment) + ' extra)' },
    ]);
  }, [opBalance, opOverpayment, opRate, opRemaining]);

  // ── Recalculate ──
  useEffect(() => {
    switch (activeTab) {
      case 'first-time': calcFirstTime(); break;
      case 'remortgage': calcRemortgage(); break;
      case 'overpayment': calcOverpayment(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcFirstTime, calcRemortgage, calcOverpayment]);

  // ── URL params ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['first-time', 'remortgage', 'overpayment'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'first-time') {
      if (params.has('income')) setFtIncome(get('income', 45000));
      if (params.has('debts')) setFtDebts(get('debts', 0));
      if (params.has('rate')) setFtRate(get('rate', 4.5));
      if (params.has('term')) setFtTerm(params.get('term') || '25');
      if (params.has('deposit')) setFtDeposit(get('deposit', 10));
    }
    if (tabId === 'remortgage') {
      if (params.has('balance')) setRmBalance(get('balance', 200000));
      if (params.has('currentRate')) setRmCurrentRate(get('currentRate', 5.5));
      if (params.has('newRate')) setRmNewRate(get('newRate', 4.0));
      if (params.has('remaining')) setRmRemaining(get('remaining', 20));
      if (params.has('erc')) setRmErc(get('erc', 0));
    }
    if (tabId === 'overpayment') {
      if (params.has('balance')) setOpBalance(get('balance', 250000));
      if (params.has('overpayment')) setOpOverpayment(get('overpayment', 200));
      if (params.has('rate')) setOpRate(get('rate', 4.5));
      if (params.has('remaining')) setOpRemaining(get('remaining', 25));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  // ── Tab management ──
  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'first-time': savedTabValues.current['first-time'] = { income: ftIncome, debts: ftDebts, rate: ftRate, term: ftTerm, deposit: ftDeposit }; break;
      case 'remortgage': savedTabValues.current['remortgage'] = { balance: rmBalance, currentRate: rmCurrentRate, newRate: rmNewRate, remaining: rmRemaining, erc: rmErc }; break;
      case 'overpayment': savedTabValues.current['overpayment'] = { balance: opBalance, overpayment: opOverpayment, rate: opRate, remaining: opRemaining }; break;
    }
  }, [activeTab, ftIncome, ftDebts, ftRate, ftTerm, ftDeposit, rmBalance, rmCurrentRate, rmNewRate, rmRemaining, rmErc, opBalance, opOverpayment, opRate, opRemaining]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const s = savedTabValues.current[tabId];
    if (!s) return;
    switch (tabId) {
      case 'first-time': setFtIncome(s.income as number); setFtDebts(s.debts as number); setFtRate(s.rate as number); setFtTerm(s.term as string); setFtDeposit(s.deposit as number); break;
      case 'remortgage': setRmBalance(s.balance as number); setRmCurrentRate(s.currentRate as number); setRmNewRate(s.newRate as number); setRmRemaining(s.remaining as number); setRmErc(s.erc as number); break;
      case 'overpayment': setOpBalance(s.balance as number); setOpOverpayment(s.overpayment as number); setOpRate(s.rate as number); setOpRemaining(s.remaining as number); break;
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'ft-income': setFtIncome, 'ft-debts': setFtDebts, 'ft-rate': setFtRate, 'ft-deposit': setFtDeposit,
      'rm-balance': setRmBalance, 'rm-currentRate': setRmCurrentRate, 'rm-newRate': setRmNewRate, 'rm-remaining': setRmRemaining, 'rm-erc': setRmErc,
      'op-balance': setOpBalance, 'op-overpayment': setOpOverpayment, 'op-rate': setOpRate, 'op-remaining': setOpRemaining,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'ft-term') setFtTerm(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'first-time': return { income: ftIncome, debts: ftDebts, rate: ftRate, term: ftTerm, deposit: ftDeposit };
      case 'remortgage': return { balance: rmBalance, currentRate: rmCurrentRate, newRate: rmNewRate, remaining: rmRemaining, erc: rmErc };
      case 'overpayment': return { balance: opBalance, overpayment: opOverpayment, rate: opRate, remaining: opRemaining };
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
    if (navigator.share) navigator.share({ title: 'UK Mortgage Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Result copied'));
  };

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

        {/* FIRST-TIME BUYER */}
        {activeTab === 'first-time' && (
          <div>
            <div className="calc-section-label">Your finances</div>
            <div className="inputs-grid">
              <CalcInput id="ft-income" label="Annual income" prefix="£" defaultValue={45000} value={ftIncome} onChange={handleInput} />
              <CalcInput id="ft-debts" label="Monthly debts" prefix="£" defaultValue={0} value={ftDebts} onChange={handleInput} helpText="Credit cards, car finance, student loan, etc." />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="ft-rate" label="Interest rate" suffix="%" defaultValue={4.5} value={ftRate} onChange={handleInput} />
                <CalcSelect id="ft-term" label="Mortgage term" options={[
                  { value: '20', label: '20 years' }, { value: '25', label: '25 years' },
                  { value: '30', label: '30 years' }, { value: '35', label: '35 years' },
                ]} value={ftTerm} onChange={handleSelect} />
                <CalcInput id="ft-deposit" label="Deposit" suffix="%" defaultValue={10} value={ftDeposit} onChange={handleInput} helpText="Typical: 5–20%. 10%+ gets better rates." />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* REMORTGAGE */}
        {activeTab === 'remortgage' && (
          <div>
            <div className="calc-section-label">Your current mortgage</div>
            <div className="inputs-grid">
              <CalcInput id="rm-balance" label="Outstanding balance" prefix="£" defaultValue={200000} value={rmBalance} onChange={handleInput} />
              <CalcInput id="rm-currentRate" label="Current rate" suffix="%" defaultValue={5.5} value={rmCurrentRate} onChange={handleInput} helpText="Your SVR or current fixed rate" />
              <CalcInput id="rm-newRate" label="New rate" suffix="%" defaultValue={4.0} value={rmNewRate} onChange={handleInput} />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="rm-remaining" label="Remaining term" suffix="years" defaultValue={20} value={rmRemaining} onChange={handleInput} />
                <CalcInput id="rm-erc" label="Early repayment charge" prefix="£" defaultValue={0} value={rmErc} onChange={handleInput} helpText="Fee for leaving your current deal early" />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* OVERPAYMENT */}
        {activeTab === 'overpayment' && (
          <div>
            <div className="calc-section-label">Your mortgage</div>
            <div className="inputs-grid">
              <CalcInput id="op-balance" label="Mortgage balance" prefix="£" defaultValue={250000} value={opBalance} onChange={handleInput} />
              <CalcInput id="op-overpayment" label="Monthly overpayment" prefix="£" defaultValue={200} value={opOverpayment} onChange={handleInput} helpText="Most lenders allow up to 10% per year" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="op-rate" label="Interest rate" suffix="%" defaultValue={4.5} value={opRate} onChange={handleInput} />
                <CalcInput id="op-remaining" label="Remaining term" suffix="years" defaultValue={25} value={opRemaining} onChange={handleInput} />
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

      <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '.78rem', color: 'var(--ink-muted)', fontStyle: 'italic' }}>
        Based on a 4.5× income multiplier. Actual lending criteria vary by lender.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
