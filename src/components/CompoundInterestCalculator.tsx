import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'growth' | 'goal' | 'compare';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'growth', label: 'Investment Growth', icon: '📈' },
  { id: 'goal', label: 'Savings Goal', icon: '🎯' },
  { id: 'compare', label: 'Compare', icon: '⚖️' },
];

const COMPOUND_OPTIONS = [
  { value: '365', label: 'Daily' },
  { value: '12', label: 'Monthly' },
  { value: '4', label: 'Quarterly' },
  { value: '1', label: 'Annually' },
];

const YEAR_OPTIONS = [
  { value: '1', label: '1 year' },
  { value: '2', label: '2 years' },
  { value: '3', label: '3 years' },
  { value: '5', label: '5 years' },
  { value: '10', label: '10 years' },
  { value: '15', label: '15 years' },
  { value: '20', label: '20 years' },
  { value: '25', label: '25 years' },
  { value: '30', label: '30 years' },
];

// ── Geo detection ──
interface GeoConfig {
  currency: string;
  locale: string;
  symbol: string;
  rate: number;
}

const GEO_MAP: Record<string, GeoConfig> = {
  US: { currency: 'USD', locale: 'en-US', symbol: '$', rate: 7 },
  DE: { currency: 'EUR', locale: 'de-DE', symbol: '€', rate: 5 },
  AT: { currency: 'EUR', locale: 'de-AT', symbol: '€', rate: 5 },
  CH: { currency: 'CHF', locale: 'de-CH', symbol: 'CHF', rate: 4 },
  GB: { currency: 'GBP', locale: 'en-GB', symbol: '£', rate: 6 },
  BR: { currency: 'BRL', locale: 'pt-BR', symbol: 'R$', rate: 10 },
  RU: { currency: 'RUB', locale: 'ru-RU', symbol: '₽', rate: 12 },
  IN: { currency: 'INR', locale: 'en-IN', symbol: '₹', rate: 8 },
  JP: { currency: 'JPY', locale: 'ja-JP', symbol: '¥', rate: 3 },
  CN: { currency: 'CNY', locale: 'zh-CN', symbol: '¥', rate: 4 },
  AU: { currency: 'AUD', locale: 'en-AU', symbol: 'A$', rate: 6 },
  CA: { currency: 'CAD', locale: 'en-CA', symbol: 'C$', rate: 6 },
  MX: { currency: 'MXN', locale: 'es-MX', symbol: 'MX$', rate: 9 },
  ES: { currency: 'EUR', locale: 'es-ES', symbol: '€', rate: 5 },
  FR: { currency: 'EUR', locale: 'fr-FR', symbol: '€', rate: 5 },
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
  initial: { min: 0, max: 10000000, msgLow: '', msgHigh: 'Unusually large initial deposit. Double-check the value.' },
  monthly: { min: 0, max: 50000, msgLow: '', msgHigh: 'Unusually large monthly contribution. Double-check the value.' },
  rate: { min: 0.1, max: 50, msgLow: 'This rate is unusually low.', msgHigh: 'Returns above 50% are extremely unusual. Double-check the value.' },
  target: { min: 100, max: 100000000, msgLow: 'Very small savings goal.', msgHigh: 'Unusually large target. Double-check the value.' },
  'a-initial': { min: 0, max: 10000000, msgLow: '', msgHigh: 'Unusually large deposit.' },
  'b-initial': { min: 0, max: 10000000, msgLow: '', msgHigh: 'Unusually large deposit.' },
  'a-rate': { min: 0.1, max: 50, msgLow: 'Unusually low rate.', msgHigh: 'Returns above 50% are extremely unusual.' },
  'b-rate': { min: 0.1, max: 50, msgLow: 'Unusually low rate.', msgHigh: 'Returns above 50% are extremely unusual.' },
};

// ── Formatting helpers ──
function fmtCurrency(n: number, locale: string, currency: string): string {
  if (!isFinite(n) || isNaN(n)) return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(0);
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(Math.round(n));
}

