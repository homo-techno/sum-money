import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'margin' | 'markup';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'margin', label: 'Margin', icon: '📊' },
  { id: 'markup', label: 'Markup', icon: '💲' },
];

// ── Geo detection ──
interface GeoConfig {
  currency: string;
  locale: string;
  symbol: string;
}

const GEO_MAP: Record<string, GeoConfig> = {
  US: { currency: 'USD', locale: 'en-US', symbol: '$' },
  DE: { currency: 'EUR', locale: 'de-DE', symbol: '€' },
  AT: { currency: 'EUR', locale: 'de-AT', symbol: '€' },
  CH: { currency: 'CHF', locale: 'de-CH', symbol: 'CHF' },
  GB: { currency: 'GBP', locale: 'en-GB', symbol: '£' },
  BR: { currency: 'BRL', locale: 'pt-BR', symbol: 'R$' },
  RU: { currency: 'RUB', locale: 'ru-RU', symbol: '₽' },
  IN: { currency: 'INR', locale: 'en-IN', symbol: '₹' },
  JP: { currency: 'JPY', locale: 'ja-JP', symbol: '¥' },
  CN: { currency: 'CNY', locale: 'zh-CN', symbol: '¥' },
  AU: { currency: 'AUD', locale: 'en-AU', symbol: 'A$' },
  CA: { currency: 'CAD', locale: 'en-CA', symbol: 'C$' },
  MX: { currency: 'MXN', locale: 'es-MX', symbol: 'MX$' },
  ES: { currency: 'EUR', locale: 'es-ES', symbol: '€' },
  FR: { currency: 'EUR', locale: 'fr-FR', symbol: '€' },
};

function getGeoConfig(): GeoConfig {
  if (typeof navigator === 'undefined') return GEO_MAP.US;
  const lang = navigator.language || 'en-US';
  const parts = lang.split('-');
  const geo = parts[1]?.toUpperCase() || '';
  return GEO_MAP[geo] || GEO_MAP.US;
}

// ── Formatting helpers ──
function fmtCurrency(n: number, locale: string, currency: string, decimals = 2): string {
  if (!isFinite(n) || isNaN(n)) return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: decimals }).format(0);
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

