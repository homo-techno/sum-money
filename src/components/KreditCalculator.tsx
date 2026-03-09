import { useState, useEffect, useRef, useCallback } from 'react';

// Средняя ставка по потребительским кредитам (2025): ~22-28%
const DEFAULT_RATE = 24;

function fmtRUB(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '0 ₽';
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}
function formatCurrency(v: number): string { return v.toLocaleString('ru-RU'); }
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
        <span className="arrow">▼</span> Ещё параметры ({count})
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

function buildShareURL(values: Record<string, number | string>) {
  const PROD = 'https://sum.money/ru/kredit-kalkulyator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

function annuityPayment(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  if (annualRate <= 0) return principal / months;
  const r = annualRate / 100 / 12;
  return principal * (r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
}

function diffTotalInterest(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 100 / 12;
  const body = principal / months;
  let total = 0;
  let remaining = principal;
  for (let i = 0; i < months; i++) {
    total += remaining * r;
    remaining -= body;
  }
  return total;
}

export default function KreditCalculator() {
  const completionTracked = useRef(false);

  const [amount, setAmount] = useState(500000);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [term, setTerm] = useState('36');
  const [type, setType] = useState('annuity');

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calculate = useCallback(() => {
    const months = parseInt(term);
    if (type === 'annuity') {
      const payment = annuityPayment(amount, rate, months);
      const totalPaid = payment * months;
      const overpayment = totalPaid - amount;
      const effectiveRate = amount > 0 ? (overpayment / amount * 100) : 0;
      setResultLabel('Ежемесячный платёж');
      setResultPrimary(fmtRUB(payment));
      setResultDetails([
        { label: 'Переплата', value: fmtRUB(overpayment), red: true },
        { label: 'Общая сумма выплат', value: fmtRUB(totalPaid) },
        { label: 'Переплата %', value: effectiveRate.toFixed(1) + '% от суммы кредита' },
        { label: 'Тип платежа', value: 'Аннуитетный' },
      ]);
    } else {
      const firstPayment = amount / months + amount * (rate / 100 / 12);
      const totalInterest = diffTotalInterest(amount, rate, months);
      const totalPaid = amount + totalInterest;
      const lastPayment = amount / months + (amount / months) * (rate / 100 / 12);
      setResultLabel('Первый платёж (макс.)');
      setResultPrimary(fmtRUB(firstPayment));
      setResultDetails([
        { label: 'Последний платёж', value: fmtRUB(lastPayment) },
        { label: 'Переплата', value: fmtRUB(totalInterest), red: true },
        { label: 'Общая сумма выплат', value: fmtRUB(totalPaid) },
        { label: 'Тип платежа', value: 'Дифференцированный' },
      ]);
    }
    if (!completionTracked.current) {
      completionTracked.current = true;
      trackEvent('calc_complete', { variant: type });
    }
  }, [amount, rate, term, type]);

  useEffect(() => { calculate(); }, [calculate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('amount')) setAmount(get('amount', 500000));
    if (params.has('rate')) setRate(get('rate', DEFAULT_RATE));
    if (params.has('term')) setTerm(params.get('term') || '36');
    if (params.has('type')) setType(params.get('type') || 'annuity');
  }, []);

  const handleInput = (id: string, val: number) => {
    if (id === 'k-amount') setAmount(val);
    else if (id === 'k-rate') setRate(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'k-term') setTerm(val);
    else if (id === 'k-type') setType(val);
  };

  const getCurrentValues = () => ({ amount, rate, term, type });

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Кредитный калькулятор — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Ссылка скопирована'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Результат скопирован'));
  };

  return (
    <>
      <div className="calc-card animate-in delay-3">
        <div className="calc-section-label">Параметры кредита</div>
        <div className="inputs-grid">
          <CalcInput id="k-amount" label="Сумма кредита" prefix="₽" defaultValue={500000} value={amount} onChange={handleInput} />
          <CalcInput id="k-rate" label="Ставка" suffix="%" defaultValue={DEFAULT_RATE} value={rate} onChange={handleInput} />
        </div>
        <MoreOptions count={2}>
          <div className="inputs-grid">
            <CalcSelect id="k-term" label="Срок" options={[
              { value: '12', label: '12 месяцев' }, { value: '24', label: '24 месяца' },
              { value: '36', label: '36 месяцев' }, { value: '48', label: '48 месяцев' },
              { value: '60', label: '60 месяцев' },
            ]} value={term} onChange={handleSelect} />
            <CalcSelect id="k-type" label="Тип платежа" options={[
              { value: 'annuity', label: 'Аннуитетный' }, { value: 'diff', label: 'Дифференцированный' },
            ]} value={type} onChange={handleSelect} />
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
              Поделиться
            </button>
            <button className="btn btn-ghost" onClick={handleCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Скопировать
            </button>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '.78rem', color: 'var(--ink-muted)', fontStyle: 'italic' }}>
        Средняя ставка по потребительским кредитам: ~24% (2025). Расчёт приблизительный.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
