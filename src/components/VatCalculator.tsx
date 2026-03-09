import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'add' | 'remove';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'add', label: 'Add VAT', icon: '➕' },
  { id: 'remove', label: 'Remove VAT', icon: '➖' },
];

const VAT_RATES = [
  { value: '20', label: 'Standard — 20%' },
  { value: '5', label: 'Reduced — 5%' },
  { value: '0', label: 'Zero — 0%' },
];

// ── Formatting ──
function fmtGBP(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '£0';
  return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/uk/vat-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

export default function VatCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('add');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Add VAT
  const [addAmount, setAddAmount] = useState(100);
  const [addRate, setAddRate] = useState('20');

  // Remove VAT
  const [removeAmount, setRemoveAmount] = useState(120);
  const [removeRate, setRemoveRate] = useState('20');

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const visitedTabs = useRef<Set<TabId>>(new Set(['add']));

  const calcAdd = useCallback(() => {
    const rate = parseFloat(addRate) / 100;
    const vat = addAmount * rate;
    const gross = addAmount + vat;

    setResultLabel('Total including VAT');
    setResultPrimary(fmtGBP(gross));
    setResultDetails([
      { label: 'Net amount', value: fmtGBP(addAmount) },
      { label: 'VAT (' + addRate + '%)', value: fmtGBP(vat) },
      { label: 'Gross total', value: fmtGBP(gross) },
    ]);
  }, [addAmount, addRate]);

  const calcRemove = useCallback(() => {
    const rate = parseFloat(removeRate) / 100;
    const net = removeAmount / (1 + rate);
    const vat = removeAmount - net;

    setResultLabel('Amount excluding VAT');
    setResultPrimary(fmtGBP(net));
    setResultDetails([
      { label: 'Gross amount', value: fmtGBP(removeAmount) },
      { label: 'VAT (' + removeRate + '%)', value: fmtGBP(vat) },
      { label: 'Net amount', value: fmtGBP(net) },
    ]);
  }, [removeAmount, removeRate]);

  useEffect(() => {
    switch (activeTab) {
      case 'add': calcAdd(); break;
      case 'remove': calcRemove(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcAdd, calcRemove]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['add', 'remove'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'add') {
      if (params.has('amount')) setAddAmount(get('amount', 100));
      if (params.has('rate')) setAddRate(params.get('rate') || '20');
    }
    if (tabId === 'remove') {
      if (params.has('amount')) setRemoveAmount(get('amount', 120));
      if (params.has('rate')) setRemoveRate(params.get('rate') || '20');
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    if (id === 'add-amount') setAddAmount(val);
    else if (id === 'remove-amount') setRemoveAmount(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'add-rate') setAddRate(val);
    else if (id === 'remove-rate') setRemoveRate(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'add': return { amount: addAmount, rate: addRate };
      case 'remove': return { amount: removeAmount, rate: removeRate };
    }
  };

  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    if (!visitedTabs.current.has(tabId)) visitedTabs.current.add(tabId);
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prevTab, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'VAT Calculator — sum.money', url });
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
            Calculator updated since this link was created.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'add' && (
          <div>
            <div className="calc-section-label">Add VAT to an amount</div>
            <div className="inputs-grid">
              <CalcInput id="add-amount" label="Net amount" prefix="£" defaultValue={100} value={addAmount} onChange={handleInput} helpText="Amount before VAT" />
              <CalcSelect id="add-rate" label="VAT rate" options={VAT_RATES} value={addRate} onChange={handleSelect} />
            </div>
          </div>
        )}

        {activeTab === 'remove' && (
          <div>
            <div className="calc-section-label">Remove VAT from an amount</div>
            <div className="inputs-grid">
              <CalcInput id="remove-amount" label="Gross amount" prefix="£" defaultValue={120} value={removeAmount} onChange={handleInput} helpText="Amount including VAT" />
              <CalcSelect id="remove-rate" label="VAT rate" options={VAT_RATES} value={removeRate} onChange={handleSelect} />
            </div>
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
        UK VAT standard rate: 20%. Reduced rate (5%) applies to home energy, child car seats, etc.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
