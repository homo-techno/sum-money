import { useState, useEffect, useRef, useCallback } from 'react';

type TabId = 'longterm' | 'shortterm';
interface TabConfig { id: TabId; label: string; icon: string; }
const TABS: TabConfig[] = [
  { id: 'longterm', label: 'Long-Term', icon: '📅' },
  { id: 'shortterm', label: 'Short-Term', icon: '⚡' },
];

type FilingStatus = 'single' | 'mfj' | 'hoh';

// ── 2025 Long-term Capital Gains Brackets ──
const LT_BRACKETS: Record<FilingStatus, Array<[number, number]>> = {
  single: [[48350, 0], [533400, 0.15], [Infinity, 0.20]],
  mfj: [[96700, 0], [600050, 0.15], [Infinity, 0.20]],
  hoh: [[64750, 0], [566700, 0.15], [Infinity, 0.20]],
};

// ── 2025 Short-term (ordinary income) brackets ──
const ST_BRACKETS: Record<FilingStatus, Array<[number, number]>> = {
  single: [[11925,.10],[48475,.12],[103350,.22],[197300,.24],[250525,.32],[626350,.35],[Infinity,.37]],
  mfj: [[23850,.10],[96950,.12],[206700,.22],[394600,.24],[501050,.32],[751600,.35],[Infinity,.37]],
  hoh: [[17000,.10],[64850,.12],[103350,.22],[197300,.24],[250500,.32],[626350,.35],[Infinity,.37]],
};

function calcBracketTax(income: number, brackets: Array<[number, number]>): { tax: number; rate: number } {
  let tax = 0, prev = 0, rate = 0;
  for (const [cap, r] of brackets) {
    if (income <= prev) break;
    tax += (Math.min(income, cap) - prev) * r;
    rate = r;
    prev = cap;
  }
  return { tax, rate };
}

function fmtUSD(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
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
  const PROD = 'https://sum.money/us/capital-gains-tax-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

export default function CapitalGainsTaxCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('longterm');
  const completionTracked = useRef<Record<string, boolean>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['longterm']));

  // Shared state
  const [purchasePrice, setPurchasePrice] = useState(50000);
  const [salePrice, setSalePrice] = useState(80000);
  const [filing, setFiling] = useState<FilingStatus>('single');
  const [improvements, setImprovements] = useState(0);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calculate = useCallback(() => {
    const costBasis = purchasePrice + improvements;
    const gain = Math.max(salePrice - costBasis, 0);
    const loss = salePrice - costBasis < 0;

    if (loss || gain === 0) {
      setResultLabel(loss ? 'Capital loss' : 'No gain');
      setResultPrimary(fmtUSD(Math.abs(salePrice - costBasis)));
      setResultDetails([
        { label: 'Cost basis', value: fmtUSD(costBasis) },
        { label: 'Sale price', value: fmtUSD(salePrice) },
        { label: 'Tax owed', value: '$0', green: true },
        { label: 'Net proceeds', value: fmtUSD(salePrice) },
      ]);
      return;
    }

    let tax: number, rate: number;
    if (activeTab === 'longterm') {
      const r = calcBracketTax(gain, LT_BRACKETS[filing]);
      tax = r.tax;
      rate = r.rate;
    } else {
      const r = calcBracketTax(gain, ST_BRACKETS[filing]);
      tax = r.tax;
      rate = r.rate;
    }

    const netProceeds = salePrice - tax;
    const effectiveRate = gain > 0 ? (tax / gain) * 100 : 0;

    setResultLabel('Tax owed');
    setResultPrimary(fmtUSD(tax));
    setResultDetails([
      { label: 'Capital gain', value: fmtUSD(gain) },
      { label: 'Tax rate', value: (rate * 100) + '%' },
      { label: 'Effective rate', value: effectiveRate.toFixed(1) + '%' },
      { label: 'Net proceeds', value: fmtUSD(netProceeds), green: true },
      { label: 'Cost basis', value: fmtUSD(costBasis) },
    ]);
  }, [purchasePrice, salePrice, filing, improvements, activeTab]);

  useEffect(() => {
    calculate();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [calculate, activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab') && !params.has('purchase')) return;
    const tabId = params.get('tab') as TabId;
    if (tabId && ['longterm', 'shortterm'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('purchase')) setPurchasePrice(get('purchase', 50000));
    if (params.has('sale')) setSalePrice(get('sale', 80000));
    if (params.has('filing')) setFiling(params.get('filing') as FilingStatus || 'single');
    if (params.has('improvements')) setImprovements(get('improvements', 0));
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      purchase: setPurchasePrice, sale: setSalePrice, improvements: setImprovements,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => { if (id === 'filing') setFiling(val as FilingStatus); };
  const getCurrentValues = () => ({ purchase: purchasePrice, sale: salePrice, filing, improvements });

  const switchTab = (tabId: TabId) => {
    const prev = activeTab;
    visitedTabs.current.add(tabId);
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prev, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Capital Gains Tax Calculator — sum.money', url });
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

        <div className="calc-section-label">{activeTab === 'longterm' ? 'Long-term gain (held > 1 year)' : 'Short-term gain (held ≤ 1 year)'}</div>
        <div className="inputs-grid">
          <CalcInput id="purchase" label="Purchase price" prefix="$" defaultValue={50000} value={purchasePrice} onChange={handleInput} />
          <CalcInput id="sale" label="Sale price" prefix="$" defaultValue={80000} value={salePrice} onChange={handleInput} />
          <CalcSelect id="filing" label="Filing status" options={FILING_OPTIONS} value={filing} onChange={handleSelect} />
        </div>

        <MoreOptions count={1}>
          <div className="inputs-grid">
            <CalcInput id="improvements" label="Improvements / costs" prefix="$" defaultValue={0} value={improvements} onChange={handleInput} helpText="Capital improvements that increase cost basis" />
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
        2025 federal rates. Does not include NIIT (3.8%) or state capital gains tax.
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