function formatNumber(v: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(v);
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Compound interest formulas ──
function futureValue(principal: number, monthlyContrib: number, annualRate: number, compoundsPerYear: number, years: number): number {
  if (years <= 0) return principal;
  const r = annualRate / 100;
  if (r === 0) return principal + monthlyContrib * 12 * years;

  const n = compoundsPerYear;
  const t = years;

  // FV of principal
  const fvPrincipal = principal * Math.pow(1 + r / n, n * t);

  // FV of series (monthly contributions adjusted to compounding period)
  const monthlyRate = Math.pow(1 + r / n, n / 12) - 1;
  const totalMonths = years * 12;
  const fvContributions = monthlyContrib * (Math.pow(1 + monthlyRate, totalMonths) - 1) / monthlyRate;

  return fvPrincipal + (monthlyContrib > 0 ? fvContributions : 0);
}

function requiredMonthly(target: number, principal: number, annualRate: number, compoundsPerYear: number, years: number): number {
  if (years <= 0) return 0;
  const r = annualRate / 100;

  if (r === 0) {
    const totalMonths = years * 12;
    return totalMonths > 0 ? (target - principal) / totalMonths : 0;
  }

  const n = compoundsPerYear;
  const t = years;

  const fvPrincipal = principal * Math.pow(1 + r / n, n * t);
  const remaining = target - fvPrincipal;
  if (remaining <= 0) return 0;

  const monthlyRate = Math.pow(1 + r / n, n / 12) - 1;
  const totalMonths = years * 12;
  const factor = (Math.pow(1 + monthlyRate, totalMonths) - 1) / monthlyRate;

  return remaining / factor;
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

// ── Compact select for Compare tab ──
function CompactSelect({
  id, options, value, onChange, ariaLabel,
}: {
  id: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (id: string, val: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="input-group">
      <div className="input-wrapper">
        <select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(id, e.target.value)}>
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
  const PROD = 'https://sum.money/compound-interest-calculator';
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
export default function CompoundInterestCalculator() {
  const geo = useRef(getGeoConfig());
  const [activeTab, setActiveTab] = useState<TabId>('growth');
  const completionTracked = useRef<Record<string, boolean>>({});

  // ── State: Investment Growth ──
  const [gInitial, setGInitial] = useState(10000);
  const [gMonthly, setGMonthly] = useState(200);
  const [gRate, setGRate] = useState(geo.current.rate);
  const [gCompound, setGCompound] = useState('12');
  const [gYears, setGYears] = useState('10');

  // ── State: Savings Goal ──
  const [sTarget, setSTarget] = useState(50000);
  const [sYears, setSYears] = useState('5');
  const [sInitial, setSInitial] = useState(0);
  const [sRate, setSRate] = useState(Math.min(geo.current.rate, 5));
  const [sCompound, setSCompound] = useState('12');

  // ── State: Compare ──
  const [cAInitial, setCAInitial] = useState(10000);
  const [cARate, setCARate] = useState(geo.current.rate);
  const [cAYears, setCAYears] = useState('20');
  const [cBInitial, setCBInitial] = useState(10000);
  const [cBRate, setCBRate] = useState(Math.max(geo.current.rate - 2, 1));
  const [cBYears, setCBYears] = useState('20');
  const [cMonthly, setCMonthly] = useState(200);
  const [cCompound, setCCompound] = useState('12');

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
  const visitedTabs = useRef<Set<TabId>>(new Set(['growth']));

  const { locale, currency, symbol } = geo.current;
  const fmt = useCallback((n: number) => fmtCurrency(n, locale, currency), [locale, currency]);

  // ── Calculation: Growth ──
  const calcGrowth = useCallback(() => {
    const n = parseInt(gCompound);
    const years = parseInt(gYears);
    const fv = futureValue(gInitial, gMonthly, gRate, n, years);
    const totalContributed = gInitial + gMonthly * 12 * years;
    const interestEarned = fv - totalContributed;

    setResultLabel('Your investment grows to');
    setResultPrimary(fmt(fv));
    setResultDetails([
      { label: 'Total contributed', value: fmt(totalContributed) },
      { label: 'Interest earned', value: fmt(Math.max(0, interestEarned)), green: true },
    ]);
  }, [gInitial, gMonthly, gRate, gCompound, gYears, fmt]);

  // ── Calculation: Goal ──
  const calcGoal = useCallback(() => {
    const n = parseInt(sCompound);
    const years = parseInt(sYears);
    const pmt = requiredMonthly(sTarget, sInitial, sRate, n, years);
    const totalDeposited = sInitial + pmt * 12 * years;
    const interestEarned = sTarget - totalDeposited;

    setResultLabel('To reach your goal, save');
    setResultPrimary(fmt(pmt) + '/mo');
    setResultDetails([
      { label: 'Total deposited', value: fmt(totalDeposited) },
      { label: 'Interest earned', value: fmt(Math.max(0, interestEarned)), green: true },
      { label: 'Final balance', value: fmt(sTarget) },
    ]);
  }, [sTarget, sYears, sInitial, sRate, sCompound, fmt]);

  // ── Calculation: Compare ──
  const calcCompare = useCallback(() => {
    const n = parseInt(cCompound);
    const fvA = futureValue(cAInitial, cMonthly, cARate, n, parseInt(cAYears));
    const fvB = futureValue(cBInitial, cMonthly, cBRate, n, parseInt(cBYears));
    const diff = fvA - fvB;
    const winner = diff >= 0 ? 'A' : 'B';
    const absDiff = Math.abs(diff);

    setResultLabel('Option A vs Option B');
    setResultPrimary(`Option ${winner} earns ${fmt(absDiff)} more`);
    setResultDetails([
      { label: 'Option A total', value: fmt(fvA) },
      { label: 'Option B total', value: fmt(fvB) },
      { label: 'Difference', value: fmt(absDiff), green: diff >= 0, red: diff < 0 },
    ]);
  }, [cAInitial, cARate, cAYears, cBInitial, cBRate, cBYears, cMonthly, cCompound, fmt]);

  // ── Recalculate on input change ──
  useEffect(() => {
    switch (activeTab) {
      case 'growth': calcGrowth(); break;
      case 'goal': calcGoal(); break;
      case 'compare': calcCompare(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcGrowth, calcGoal, calcCompare]);

  // ── Load from URL on mount ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;

    const tabId = params.get('tab') as TabId;
    if (['growth', 'goal', 'compare'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }

    const get = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null ? parseFloat(v) || fallback : fallback;
    };
    const getStr = (key: string, fallback: string) => params.get(key) || fallback;

    if (tabId === 'growth' || !tabId) {
      if (params.has('initial')) setGInitial(get('initial', 10000));
      if (params.has('monthly')) setGMonthly(get('monthly', 200));
      if (params.has('rate')) setGRate(get('rate', geo.current.rate));
      if (params.has('compound')) setGCompound(getStr('compound', '12'));
      if (params.has('years')) setGYears(getStr('years', '10'));
    }
    if (tabId === 'goal') {
      if (params.has('target')) setSTarget(get('target', 50000));
      if (params.has('years')) setSYears(getStr('years', '5'));
      if (params.has('initial')) setSInitial(get('initial', 0));
      if (params.has('rate')) setSRate(get('rate', 5));
      if (params.has('compound')) setSCompound(getStr('compound', '12'));
    }
    if (tabId === 'compare') {
      if (params.has('a-initial')) setCAInitial(get('a-initial', 10000));
      if (params.has('a-rate')) setCARate(get('a-rate', geo.current.rate));
      if (params.has('a-years')) setCAYears(getStr('a-years', '20'));
      if (params.has('b-initial')) setCBInitial(get('b-initial', 10000));
      if (params.has('b-rate')) setCBRate(get('b-rate', 5));
      if (params.has('b-years')) setCBYears(getStr('b-years', '20'));
      if (params.has('monthly')) setCMonthly(get('monthly', 200));
      if (params.has('compound')) setCCompound(getStr('compound', '12'));
    }

    const urlVersion = params.get('v');
    const updatedAt = '2026-03-08';
    if (urlVersion && urlVersion < updatedAt) {
      setShowVersionBanner(true);
    }
  }, []);

  // ── Save current tab values ──
  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'growth':
        savedTabValues.current['growth'] = { initial: gInitial, monthly: gMonthly, rate: gRate, compound: gCompound, years: gYears };
        break;
      case 'goal':
        savedTabValues.current['goal'] = { target: sTarget, years: sYears, initial: sInitial, rate: sRate, compound: sCompound };
        break;
      case 'compare':
        savedTabValues.current['compare'] = {
          'a-initial': cAInitial, 'a-rate': cARate, 'a-years': cAYears,
          'b-initial': cBInitial, 'b-rate': cBRate, 'b-years': cBYears,
          monthly: cMonthly, compound: cCompound,
        };
        break;
    }
  }, [activeTab, gInitial, gMonthly, gRate, gCompound, gYears, sTarget, sYears, sInitial, sRate, sCompound, cAInitial, cARate, cAYears, cBInitial, cBRate, cBYears, cMonthly, cCompound]);

  // ── Restore tab values ──
  const restoreTabValues = useCallback((tabId: TabId) => {
    const saved = savedTabValues.current[tabId];
    if (!saved) return;

    switch (tabId) {
      case 'growth':
        setGInitial(saved.initial as number);
        setGMonthly(saved.monthly as number);
        setGRate(saved.rate as number);
        setGCompound(saved.compound as string);
        setGYears(saved.years as string);
        break;
      case 'goal':
        setSTarget(saved.target as number);
        setSYears(saved.years as string);
        setSInitial(saved.initial as number);
        setSRate(saved.rate as number);
        setSCompound(saved.compound as string);
        break;
      case 'compare':
        setCAInitial(saved['a-initial'] as number);
        setCARate(saved['a-rate'] as number);
        setCAYears(saved['a-years'] as string);
        setCBInitial(saved['b-initial'] as number);
        setCBRate(saved['b-rate'] as number);
        setCBYears(saved['b-years'] as string);
        setCMonthly(saved.monthly as number);
        setCCompound(saved.compound as string);
        break;
    }
  }, []);

  // ── Get shared field values from current tab ──
  const getSharedFields = useCallback((): { initial: number; rate: number; monthly: number; years: string; compound: string } => {
    switch (activeTab) {
      case 'growth':
        return { initial: gInitial, rate: gRate, monthly: gMonthly, years: gYears, compound: gCompound };
      case 'goal':
        return { initial: sInitial, rate: sRate, monthly: 0, years: sYears, compound: sCompound };
      case 'compare':
        return { initial: cAInitial, rate: cARate, monthly: cMonthly, years: cAYears, compound: cCompound };
    }
  }, [activeTab, gInitial, gRate, gMonthly, gYears, gCompound, sInitial, sRate, sYears, sCompound, cAInitial, cARate, cMonthly, cAYears, cCompound]);

  // ── Input change handlers ──
  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'g-initial': setGInitial, 'g-monthly': setGMonthly, 'g-rate': setGRate,
      's-target': setSTarget, 's-initial': setSInitial, 's-rate': setSRate,
      'c-a-initial': setCAInitial, 'c-a-rate': setCARate,
      'c-b-initial': setCBInitial, 'c-b-rate': setCBRate,
      'c-monthly': setCMonthly,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    const setters: Record<string, (v: string) => void> = {
      'g-compound': setGCompound, 'g-years': setGYears,
      's-years': setSYears, 's-compound': setSCompound,
      'c-a-years': setCAYears, 'c-b-years': setCBYears,
      'c-compound': setCCompound,
    };
    setters[id]?.(val);
  };

  // ── Get current values for share URL ──
  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'growth':
        return { initial: gInitial, monthly: gMonthly, rate: gRate, compound: gCompound, years: gYears };
      case 'goal':
        return { target: sTarget, years: sYears, initial: sInitial, rate: sRate, compound: sCompound };
      case 'compare':
        return {
          'a-initial': cAInitial, 'a-rate': cARate, 'a-years': cAYears,
          'b-initial': cBInitial, 'b-rate': cBRate, 'b-years': cBYears,
          monthly: cMonthly, compound: cCompound,
        };
    }
  };

  // ── Tab switch with field transfer ──
  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    saveCurrentTabValues();

    if (visitedTabs.current.has(tabId)) {
      // Returning to previously visited tab — restore saved values
      restoreTabValues(tabId);
    } else {
      // First visit — transfer shared fields
      const shared = getSharedFields();
      visitedTabs.current.add(tabId);

      switch (tabId) {
        case 'growth':
          setGInitial(shared.initial);
          setGRate(shared.rate);
          setGMonthly(shared.monthly);
          setGYears(shared.years);
          setGCompound(shared.compound);
          break;
        case 'goal':
          setSInitial(shared.initial);
          setSRate(shared.rate);
          setSYears(shared.years);
          setSCompound(shared.compound);
          break;
        case 'compare':
          // Option A inherits from previous tab, Option B stays default
          setCAInitial(shared.initial);
          setCARate(shared.rate);
          setCAYears(shared.years);
          setCMonthly(shared.monthly);
          setCCompound(shared.compound);
          // Option B: same initial, lower rate, same years
          setCBInitial(shared.initial);
          setCBRate(Math.max(shared.rate - 2, 1));
          setCBYears(shared.years);
          break;
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
      navigator.share({ title: 'Compound Interest Calculator — sum.money', url });
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
            Calculator updated since this link was created. Your inputs are preserved, but the result reflects current rates.
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }}
              onClick={() => setShowVersionBanner(false)}
            >
              ×
            </button>
          </div>
        )}

        {/* INVESTMENT GROWTH */}
        {activeTab === 'growth' && (
          <div>
            <div className="calc-section-label">Your investment</div>
            <div className="inputs-grid">
              <CalcInput id="g-initial" label="Initial deposit" prefix={symbol} defaultValue={10000} value={gInitial} onChange={handleInput} />
              <CalcInput id="g-monthly" label="Monthly contribution" prefix={symbol} defaultValue={200} value={gMonthly} onChange={handleInput} />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="g-rate" label="Annual interest rate" suffix="%" defaultValue={geo.current.rate} value={gRate} onChange={handleInput} />
                <CalcSelect id="g-compound" label="Compounding" options={COMPOUND_OPTIONS} value={gCompound} onChange={handleSelect} />
                <CalcSelect id="g-years" label="Time period" options={YEAR_OPTIONS} value={gYears} onChange={handleSelect} />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* SAVINGS GOAL */}
        {activeTab === 'goal' && (
          <div>
            <div className="calc-section-label">Your goal</div>
            <div className="inputs-grid">
              <CalcInput id="s-target" label="Target amount" prefix={symbol} defaultValue={50000} value={sTarget} onChange={handleInput} />
              <CalcSelect id="s-years" label="Years to reach goal" options={YEAR_OPTIONS} value={sYears} onChange={handleSelect} />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="s-initial" label="Starting balance" prefix={symbol} defaultValue={0} value={sInitial} onChange={handleInput} />
                <CalcInput id="s-rate" label="Annual interest rate" suffix="%" defaultValue={5} value={sRate} onChange={handleInput} />
                <CalcSelect id="s-compound" label="Compounding" options={COMPOUND_OPTIONS} value={sCompound} onChange={handleSelect} />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* COMPARE */}
        {activeTab === 'compare' && (
          <div>
            <div className="calc-section-label">Your options</div>
            <div className="compare-row">
              <span className="row-label">Option A</span>
              <CompactInput id="c-a-initial" prefix={symbol} value={cAInitial} onChange={handleInput} ariaLabel="Option A initial deposit" />
              <CompactInput id="c-a-rate" suffix="%" value={cARate} onChange={handleInput} ariaLabel="Option A annual rate" />
              <CompactSelect id="c-a-years" options={YEAR_OPTIONS} value={cAYears} onChange={handleSelect} ariaLabel="Option A time period" />
            </div>
            <div className="compare-row">
              <span className="row-label">Option B</span>
              <CompactInput id="c-b-initial" prefix={symbol} value={cBInitial} onChange={handleInput} ariaLabel="Option B initial deposit" />
              <CompactInput id="c-b-rate" suffix="%" value={cBRate} onChange={handleInput} ariaLabel="Option B annual rate" />
              <CompactSelect id="c-b-years" options={YEAR_OPTIONS} value={cBYears} onChange={handleSelect} ariaLabel="Option B time period" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="c-monthly" label="Monthly contribution" prefix={symbol} defaultValue={200} value={cMonthly} onChange={handleInput} helpText="Applied to both options" />
                <CalcSelect id="c-compound" label="Compounding" options={COMPOUND_OPTIONS} value={cCompound} onChange={handleSelect} />
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
