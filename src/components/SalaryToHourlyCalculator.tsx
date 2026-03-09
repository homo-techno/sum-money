import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'convert' | 'compare';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'convert', label: 'Convert', icon: '🔄' },
  { id: 'compare', label: 'Compare Offers', icon: '⚖️' },
];

const WEEKS_OPTIONS = [
  { value: '48', label: '48 weeks' },
  { value: '50', label: '50 weeks' },
  { value: '52', label: '52 weeks' },
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

// ── Soft warning rules ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  salary: { min: 1000, max: 10000000, msgLow: 'This salary seems very low. Did you mean annual salary?', msgHigh: 'Unusually high salary. Double-check the value.' },
  hours: { min: 1, max: 80, msgLow: '', msgHigh: 'Working more than 80 hours/week is unusual. Double-check.' },
  'a-salary': { min: 1000, max: 10000000, msgLow: 'Very low salary.', msgHigh: 'Unusually high salary.' },
  'b-salary': { min: 1000, max: 10000000, msgLow: 'Very low salary.', msgHigh: 'Unusually high salary.' },
  'a-hours': { min: 1, max: 80, msgLow: '', msgHigh: 'Over 80 hours/week is unusual.' },
  'b-hours': { min: 1, max: 80, msgLow: '', msgHigh: 'Over 80 hours/week is unusual.' },
  vacation: { min: 0, max: 60, msgLow: '', msgHigh: 'More than 60 vacation days is unusual.' },
};

// ── Formatting helpers ──
function fmtCurrency(n: number, locale: string, currency: string, decimals = 0): string {
  if (!isFinite(n) || isNaN(n)) return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: decimals }).format(0);
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

