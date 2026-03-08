import { useState, useEffect, useRef, useCallback } from 'react';

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

// ── Soft warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  amount: { min: 100, max: 100000000, msgLow: 'Very small loan amount.', msgHigh: 'Unusually large loan amount. Double-check.' },
  rate: { min: 0.1, max: 30, msgLow: '', msgHigh: 'Interest rate above 30% is unusually high.' },
};

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
function buildShareURL(values: Record<string, number | string>) {
  const PROD = 'https://sum.money/loan-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname
    : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) {
    params.set(key, String(val));
  }
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Loan term options ──
const TERM_OPTIONS = [
  { value: '1', label: '1 year' },
  { value: '2', label: '2 years' },
  { value: '3', label: '3 years' },
  { value: '4', label: '4 years' },
  { value: '5', label: '5 years' },
  { value: '7', label: '7 years' },
  { value: '10', label: '10 years' },
  { value: '15', label: '15 years' },
  { value: '20', label: '20 years' },
  { value: '25', label: '25 years' },
  { value: '30', label: '30 years' },
];

const FREQUENCY_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'biweekly', label: 'Biweekly' },
];

// ── Main Calculator Component ──
export default function LoanCalculator() {
  const geo = useRef(getGeoConfig());
  const completionTracked = useRef(false);

  // ── State ──
  const [amount, setAmount] = useState(25000);
  const [rate, setRate] = useState(6);
  const [term, setTerm] = useState('5');
  const [frequency, setFrequency] = useState('monthly');

  // ── Result state ──
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string }>>([]);

  // ── Version banner ──
  const [showVersionBanner, setShowVersionBanner] = useState(false);

  // ── Copy feedback ──
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const { locale, currency, symbol } = geo.current;
  const fmt = useCallback((n: number, dec = 0) => fmtCurrency(n, locale, currency, dec), [locale, currency]);

  // ── Calculation ──
  const calculate = useCallback(() => {
    const years = parseInt(term);
    const isMonthly = frequency === 'monthly';
    const periodsPerYear = isMonthly ? 12 : 26;
    const totalPeriods = isMonthly ? years * 12 : years * 26;
    const periodRate = rate / 100 / periodsPerYear;

    let payment: number;
    if (periodRate === 0) {
      payment = amount / totalPeriods;
    } else {
      // M = P[r(1+r)^n]/[(1+r)^n-1]
      const factor = Math.pow(1 + periodRate, totalPeriods);
      payment = amount * (periodRate * factor) / (factor - 1);
    }

    const totalPaid = payment * totalPeriods;
    const totalInterest = totalPaid - amount;

    // Payoff date
    const now = new Date();
    const payoffDate = new Date(now);
    if (isMonthly) {
      payoffDate.setMonth(payoffDate.getMonth() + totalPeriods);
    } else {
      payoffDate.setDate(payoffDate.getDate() + totalPeriods * 14);
    }
    const payoffStr = payoffDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

    const periodLabel = isMonthly ? 'monthly' : 'biweekly';
    setResultLabel(`Your ${periodLabel} payment`);
    setResultPrimary(fmt(payment, 2));
    setResultDetails([
      { label: 'Total interest', value: fmt(totalInterest) },
      { label: 'Total paid', value: fmt(totalPaid) },
      { label: 'Payoff date', value: payoffStr },
    ]);
  }, [amount, rate, term, frequency, fmt, locale]);

  // ── Recalculate on input change ──
  useEffect(() => {
    calculate();
    if (!completionTracked.current) {
      completionTracked.current = true;
      trackEvent('calc_complete', { variant: 'loan' });
    }
  }, [calculate]);

  // ── Load from URL on mount ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('amount') && !params.has('rate')) return;

    const get = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null ? parseFloat(v) || fallback : fallback;
    };
    const getStr = (key: string, fallback: string) => params.get(key) || fallback;

    if (params.has('amount')) setAmount(get('amount', 25000));
    if (params.has('rate')) setRate(get('rate', 6));
    if (params.has('term')) setTerm(getStr('term', '5'));
    if (params.has('freq')) setFrequency(getStr('freq', 'monthly'));

    const urlVersion = params.get('v');
    const updatedAt = '2026-03-08';
    if (urlVersion && urlVersion < updatedAt) {
      setShowVersionBanner(true);
    }
  }, []);

  // ── Input handlers ──
  const handleInput = (id: string, val: number) => {
    if (id === 'l-amount') setAmount(val);
    else if (id === 'l-rate') setRate(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'l-term') setTerm(val);
    else if (id === 'l-freq') setFrequency(val);
  };

  const getCurrentValues = (): Record<string, number | string> => ({
    amount, rate, term, freq: frequency,
  });

  // ── Share / Copy ──
  const doShowFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setShowFeedback(true);
    setTimeout(() => setShowFeedback(false), 2200);
  };

  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) {
      navigator.share({ title: 'Loan Calculator — sum.money', url });
    } else {
      navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
    }
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Result copied'));
  };

  return (
    <>
      {/* NO TABS — control group */}
      <div className="calc-card animate-in delay-3">

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

        <div className="calc-section-label">Loan details</div>
        <div className="inputs-grid">
          <CalcInput id="l-amount" label="Loan amount" prefix={symbol} defaultValue={25000} value={amount} onChange={handleInput} />
          <CalcInput id="l-rate" label="Interest rate" suffix="%" defaultValue={6} value={rate} onChange={handleInput} />
        </div>

        <MoreOptions count={2}>
          <div className="inputs-grid">
            <CalcSelect id="l-term" label="Loan term" options={TERM_OPTIONS} value={term} onChange={handleSelect} />
            <CalcSelect id="l-freq" label="Payment frequency" options={FREQUENCY_OPTIONS} value={frequency} onChange={handleSelect} />
          </div>
        </MoreOptions>

        {/* RESULT */}
        <div className="result-card">
          <div className="result-label">{resultLabel}</div>
          <div className="result-primary">{resultPrimary}</div>
          <div className="result-details">
            {resultDetails.map((d, i) => (
              <div key={i} className="result-detail">
                <span className="result-detail-label">{d.label}</span>
                <span className="result-detail-value">{d.value}</span>
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
