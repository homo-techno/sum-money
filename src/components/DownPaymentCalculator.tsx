import { useState, useEffect, useRef, useCallback } from 'react';

type TabId = 'howmuch' | 'savings';
interface TabConfig { id: TabId; label: string; icon: string; }
const TABS: TabConfig[] = [
  { id: 'howmuch', label: 'How Much', icon: '🏠' },
  { id: 'savings', label: 'Savings Plan', icon: '🎯' },
];

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
  const PROD = 'https://sum.money/us/down-payment-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

const DP_OPTIONS = [
  { value: '3', label: '3%' }, { value: '5', label: '5%' },
  { value: '10', label: '10%' }, { value: '15', label: '15%' },
  { value: '20', label: '20%' }, { value: '25', label: '25%' },
];

export default function DownPaymentCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('howmuch');
  const completionTracked = useRef<Record<string, boolean>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['howmuch']));

  // How Much tab
  const [hmPrice, setHmPrice] = useState(350000);
  const [hmPct, setHmPct] = useState('20');
  const [hmRate, setHmRate] = useState(6.5);

  // Savings Plan tab
  const [spPrice, setSpPrice] = useState(350000);
  const [spPct, setSpPct] = useState('20');
  const [spCurrent, setSpCurrent] = useState(20000);
  const [spMonthly, setSpMonthly] = useState(1500);
  const [spSavingsRate, setSpSavingsRate] = useState(4);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calcHowMuch = useCallback(() => {
    const pct = parseInt(hmPct);
    const downPayment = hmPrice * (pct / 100);
    const loanAmount = hmPrice - downPayment;
    const needsPmi = pct < 20;
    const pmiMonthly = needsPmi ? loanAmount * 0.005 / 12 : 0; // ~0.5% annual PMI estimate

    // Estimate monthly mortgage payment (30yr)
    const r = hmRate / 100 / 12;
    const n = 360;
    let mortgage: number;
    if (r === 0) { mortgage = loanAmount / n; }
    else {
      const factor = Math.pow(1 + r, n);
      mortgage = loanAmount * (r * factor) / (factor - 1);
    }

    setResultLabel('Down payment needed');
    setResultPrimary(fmtUSD(downPayment));
    setResultDetails([
      { label: 'Loan amount', value: fmtUSD(loanAmount) },
      { label: 'PMI required', value: needsPmi ? `Yes (~${fmtUSD(pmiMonthly)}/mo)` : 'No', green: !needsPmi, red: needsPmi },
      { label: 'Est. monthly mortgage', value: fmtUSD2(mortgage) },
      { label: 'Total monthly (with PMI)', value: fmtUSD2(mortgage + pmiMonthly) },
    ]);
  }, [hmPrice, hmPct, hmRate]);

  const calcSavings = useCallback(() => {
    const pct = parseInt(spPct);
    const target = spPrice * (pct / 100);
    const remaining = Math.max(target - spCurrent, 0);

    if (remaining <= 0) {
      setResultLabel('You already have enough!');
      setResultPrimary(fmtUSD(target));
      setResultDetails([
        { label: 'Down payment target', value: fmtUSD(target) },
        { label: 'Current savings', value: fmtUSD(spCurrent), green: true },
        { label: 'Surplus', value: fmtUSD(spCurrent - target), green: true },
      ]);
      return;
    }

    // Calculate months to reach target with monthly contributions and interest
    const monthlyRate = spSavingsRate / 100 / 12;
    let balance = spCurrent;
    let months = 0;
    const maxMonths = 600;
    while (balance < target && months < maxMonths) {
      months++;
      balance = balance * (1 + monthlyRate) + spMonthly;
    }

    const years = Math.floor(months / 12);
    const mos = months % 12;
    const timeStr = years > 0 ? `${years}y ${mos}m` : `${mos} months`;

    const targetDate = new Date();
    targetDate.setMonth(targetDate.getMonth() + months);
    const dateStr = targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    setResultLabel('Time to save');
    setResultPrimary(timeStr);
    setResultDetails([
      { label: 'Down payment needed', value: fmtUSD(target) },
      { label: 'Already saved', value: fmtUSD(spCurrent) },
      { label: 'Still need', value: fmtUSD(remaining), red: true },
      { label: 'Monthly savings', value: fmtUSD(spMonthly) },
      { label: 'Target date', value: dateStr, green: true },
    ]);
  }, [spPrice, spPct, spCurrent, spMonthly, spSavingsRate]);

  useEffect(() => {
    if (activeTab === 'howmuch') calcHowMuch(); else calcSavings();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcHowMuch, calcSavings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['howmuch', 'savings'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'howmuch') {
      if (params.has('price')) setHmPrice(get('price', 350000));
      if (params.has('pct')) setHmPct(params.get('pct') || '20');
      if (params.has('rate')) setHmRate(get('rate', 6.5));
    } else {
      if (params.has('price')) setSpPrice(get('price', 350000));
      if (params.has('pct')) setSpPct(params.get('pct') || '20');
      if (params.has('current')) setSpCurrent(get('current', 20000));
      if (params.has('monthly')) setSpMonthly(get('monthly', 1500));
      if (params.has('savingsRate')) setSpSavingsRate(get('savingsRate', 4));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'hm-price': setHmPrice, 'hm-rate': setHmRate,
      'sp-price': setSpPrice, 'sp-current': setSpCurrent, 'sp-monthly': setSpMonthly, 'sp-savingsRate': setSpSavingsRate,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'hm-pct') setHmPct(val);
    else if (id === 'sp-pct') setSpPct(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    if (activeTab === 'howmuch') return { price: hmPrice, pct: hmPct, rate: hmRate };
    return { price: spPrice, pct: spPct, current: spCurrent, monthly: spMonthly, savingsRate: spSavingsRate };
  };

  const switchTab = (tabId: TabId) => {
    const prev = activeTab;
    if (!visitedTabs.current.has(tabId)) {
      visitedTabs.current.add(tabId);
      if (tabId === 'savings') { setSpPrice(hmPrice); setSpPct(hmPct); }
      if (tabId === 'howmuch') { setHmPrice(spPrice); setHmPct(spPct); }
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prev, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Down Payment Calculator — sum.money', url });
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

        {activeTab === 'howmuch' && (
          <div>
            <div className="calc-section-label">Your home purchase</div>
            <div className="inputs-grid">
              <CalcInput id="hm-price" label="Home price" prefix="$" defaultValue={350000} value={hmPrice} onChange={handleInput} />
              <CalcSelect id="hm-pct" label="Down payment %" options={DP_OPTIONS} value={hmPct} onChange={handleSelect} />
            </div>
            <MoreOptions count={1}>
              <div className="inputs-grid">
                <CalcInput id="hm-rate" label="Mortgage rate" suffix="%" defaultValue={6.5} value={hmRate} onChange={handleInput} helpText="For estimated monthly payment" />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'savings' && (
          <div>
            <div className="calc-section-label">Your savings plan</div>
            <div className="inputs-grid">
              <CalcInput id="sp-price" label="Target home price" prefix="$" defaultValue={350000} value={spPrice} onChange={handleInput} />
              <CalcSelect id="sp-pct" label="Down payment %" options={DP_OPTIONS} value={spPct} onChange={handleSelect} />
              <CalcInput id="sp-current" label="Current savings" prefix="$" defaultValue={20000} value={spCurrent} onChange={handleInput} />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="sp-monthly" label="Monthly savings" prefix="$" defaultValue={1500} value={spMonthly} onChange={handleInput} />
                <CalcInput id="sp-savingsRate" label="Savings interest rate" suffix="%" defaultValue={4} value={spSavingsRate} onChange={handleInput} helpText="HYSA rate or investment return" />
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
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