function formatNumber(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
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

// ── Compact input for Compare tab ──
function CompactInput({
  id, prefix, suffix, value, onChange, ariaLabel,
}: {
  id: string;
  prefix?: string;
  suffix?: string;
  value: number;
  onChange: (id: string, val: number) => void;
  ariaLabel: string;
}) {
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const geoRef = useRef(getGeoConfig());

  const displayValue = prefix
    ? formatNumber(value, geoRef.current.locale)
    : formatRate(value);

  return (
    <div className="input-group">
      <div className="input-wrapper">
        {prefix && <span className="input-prefix">{prefix}</span>}
        <input
          ref={inputRef}
          type="text"
          id={id}
          aria-label={ariaLabel}
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
  const PROD = 'https://sum.money/salary-to-hourly-converter';
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
export default function SalaryToHourlyCalculator() {
  const geo = useRef(getGeoConfig());
  const [activeTab, setActiveTab] = useState<TabId>('convert');
  const completionTracked = useRef<Record<string, boolean>>({});

  // ── State: Convert ──
  const [cSalary, setCSalary] = useState(75000);
  const [cHours, setCHours] = useState(40);
  const [cWeeks, setCWeeks] = useState('52');
  const [cVacation, setCVacation] = useState(0);

  // ── State: Compare ──
  const [aOSalary, setAOSalary] = useState(75000);
  const [aOHours, setAOHours] = useState(40);
  const [bOSalary, setBOSalary] = useState(85000);
  const [bOHours, setBOHours] = useState(45);
  const [compWeeks, setCompWeeks] = useState('52');

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
  const visitedTabs = useRef<Set<TabId>>(new Set(['convert']));

  const { locale, currency, symbol } = geo.current;
  const fmt = useCallback((n: number, dec = 0) => fmtCurrency(n, locale, currency, dec), [locale, currency]);

  // ── Calculation: Convert ──
  const calcConvert = useCallback(() => {
    const weeks = parseInt(cWeeks);
    const vacationWeeks = cVacation * 5 > 0 ? cVacation / 5 : 0; // vacation days to weeks
    const effectiveWeeks = Math.max(weeks - vacationWeeks, 1);
    const totalHours = cHours * effectiveWeeks;
    const hourly = totalHours > 0 ? cSalary / totalHours : 0;
    const monthly = cSalary / 12;
    const biweekly = cSalary / (weeks / 2);
    const daily = cHours > 0 ? hourly * (cHours / 5) : 0;

    setResultLabel('Your hourly rate');
    setResultPrimary(fmt(hourly, 2) + '/hr');
    setResultDetails([
      { label: 'Monthly', value: fmt(monthly) },
      { label: 'Biweekly', value: fmt(biweekly) },
      { label: 'Daily', value: fmt(daily, 2) },
    ]);
  }, [cSalary, cHours, cWeeks, cVacation, fmt]);

  // ── Calculation: Compare ──
  const calcCompare = useCallback(() => {
    const weeks = parseInt(compWeeks);
    const hourlyA = aOSalary / (aOHours * weeks);
    const hourlyB = bOSalary / (bOHours * weeks);
    const diff = hourlyA - hourlyB;
    const winner = diff >= 0 ? 'A' : 'B';
    const absDiff = Math.abs(diff);

    setResultLabel('Offer A vs Offer B');
    setResultPrimary(`Offer ${winner} pays ${fmt(absDiff, 2)}/hr more`);
    setResultDetails([
      { label: 'Offer A', value: `${fmt(hourlyA, 2)}/hr (${fmt(aOSalary)}/yr)` },
      { label: 'Offer B', value: `${fmt(hourlyB, 2)}/hr (${fmt(bOSalary)}/yr)` },
      { label: 'Difference', value: `${fmt(absDiff, 2)}/hr`, green: diff >= 0, red: diff < 0 },
    ]);
  }, [aOSalary, aOHours, bOSalary, bOHours, compWeeks, fmt]);

  // ── Recalculate on input change ──
  useEffect(() => {
    switch (activeTab) {
      case 'convert': calcConvert(); break;
      case 'compare': calcCompare(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcConvert, calcCompare]);

  // ── Load from URL on mount ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;

    const tabId = params.get('tab') as TabId;
    if (['convert', 'compare'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }

    const get = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null ? parseFloat(v) || fallback : fallback;
    };
    const getStr = (key: string, fallback: string) => params.get(key) || fallback;

    if (tabId === 'convert' || !tabId) {
      if (params.has('salary')) setCSalary(get('salary', 75000));
      if (params.has('hours')) setCHours(get('hours', 40));
      if (params.has('weeks')) setCWeeks(getStr('weeks', '52'));
      if (params.has('vacation')) setCVacation(get('vacation', 0));
    }
    if (tabId === 'compare') {
      if (params.has('a-salary')) setAOSalary(get('a-salary', 75000));
      if (params.has('a-hours')) setAOHours(get('a-hours', 40));
      if (params.has('b-salary')) setBOSalary(get('b-salary', 85000));
      if (params.has('b-hours')) setBOHours(get('b-hours', 45));
      if (params.has('weeks')) setCompWeeks(getStr('weeks', '52'));
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
      case 'convert':
        savedTabValues.current['convert'] = { salary: cSalary, hours: cHours, weeks: cWeeks, vacation: cVacation };
        break;
      case 'compare':
        savedTabValues.current['compare'] = {
          'a-salary': aOSalary, 'a-hours': aOHours,
          'b-salary': bOSalary, 'b-hours': bOHours,
          weeks: compWeeks,
        };
        break;
    }
  }, [activeTab, cSalary, cHours, cWeeks, cVacation, aOSalary, aOHours, bOSalary, bOHours, compWeeks]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const saved = savedTabValues.current[tabId];
    if (!saved) return;
    switch (tabId) {
      case 'convert':
        setCSalary(saved.salary as number);
        setCHours(saved.hours as number);
        setCWeeks(saved.weeks as string);
        setCVacation(saved.vacation as number);
        break;
      case 'compare':
        setAOSalary(saved['a-salary'] as number);
        setAOHours(saved['a-hours'] as number);
        setBOSalary(saved['b-salary'] as number);
        setBOHours(saved['b-hours'] as number);
        setCompWeeks(saved.weeks as string);
        break;
    }
  }, []);

  // ── Input handlers ──
  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'c-salary': setCSalary, 'c-hours': setCHours, 'c-vacation': setCVacation,
      'co-a-salary': setAOSalary, 'co-a-hours': setAOHours,
      'co-b-salary': setBOSalary, 'co-b-hours': setBOHours,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    const setters: Record<string, (v: string) => void> = {
      'c-weeks': setCWeeks, 'co-weeks': setCompWeeks,
    };
    setters[id]?.(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'convert':
        return { salary: cSalary, hours: cHours, weeks: cWeeks, vacation: cVacation };
      case 'compare':
        return { 'a-salary': aOSalary, 'a-hours': aOHours, 'b-salary': bOSalary, 'b-hours': bOHours, weeks: compWeeks };
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
      if (tabId === 'compare') {
        setAOSalary(cSalary);
        setAOHours(cHours);
        setCompWeeks(cWeeks);
        // Offer B defaults
        setBOSalary(85000);
        setBOHours(45);
      } else if (tabId === 'convert') {
        setCSalary(aOSalary);
        setCHours(aOHours);
        setCWeeks(compWeeks);
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
      navigator.share({ title: 'Salary to Hourly Calculator — sum.money', url });
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

        {/* CONVERT */}
        {activeTab === 'convert' && (
          <div>
            <div className="calc-section-label">Your salary</div>
            <div className="inputs-grid">
              <CalcInput id="c-salary" label="Annual salary" prefix={symbol} defaultValue={75000} value={cSalary} onChange={handleInput} />
              <CalcInput id="c-hours" label="Hours per week" suffix="hrs" defaultValue={40} value={cHours} onChange={handleInput} />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcSelect id="c-weeks" label="Weeks per year" options={WEEKS_OPTIONS} value={cWeeks} onChange={handleSelect} />
                <CalcInput id="c-vacation" label="Paid vacation days" suffix="days" defaultValue={0} value={cVacation} onChange={handleInput} helpText="Reduces working weeks, increases effective hourly rate" />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* COMPARE OFFERS */}
        {activeTab === 'compare' && (
          <div>
            <div className="calc-section-label">Your offers</div>
            <div className="compare-row">
              <span className="row-label">Offer A</span>
              <CompactInput id="co-a-salary" prefix={symbol} value={aOSalary} onChange={handleInput} ariaLabel="Offer A annual salary" />
              <CompactInput id="co-a-hours" suffix="hrs/wk" value={aOHours} onChange={handleInput} ariaLabel="Offer A hours per week" />
            </div>
            <div className="compare-row">
              <span className="row-label">Offer B</span>
              <CompactInput id="co-b-salary" prefix={symbol} value={bOSalary} onChange={handleInput} ariaLabel="Offer B annual salary" />
              <CompactInput id="co-b-hours" suffix="hrs/wk" value={bOHours} onChange={handleInput} ariaLabel="Offer B hours per week" />
            </div>
            <MoreOptions count={1}>
              <div className="inputs-grid">
                <CalcSelect id="co-weeks" label="Weeks per year" options={WEEKS_OPTIONS} value={compWeeks} onChange={handleSelect} />
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

      {/* Copy feedback toast */}
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