function formatNumber(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(1);
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
  const inputRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef(getGeoConfig());

  useEffect(() => {
    if (!focused) {
      if (prefix) {
        setDisplayValue(formatNumber(value, geoRef.current.locale));
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
          onBlur={() => setFocused(false)}
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
    </div>
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
  const PROD = 'https://sum.money/margin-calculator';
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
export default function MarginCalculator() {
  const geo = useRef(getGeoConfig());
  const [activeTab, setActiveTab] = useState<TabId>('margin');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Margin tab
  const [mCost, setMCost] = useState(45);
  const [mRevenue, setMRevenue] = useState(79);

  // Markup tab
  const [muCost, setMuCost] = useState(45);
  const [muMarkup, setMuMarkup] = useState(75.56);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const savedTabValues = useRef<Record<string, Record<string, number>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['margin']));

  const { locale, currency, symbol } = geo.current;
  const fmt = useCallback((n: number, dec = 2) => fmtCurrency(n, locale, currency, dec), [locale, currency]);

  const calcMargin = useCallback(() => {
    const profit = mRevenue - mCost;
    const margin = mRevenue > 0 ? (profit / mRevenue) * 100 : 0;
    const markup = mCost > 0 ? (profit / mCost) * 100 : 0;
    setResultLabel('Profit margin');
    setResultPrimary(`${margin.toFixed(1)}%`);
    setResultDetails([
      { label: 'Profit', value: fmt(profit), green: profit > 0 },
      { label: 'Markup', value: `${markup.toFixed(1)}%` },
      { label: 'Cost', value: fmt(mCost) },
      { label: 'Revenue', value: fmt(mRevenue) },
    ]);
  }, [mCost, mRevenue, fmt]);

  const calcMarkup = useCallback(() => {
    const sellingPrice = muCost * (1 + muMarkup / 100);
    const profit = sellingPrice - muCost;
    const margin = sellingPrice > 0 ? (profit / sellingPrice) * 100 : 0;
    setResultLabel('Selling price');
    setResultPrimary(fmt(sellingPrice));
    setResultDetails([
      { label: 'Profit', value: fmt(profit), green: profit > 0 },
      { label: 'Profit margin', value: `${margin.toFixed(1)}%` },
      { label: 'Cost', value: fmt(muCost) },
      { label: 'Markup', value: `${muMarkup.toFixed(1)}%` },
    ]);
  }, [muCost, muMarkup, fmt]);

  useEffect(() => {
    if (activeTab === 'margin') calcMargin();
    else calcMarkup();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcMargin, calcMarkup]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;

    const tabId = params.get('tab') as TabId;
    if (['margin', 'markup'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }

    const get = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null ? parseFloat(v) || fallback : fallback;
    };

    if (tabId === 'margin' || !tabId) {
      if (params.has('cost')) setMCost(get('cost', 45));
      if (params.has('revenue')) setMRevenue(get('revenue', 79));
    }
    if (tabId === 'markup') {
      if (params.has('cost')) setMuCost(get('cost', 45));
      if (params.has('markupPct')) setMuMarkup(get('markupPct', 75.56));
    }

    const urlVersion = params.get('v');
    const updatedAt = '2026-03-09';
    if (urlVersion && urlVersion < updatedAt) {
      setShowVersionBanner(true);
    }
  }, []);

  const saveCurrentTabValues = useCallback(() => {
    if (activeTab === 'margin') {
      savedTabValues.current['margin'] = { cost: mCost, revenue: mRevenue };
    } else {
      savedTabValues.current['markup'] = { cost: muCost, markupPct: muMarkup };
    }
  }, [activeTab, mCost, mRevenue, muCost, muMarkup]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const saved = savedTabValues.current[tabId];
    if (!saved) return;
    if (tabId === 'margin') {
      setMCost(saved.cost);
      setMRevenue(saved.revenue);
    } else {
      setMuCost(saved.cost);
      setMuMarkup(saved.markupPct);
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'm-cost': setMCost, 'm-revenue': setMRevenue,
      'mu-cost': setMuCost, 'mu-markup': setMuMarkup,
    };
    setters[id]?.(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    if (activeTab === 'margin') return { cost: mCost, revenue: mRevenue };
    return { cost: muCost, markupPct: muMarkup };
  };

  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    saveCurrentTabValues();
    if (visitedTabs.current.has(tabId)) {
      restoreTabValues(tabId);
    } else {
      visitedTabs.current.add(tabId);
      if (tabId === 'markup') {
        setMuCost(mCost);
        const mu = mCost > 0 ? ((mRevenue - mCost) / mCost) * 100 : 0;
        setMuMarkup(parseFloat(mu.toFixed(2)));
      } else {
        setMCost(muCost);
        setMRevenue(muCost * (1 + muMarkup / 100));
      }
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prevTab, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setShowFeedback(true);
    setTimeout(() => setShowFeedback(false), 2200);
  };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) {
      navigator.share({ title: 'Profit Margin Calculator — sum.money', url });
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

      <div className="calc-card animate-in delay-4">
        {showVersionBanner && (
          <div style={{
            background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px',
            padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            Calculator updated since this link was created.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'margin' && (
          <div>
            <div className="calc-section-label">Revenue & cost</div>
            <div className="inputs-grid">
              <CalcInput id="m-cost" label="Cost" prefix={symbol} defaultValue={45} value={mCost} onChange={handleInput} helpText="What you pay for the product" />
              <CalcInput id="m-revenue" label="Revenue" prefix={symbol} defaultValue={79} value={mRevenue} onChange={handleInput} helpText="What the customer pays" />
            </div>
          </div>
        )}

        {activeTab === 'markup' && (
          <div>
            <div className="calc-section-label">Cost & markup</div>
            <div className="inputs-grid">
              <CalcInput id="mu-cost" label="Cost" prefix={symbol} defaultValue={45} value={muCost} onChange={handleInput} helpText="What you pay for the product" />
              <CalcInput id="mu-markup" label="Markup" suffix="%" defaultValue={75.56} value={muMarkup} onChange={handleInput} helpText="How much to add on top of cost" />
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
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
