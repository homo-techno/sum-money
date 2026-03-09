import { useState, useEffect, useRef, useCallback } from 'react';

// Средняя ставка по потребительским кредитам (2025): ~22-28%
const DEFAULT_RATE = 24;

type TabId = 'calc' | 'prepay';

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

function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/ru/kredit-kalkulyator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
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
  const completionTracked = useRef<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<TabId>('calc');
  const visitedTabs = useRef<Set<TabId>>(new Set(['calc']));

  // Calc tab
  const [amount, setAmount] = useState(500000);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [term, setTerm] = useState(36);
  const [type, setType] = useState('annuity');

  // Prepay tab
  const [ppBalance, setPpBalance] = useState(300000);
  const [ppExtra, setPpExtra] = useState(10000);
  const [ppRate, setPpRate] = useState(DEFAULT_RATE);
  const [ppRemaining, setPpRemaining] = useState(24);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const calcMain = useCallback(() => {
    const months = term;
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
      setResultLabel('Первый платёж (макс.)');
      setResultPrimary(fmtRUB(firstPayment));
      setResultDetails([
        { label: 'Последний платёж', value: fmtRUB(amount / months + (amount / months) * (rate / 100 / 12)) },
        { label: 'Переплата', value: fmtRUB(totalInterest), red: true },
        { label: 'Общая сумма выплат', value: fmtRUB(totalPaid) },
        { label: 'Тип платежа', value: 'Дифференцированный' },
      ]);
    }
  }, [amount, rate, term, type]);

  const calcPrepay = useCallback(() => {
    const balance = ppBalance;
    const r = ppRate / 100 / 12;
    const normalPayment = annuityPayment(balance, ppRate, ppRemaining);
    const totalPayment = normalPayment + ppExtra;

    // Simulate with overpayment
    let bal = balance;
    let monthsWithPrepay = 0;
    let totalInterestPrepay = 0;
    while (bal > 0 && monthsWithPrepay < ppRemaining) {
      const interest = bal * r;
      totalInterestPrepay += interest;
      const principal = totalPayment - interest;
      if (principal <= 0) break;
      bal -= principal;
      monthsWithPrepay++;
      if (bal <= 0) break;
    }

    const normalTotalInterest = normalPayment * ppRemaining - balance;
    const interestSaved = normalTotalInterest - totalInterestPrepay;
    const timeSavedMonths = ppRemaining - monthsWithPrepay;

    let timeSavedStr = '';
    const yrs = Math.floor(timeSavedMonths / 12);
    const mos = timeSavedMonths % 12;
    if (yrs > 0) timeSavedStr += yrs + ' г. ';
    timeSavedStr += mos + ' мес.';

    setResultLabel('Экономия на процентах');
    setResultPrimary(fmtRUB(interestSaved));
    setResultDetails([
      { label: 'Сокращение срока', value: timeSavedStr, green: true },
      { label: 'Новый срок', value: monthsWithPrepay + ' мес.' },
      { label: 'Проценты без досрочного', value: fmtRUB(normalTotalInterest) },
      { label: 'Проценты с досрочным', value: fmtRUB(totalInterestPrepay), green: true },
      { label: 'Платёж с доплатой', value: fmtRUB(totalPayment) + '/мес.' },
    ]);
  }, [ppBalance, ppExtra, ppRate, ppRemaining]);

  useEffect(() => {
    switch (activeTab) {
      case 'calc': calcMain(); break;
      case 'prepay': calcPrepay(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab });
    }
  }, [activeTab, calcMain, calcPrepay]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('tab')) {
      const t = params.get('tab') as TabId;
      if (['calc', 'prepay'].includes(t)) { setActiveTab(t); visitedTabs.current.add(t); }
    }
    if (params.has('amount')) setAmount(get('amount', 500000));
    if (params.has('rate')) setRate(get('rate', DEFAULT_RATE));
    if (params.has('term')) setTerm(get('term', 36));
    if (params.has('type')) setType(params.get('type') || 'annuity');
    if (params.has('balance')) setPpBalance(get('balance', 300000));
    if (params.has('extra')) setPpExtra(get('extra', 10000));
    if (params.has('ppRate')) setPpRate(get('ppRate', DEFAULT_RATE));
    if (params.has('remaining')) setPpRemaining(get('remaining', 24));
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'k-amount': setAmount, 'k-rate': setRate, 'k-term': (v) => setTerm(Math.max(3, Math.min(84, Math.round(v)))),
      'pp-balance': setPpBalance, 'pp-extra': setPpExtra, 'pp-rate': setPpRate,
      'pp-remaining': (v) => setPpRemaining(Math.max(1, Math.min(84, Math.round(v)))),
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'k-type') setType(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'calc': return { amount, rate, term, type };
      case 'prepay': return { balance: ppBalance, extra: ppExtra, ppRate, remaining: ppRemaining };
    }
  };

  const switchTab = (tabId: TabId) => {
    if (!visitedTabs.current.has(tabId)) visitedTabs.current.add(tabId);
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: activeTab, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Кредитный калькулятор — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Ссылка скопирована'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Результат скопирован'));
  };

  return (
    <>
      <div className="tabs animate-in delay-3" role="tablist">
        <button role="tab" aria-selected={activeTab === 'calc'} className={activeTab === 'calc' ? 'active' : ''} onClick={() => switchTab('calc')}>
          <span className="tab-icon">💳</span> Рассчитать платёж
        </button>
        <button role="tab" aria-selected={activeTab === 'prepay'} className={activeTab === 'prepay' ? 'active' : ''} onClick={() => switchTab('prepay')}>
          <span className="tab-icon">⚡</span> Досрочное погашение
        </button>
      </div>

      <div className="calc-card animate-in delay-4">
        {activeTab === 'calc' && (
          <div>
            <div className="calc-section-label">Параметры кредита</div>
            <div className="inputs-grid">
              <CalcInput id="k-amount" label="Сумма кредита" prefix="₽" defaultValue={500000} value={amount} onChange={handleInput} />
              <CalcInput id="k-rate" label="Ставка" suffix="%" defaultValue={DEFAULT_RATE} value={rate} onChange={handleInput} />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="k-term" label="Срок" suffix="мес." defaultValue={36} value={term} onChange={handleInput} helpText="От 3 до 84 месяцев" />
                <CalcSelect id="k-type" label="Тип платежа" options={[
                  { value: 'annuity', label: 'Аннуитетный' }, { value: 'diff', label: 'Дифференцированный' },
                ]} value={type} onChange={handleSelect} />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'prepay' && (
          <div>
            <div className="calc-section-label">Досрочное погашение</div>
            <div className="inputs-grid">
              <CalcInput id="pp-balance" label="Остаток долга" prefix="₽" defaultValue={300000} value={ppBalance} onChange={handleInput} />
              <CalcInput id="pp-extra" label="Доплата в месяц" prefix="₽" defaultValue={10000} value={ppExtra} onChange={handleInput} helpText="Сумма сверх обязательного платежа" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="pp-rate" label="Ставка" suffix="%" defaultValue={DEFAULT_RATE} value={ppRate} onChange={handleInput} />
                <CalcInput id="pp-remaining" label="Оставшийся срок" suffix="мес." defaultValue={24} value={ppRemaining} onChange={handleInput} helpText="Сколько месяцев осталось платить" />
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
        Средняя ставка по потребительским кредитам: ~22-28%. Расчёт приблизительный.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
