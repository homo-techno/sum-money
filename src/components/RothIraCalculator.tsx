import { useState, useEffect, useRef, useCallback } from 'react';

type TabId = 'growth' | 'compare';
interface TabConfig { id: TabId; label: string; icon: string; }
const TABS: TabConfig[] = [
  { id: 'growth', label: 'Growth', icon: '📈' },
  { id: 'compare', label: 'Roth vs Traditional', icon: '⚖️' },
];

function fmtUSD(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function formatCurrency(v: number): string { return v.toLocaleString('en-US'); }
function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  contribution: { min: 0, max: 7000, msgLow: '', msgHigh: '2025 Roth IRA limit is $7,000 ($8,000 if 50+).' },
  returnRate: { min: 1, max: 20, msgLow: '', msgHigh: 'Expected return above 20% is very optimistic.' },
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

function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/us/roth-ira-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

const TAX_BRACKETS = [
  { value: '10', label: '10%' }, { value: '12', label: '12%' }, { value: '22', label: '22%' },
  { value: '24', label: '24%' }, { value: '32', label: '32%' }, { value: '35', label: '35%' },
  { value: '37', label: '37%' },
];

export default function RothIraCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('growth');
  const completionTracked = useRef<Record<string, boolean>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['growth']));

  // Growth state
  const [gAge, setGAge] = useState(30);
  const [gRetireAge, setGRetireAge] = useState(65);
  const [gBalance, setGBalance] = useState(10000);
  const [gContribution, setGContribution] = useState(7000);
  const [gReturn, setGReturn] = useState(7);

  // Compare state
  const [cContribution, setCContribution] = useState(7000);
  const [cCurrentBracket, setCCurrentBracket] = useState('22');
  const [cRetireBracket, setCRetireBracket] = useState('12');
  const [cYears, setCYears] = useState(35);
  const [cReturn, setCReturn] = useState(7);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calcGrowth = useCallback(() => {
    const years = Math.max(gRetireAge - gAge, 1);
    const r = gReturn / 100;
    let balance = gBalance;
    for (let y = 0; y < years; y++) {
      balance = balance * (1 + r) + gContribution;
    }
    const totalContributed = gBalance + gContribution * years;
    const taxFreeGrowth = balance - totalContributed;

    setResultLabel('Balance at retirement');
    setResultPrimary(fmtUSD(balance));
    setResultDetails([
      { label: 'Total contributed', value: fmtUSD(totalContributed) },
      { label: 'Tax-free growth', value: fmtUSD(taxFreeGrowth), green: true },
      { label: 'Years to retirement', value: String(years) },
      { label: 'Tax on withdrawal', value: '$0 (Roth)', green: true },
    ]);
  }, [gAge, gRetireAge, gBalance, gContribution, gReturn]);

  const calcCompare = useCallback(() => {
    const r = cReturn / 100;
    const currentRate = parseInt(cCurrentBracket) / 100;
    const retireRate = parseInt(cRetireBracket) / 100;

    // Roth: contribute after-tax dollars, grow tax-free
    const rothAnnual = cContribution; // already after-tax
    let rothBalance = 0;
    for (let y = 0; y < cYears; y++) {
      rothBalance = rothBalance * (1 + r) + rothAnnual;
    }
    const rothFinal = rothBalance; // no tax on withdrawal

    // Traditional: contribute pre-tax (so more goes in), but taxed on withdrawal
    const tradAnnual = cContribution / (1 - currentRate); // pre-tax equivalent
    let tradBalance = 0;
    for (let y = 0; y < cYears; y++) {
      tradBalance = tradBalance * (1 + r) + tradAnnual;
    }
    const tradAfterTax = tradBalance * (1 - retireRate);

    const diff = rothFinal - tradAfterTax;
    const winner = diff > 0 ? 'Roth' : diff < 0 ? 'Traditional' : 'Tie';

    setResultLabel(winner === 'Tie' ? 'It\'s a tie' : `${winner} wins by ${fmtUSD(Math.abs(diff))}`);
    setResultPrimary(fmtUSD(Math.max(rothFinal, tradAfterTax)));
    setResultDetails([
      { label: 'Roth IRA (tax-free)', value: fmtUSD(rothFinal), green: diff >= 0 },
      { label: 'Traditional IRA (after tax)', value: fmtUSD(tradAfterTax), green: diff < 0 },
      { label: 'Difference', value: (diff >= 0 ? '+' : '-') + fmtUSD(Math.abs(diff)), green: diff >= 0, red: diff < 0 },
      { label: 'Current tax bracket', value: cCurrentBracket + '%' },
      { label: 'Retirement tax bracket', value: cRetireBracket + '%' },
    ]);
  }, [cContribution, cCurrentBracket, cRetireBracket, cYears, cReturn]);

  useEffect(() => {
    if (activeTab === 'growth') calcGrowth(); else calcCompare();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcGrowth, calcCompare]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['growth', 'compare'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'growth') {
      if (params.has('age')) setGAge(get('age', 30));
      if (params.has('retireAge')) setGRetireAge(get('retireAge', 65));
      if (params.has('balance')) setGBalance(get('balance', 10000));
      if (params.has('contribution')) setGContribution(get('contribution', 7000));
      if (params.has('return')) setGReturn(get('return', 7));
    } else {
      if (params.has('contribution')) setCContribution(get('contribution', 7000));
      if (params.has('currentBracket')) setCCurrentBracket(params.get('currentBracket') || '22');
      if (params.has('retireBracket')) setCRetireBracket(params.get('retireBracket') || '12');
      if (params.has('years')) setCYears(get('years', 35));
      if (params.has('return')) setCReturn(get('return', 7));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'g-age': setGAge, 'g-retireAge': setGRetireAge, 'g-balance': setGBalance,
      'g-contribution': setGContribution, 'g-return': setGReturn,
      'c-contribution': setCContribution, 'c-years': setCYears, 'c-return': setCReturn,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'c-currentBracket') setCCurrentBracket(val);
    else if (id === 'c-retireBracket') setCRetireBracket(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    if (activeTab === 'growth') return { age: gAge, retireAge: gRetireAge, balance: gBalance, contribution: gContribution, return: gReturn };
    return { contribution: cContribution, currentBracket: cCurrentBracket, retireBracket: cRetireBracket, years: cYears, return: cReturn };
  };

  const switchTab = (tabId: TabId) => {
    const prev = activeTab;
    if (!visitedTabs.current.has(tabId)) {
      visitedTabs.current.add(tabId);
      if (tabId === 'compare') { setCContribution(gContribution); setCReturn(gReturn); setCYears(Math.max(gRetireAge - gAge, 1)); }
      if (tabId === 'growth') { setGContribution(cContribution); setGReturn(cReturn); }
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prev, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Roth IRA Calculator — sum.money', url });
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

        {activeTab === 'growth' && (
          <div>
            <div className="calc-section-label">Your Roth IRA</div>
            <div className="inputs-grid">
              <CalcInput id="g-age" label="Current age" defaultValue={30} value={gAge} onChange={handleInput} />
              <CalcInput id="g-retireAge" label="Retirement age" defaultValue={65} value={gRetireAge} onChange={handleInput} />
              <CalcInput id="g-balance" label="Current balance" prefix="$" defaultValue={10000} value={gBalance} onChange={handleInput} />
              <CalcInput id="g-contribution" label="Annual contribution" prefix="$" defaultValue={7000} value={gContribution} onChange={handleInput} helpText="2025 limit: $7,000 ($8,000 if 50+)" />
            </div>
            <MoreOptions count={1}>
              <div className="inputs-grid">
                <CalcInput id="g-return" label="Expected return" suffix="%" defaultValue={7} value={gReturn} onChange={handleInput} helpText="Historical avg: ~7% after inflation" />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'compare' && (
          <div>
            <div className="calc-section-label">Roth vs Traditional</div>
            <div className="inputs-grid">
              <CalcInput id="c-contribution" label="Annual contribution" prefix="$" defaultValue={7000} value={cContribution} onChange={handleInput} />
              <CalcSelect id="c-currentBracket" label="Current tax bracket" options={TAX_BRACKETS} value={cCurrentBracket} onChange={handleSelect} />
              <CalcSelect id="c-retireBracket" label="Retirement tax bracket" options={TAX_BRACKETS} value={cRetireBracket} onChange={handleSelect} />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="c-years" label="Years to retirement" defaultValue={35} value={cYears} onChange={handleInput} />
                <CalcInput id="c-return" label="Expected return" suffix="%" defaultValue={7} value={cReturn} onChange={handleInput} />
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
        2025 Roth IRA limit: $7,000 ($8,000 if 50+). Income limits apply for direct contributions.
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
