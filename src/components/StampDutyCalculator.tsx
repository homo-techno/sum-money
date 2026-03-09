import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'standard' | 'first-time';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'standard', label: 'Standard', icon: '🏠' },
  { id: 'first-time', label: 'First-Time Buyer', icon: '🔑' },
];

// ── SDLT Bands (England & Northern Ireland, from 1 April 2025) ──
// Source: https://www.gov.uk/stamp-duty-land-tax/residential-property-rates
const SDLT_STANDARD: Array<[number, number]> = [
  [125000, 0],      // 0% up to £125,000
  [250000, 0.02],   // 2% £125,001–£250,000
  [925000, 0.05],   // 5% £250,001–£925,000
  [1500000, 0.10],  // 10% £925,001–£1,500,000
  [Infinity, 0.12], // 12% above £1,500,000
];

// First-time buyer relief: 0% up to £300,000, 5% up to £500,000
// Only available if purchase price ≤ £500,000
const SDLT_FTB: Array<[number, number]> = [
  [300000, 0],
  [500000, 0.05],
];

// Additional property surcharge: +5% on each band (from Oct 2024)
const ADDITIONAL_SURCHARGE = 0.05;

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

// ── Event tracking ──
function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/uk/stamp-duty-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── SDLT calculation ──
function calculateSDLT(price: number, bands: Array<[number, number]>, surcharge: number = 0): { total: number; breakdown: Array<{ band: string; rate: number; tax: number }> } {
  let total = 0;
  const breakdown: Array<{ band: string; rate: number; tax: number }> = [];
  let prev = 0;
  for (const [cap, rate] of bands) {
    if (price <= prev) break;
    const taxable = Math.min(price, cap) - prev;
    const effectiveRate = rate + surcharge;
    const tax = taxable * effectiveRate;
    total += tax;
    const bandLabel = cap === Infinity
      ? `Above ${fmtGBP(prev)}`
      : `${fmtGBP(prev + (prev === 0 ? 0 : 1))} – ${fmtGBP(cap)}`;
    if (taxable > 0) {
      breakdown.push({ band: bandLabel, rate: effectiveRate * 100, tax });
    }
    prev = cap;
  }
  return { total, breakdown };
}

