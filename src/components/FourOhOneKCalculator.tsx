import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'growth' | 'maxout';
interface TabConfig { id: TabId; label: string; icon: string; }
const TABS: TabConfig[] = [
  { id: 'growth', label: 'Growth', icon: '📈' },
  { id: 'maxout', label: 'Max Out', icon: '🎯' },
];

// ── Formatting ──
function fmtUSD(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function formatCurrency(v: number): string { return v.toLocaleString('en-US'); }
function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Soft warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  balance: { min: 0, max: 10000000, msgLow: '', msgHigh: 'Unusually high balance.' },
  contribution: { min: 0, max: 23500, msgLow: '', msgHigh: '2025 limit is $23,500. Excess may be penalized.' },
  salary: { min: 10000, max: 5000000, msgLow: 'Very low salary.', msgHigh: 'Unusually high salary.' },
  returnRate: { min: 1, max: 20, msgLow: '', msgHigh: 'Expected return above 20% is very optimistic.' },
};

function SoftWarning({ fieldId, value }: { fieldId: string; value: number }) {
  const rule = SOFT_WARNINGS[fieldId];
  if (!rule) return null;
  let msg = '';
  if (value > 0 && value < rule.min && rule.msgLow) msg = rule.msgLow;
  else if (value > rule.max && rule.msgHigh) msg = rule.msgHigh;
  if (!msg) return null;
  return (
    <div style={{ fontSize: '.78rem', color: '#b8860b', background: '#fef9ec', border: '1px solid #f0e6c8', borderRadius: '4px', padding: '6px 10px', marginTop: '4px', lineHeight: 1.4 }}>
      {msg}
    </div>
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
  const PROD = 'https://sum.money/us/401k-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── 2025 Limits ──
const LIMIT_2025 = 23500;
const CATCHUP_50 = 7500;

export default function FourOhOneKCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('growth');
  const completionTracked = useRef<Record<string, boolean>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['growth']));

  // Growth tab state
  const [gAge, setGAge] = useState(30);
  const [gRetireAge, setGRetireAge] = useState(65);
  const [gBalance, setGBalance] = useState(25000);
  const [gContribution, setGContribution] = useState(6000);
  const [gMatchPct, setGMatchPct] = useState(50);
  const [gMatchLimit, setGMatchLimit] = useState(6);
  const [gSalary, setGSalary] = useState(75000);
  const [gReturn, setGReturn] = useState(7);

  // Max Out tab state
  const [mSalary, setMSalary] = useState(75000);
  const [mContribPct, setMContribPct] = useState(6);
  const [mOver50, setMOver50] = useState('no');
  const [mMatchPct, setMMatchPct] = useState(50);
  const [mMatchLimit, setMMatchLimit] = useState(6);

  // Result state
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  // Growth calc
  const calcGrowth = useCallback(() => {
    const years = Math.max(gRetireAge - gAge, 1);
    const annualReturn = gReturn / 100;
    const employerMatch = Math.min(gContribution, gSalary * (gMatchLimit / 100)) * (gMatchPct / 100);
    const totalAnnual = gContribution + employerMatch;

    let balance = gBalance;
    let totalYourContrib = 0;
    let totalEmployerContrib = 0;
    for (let y = 0; y < years; y++) {
      balance *= (1 + annualReturn);
      balance += totalAnnual;
      totalYourContrib += gContribution;
      totalEmployerContrib += employerMatch;
    }

    const investmentGrowth = balance - gBalance - totalYourContrib - totalEmployerContrib;

    setResultLabel('Balance at retirement');
    setResultPrimary(fmtUSD(balance));
    setResultDetails([
      { label: 'Your contributions', value: fmtUSD(totalYourContrib) },
      { label: 'Employer contributions', value: fmtUSD(totalEmployerContrib), green: true },
      { label: 'Investment growth', value: fmtUSD(investmentGrowth), green: true },
      { label: 'Years to retirement', value: String(years) },
    ]);
  }, [gAge, gRetireAge, gBalance, gContribution, gMatchPct, gMatchLimit, gSalary, gReturn]);

  // Max Out calc
  const calcMaxOut = useCallback(() => {
    const limit = mOver50 === 'yes' ? LIMIT_2025 + CATCHUP_50 : LIMIT_2025;
    const currentContrib = mSalary * (mContribPct / 100);
    const gap = Math.max(limit - currentContrib, 0);
    const extraMonthly = gap / 12;

    const employerMatch = Math.min(currentContrib, mSalary * (mMatchLimit / 100)) * (mMatchPct / 100);
    const maxEmployerMatch = Math.min(limit, mSalary * (mMatchLimit / 100)) * (mMatchPct / 100);

    setResultLabel('Your 401(k) contribution gap');
    setResultPrimary(gap > 0 ? fmtUSD(gap) + '/yr' : 'You\'re maxed out!');
    setResultDetails([
      { label: 'Current annual contribution', value: fmtUSD(currentContrib) },
      { label: '2025 maximum', value: fmtUSD(limit) },
      { label: 'Extra per month to max out', value: gap > 0 ? fmtUSD(extraMonthly) : '$0', red: gap > 0 },
      { label: 'Current employer match', value: fmtUSD(employerMatch), green: true },
      { label: 'Max employer match', value: fmtUSD(maxEmployerMatch), green: true },
    ]);
  }, [mSalary, mContribPct, mOver50, mMatchPct, mMatchLimit]);

  useEffect(() => {
    if (activeTab === 'growth') calcGrowth();
    else calcMaxOut();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcGrowth, calcMaxOut]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['growth', 'maxout'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'growth') {
      if (params.has('age')) setGAge(get('age', 30));
      if (params.has('retireAge')) setGRetireAge(get('retireAge', 65));
      if (params.has('balance')) setGBalance(get('balance', 25000));
      if (params.has('contribution')) setGContribution(get('contribution', 6000));
      if (params.has('matchPct')) setGMatchPct(get('matchPct', 50));
      if (params.has('matchLimit')) setGMatchLimit(get('matchLimit', 6));
      if (params.has('salary')) setGSalary(get('salary', 75000));
      if (params.has('return')) setGReturn(get('return', 7));
    } else {
      if (params.has('salary')) setMSalary(get('salary', 75000));
      if (params.has('contribPct')) setMContribPct(get('contribPct', 6));
      if (params.has('over50')) setMOver50(params.get('over50') || 'no');
      if (params.has('matchPct')) setMMatchPct(get('matchPct', 50));
      if (params.has('matchLimit')) setMMatchLimit(get('matchLimit', 6));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'g-age': setGAge, 'g-retireAge': setGRetireAge, 'g-balance': setGBalance,
      'g-contribution': setGContribution, 'g-matchPct': setGMatchPct, 'g-matchLimit': setGMatchLimit,
      'g-salary': setGSalary, 'g-return': setGReturn,
      'm-salary': setMSalary, 'm-contribPct': setMContribPct,
      'm-matchPct': setMMatchPct, 'm-matchLimit': setMMatchLimit,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => { if (id === 'm-over50') setMOver50(val); };

  const getCurrentValues = (): Record<string, number | string> => {
    if (activeTab === 'growth') return { age: gAge, retireAge: gRetireAge, balance: gBalance, contribution: gContribution, matchPct: gMatchPct, matchLimit: gMatchLimit, salary: gSalary, return: gReturn };
    return { salary: mSalary, contribPct: mContribPct, over50: mOver50, matchPct: mMatchPct, matchLimit: mMatchLimit };
  };

  const switchTab = (tabId: TabId) => {
    const prev = activeTab;
    if (!visitedTabs.current.has(tabId)) {
      visitedTabs.current.add(tabId);
      if (tabId === 'maxout' && gSalary > 0) { setMSalary(gSalary); setMMatchPct(gMatchPct); setMMatchLimit(gMatchLimit); }
      if (tabId === 'growth' && mSalary > 0) { setGSalary(mSalary); setGMatchPct(mMatchPct); setGMatchLimit(mMatchLimit); }
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prev, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: '401(k) Calculator — sum.money', url });
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

        {activeTab === 'growth' && (
          <div>
            <div className="calc-section-label">Your 401(k)</div>
            <div className="inputs-grid">
              <CalcInput id="g-age" label="Current age" suffix="" defaultValue={30} value={gAge} onChange={handleInput} />
              <CalcInput id="g-retireAge" label="Retirement age" suffix="" defaultValue={65} value={gRetireAge} onChange={handleInput} />
              <CalcInput id="g-balance" label="Current balance" prefix="$" defaultValue={25000} value={gBalance} onChange={handleInput} />
              <CalcInput id="g-contribution" label="Annual contribution" prefix="$" defaultValue={6000} value={gContribution} onChange={handleInput} helpText="Your annual 401(k) contribution" />
            </div>
            <MoreOptions count={4}>
              <div className="inputs-grid">
                <CalcInput id="g-matchPct" label="Employer match" suffix="%" defaultValue={50} value={gMatchPct} onChange={handleInput} helpText="% of your contribution they match" />
                <CalcInput id="g-matchLimit" label="Match limit (% of salary)" suffix="%" defaultValue={6} value={gMatchLimit} onChange={handleInput} helpText="They only match up to this % of salary" />
                <CalcInput id="g-salary" label="Annual salary" prefix="$" defaultValue={75000} value={gSalary} onChange={handleInput} />
                <CalcInput id="g-return" label="Expected return" suffix="%" defaultValue={7} value={gReturn} onChange={handleInput} helpText="Historical S&P 500 avg: ~10% (7% after inflation)" />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'maxout' && (
          <div>
            <div className="calc-section-label">Your contribution</div>
            <div className="inputs-grid">
              <CalcInput id="m-salary" label="Annual salary" prefix="$" defaultValue={75000} value={mSalary} onChange={handleInput} />
              <CalcInput id="m-contribPct" label="Current contribution" suffix="%" defaultValue={6} value={mContribPct} onChange={handleInput} helpText="% of salary you currently contribute" />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcSelect id="m-over50" label="Age 50 or older?" options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes (catch-up eligible)' }]} value={mOver50} onChange={handleSelect} />
                <CalcInput id="m-matchPct" label="Employer match" suffix="%" defaultValue={50} value={mMatchPct} onChange={handleInput} helpText="% of your contribution they match" />
                <CalcInput id="m-matchLimit" label="Match limit (% of salary)" suffix="%" defaultValue={6} value={mMatchLimit} onChange={handleInput} />
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
        2025 contribution limit: $23,500 ($31,000 if 50+). Does not account for taxes on withdrawals.
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