export default function StampDutyCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('standard');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Standard tab
  const [stdPrice, setStdPrice] = useState(350000);
  const [stdBuyerType, setStdBuyerType] = useState('standard');

  // First-time tab
  const [ftbPrice, setFtbPrice] = useState(300000);

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [breakdown, setBreakdown] = useState<Array<{ band: string; rate: number; tax: number }>>([]);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const visitedTabs = useRef<Set<TabId>>(new Set(['standard']));

  // ── Calculation: Standard ──
  const calcStandard = useCallback(() => {
    const surcharge = stdBuyerType === 'additional' ? ADDITIONAL_SURCHARGE : 0;
    const { total, breakdown: bd } = calculateSDLT(stdPrice, SDLT_STANDARD, surcharge);
    const effectiveRate = stdPrice > 0 ? (total / stdPrice) * 100 : 0;

    setResultLabel('Stamp Duty to pay');
    setResultPrimary(fmtGBP(total));
    setBreakdown(bd);
    setResultDetails([
      { label: 'Property price', value: fmtGBP(stdPrice) },
      { label: 'Effective rate', value: effectiveRate.toFixed(1) + '%' },
      ...(stdBuyerType === 'additional' ? [{ label: 'Includes 5% surcharge', value: 'Additional property', red: true }] : []),
    ]);
  }, [stdPrice, stdBuyerType]);

  // ── Calculation: First-Time Buyer ──
  const calcFTB = useCallback(() => {
    const price = ftbPrice;
    let total: number;
    let bd: Array<{ band: string; rate: number; tax: number }>;

    if (price > 500000) {
      // No relief — standard rates apply
      const result = calculateSDLT(price, SDLT_STANDARD);
      total = result.total;
      bd = result.breakdown;
    } else {
      const result = calculateSDLT(price, SDLT_FTB);
      total = result.total;
      bd = result.breakdown;
    }

    // What would standard cost?
    const stdResult = calculateSDLT(price, SDLT_STANDARD);
    const savings = stdResult.total - total;
    const effectiveRate = price > 0 ? (total / price) * 100 : 0;

    setResultLabel('Stamp Duty to pay');
    setResultPrimary(fmtGBP(total));
    setBreakdown(bd);
    setResultDetails([
      { label: 'Property price', value: fmtGBP(price) },
      { label: 'Effective rate', value: effectiveRate.toFixed(1) + '%' },
      ...(price <= 500000 && savings > 0 ? [{ label: 'Savings vs standard', value: fmtGBP(savings), green: true }] : []),
      ...(price > 500000 ? [{ label: 'First-time relief', value: 'Not available above £500,000', red: true }] : []),
      ...(price <= 300000 ? [{ label: 'First-time relief', value: 'No stamp duty — 0% up to £300,000', green: true }] : []),
    ]);
  }, [ftbPrice]);

  useEffect(() => {
    switch (activeTab) {
      case 'standard': calcStandard(); break;
      case 'first-time': calcFTB(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcStandard, calcFTB]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['standard', 'first-time'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'standard') {
      if (params.has('price')) setStdPrice(get('price', 350000));
      if (params.has('buyerType')) setStdBuyerType(params.get('buyerType') || 'standard');
    }
    if (tabId === 'first-time') {
      if (params.has('price')) setFtbPrice(get('price', 300000));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const handleInput = (id: string, val: number) => {
    if (id === 'std-price') setStdPrice(val);
    else if (id === 'ftb-price') setFtbPrice(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'std-buyerType') setStdBuyerType(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'standard': return { price: stdPrice, buyerType: stdBuyerType };
      case 'first-time': return { price: ftbPrice };
    }
  };

  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    if (!visitedTabs.current.has(tabId)) {
      visitedTabs.current.add(tabId);
      // Transfer price between tabs on first visit
      if (tabId === 'first-time') setFtbPrice(stdPrice);
      else setStdPrice(ftbPrice);
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prevTab, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Stamp Duty Calculator — sum.money', url });
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

        {activeTab === 'standard' && (
          <div>
            <div className="calc-section-label">Property details</div>
            <div className="inputs-grid">
              <CalcInput id="std-price" label="Property price" prefix="£" defaultValue={350000} value={stdPrice} onChange={handleInput} />
              <CalcSelect id="std-buyerType" label="Buyer type" options={[
                { value: 'standard', label: 'Standard purchase' },
                { value: 'additional', label: 'Additional property (+5%)' },
              ]} value={stdBuyerType} onChange={handleSelect} />
            </div>
          </div>
        )}

        {activeTab === 'first-time' && (
          <div>
            <div className="calc-section-label">Property details</div>
            <div className="inputs-grid">
              <CalcInput id="ftb-price" label="Property price" prefix="£" defaultValue={300000} value={ftbPrice} onChange={handleInput}
                helpText="First-time buyer relief applies up to £500,000" />
            </div>
          </div>
        )}

        {/* Band breakdown */}
        {breakdown.length > 0 && (
          <div style={{ margin: '16px 0 0', padding: '12px', background: 'var(--surface-alt, #f8f8f8)', borderRadius: '8px', fontSize: '.85rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--ink-muted)' }}>Breakdown by band</div>
            {breakdown.map((b, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: i < breakdown.length - 1 ? '1px solid var(--border, #eee)' : 'none' }}>
                <span>{b.band} <span style={{ color: 'var(--ink-muted)' }}>@ {b.rate}%</span></span>
                <span style={{ fontWeight: 500 }}>{fmtGBP(b.tax)}</span>
              </div>
            ))}
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
        SDLT rates for England and Northern Ireland from 1 April 2025. Scotland (LBTT) and Wales (LTT) have different rates.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
