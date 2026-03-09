import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'payment' | 'afford' | 'prepay';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'payment', label: 'Рассчитать платёж', icon: '🏠' },
  { id: 'afford', label: 'Сколько могу взять', icon: '💰' },
  { id: 'prepay', label: 'Досрочное погашение', icon: '⚡' },
];

// Ключевая ставка ЦБ РФ: 15,5% (февраль 2026). Средняя рыночная ипотека: ~20-21%
const DEFAULT_RATE = 20;

// ── Formatting (ru-RU) ──
function fmtRUB(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '0 ₽';
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}
function formatCurrency(v: number): string { return v.toLocaleString('ru-RU'); }
function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Soft warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  price: { min: 500000, max: 500000000, msgLow: 'Очень низкая стоимость.', msgHigh: 'Необычно высокая стоимость.' },
  income: { min: 10000, max: 10000000, msgLow: 'Очень низкий доход.', msgHigh: 'Необычно высокий доход.' },
  balance: { min: 100000, max: 500000000, msgLow: 'Очень маленький остаток.', msgHigh: 'Необычно большой остаток.' },
};

function SoftWarning({ fieldId, value }: { fieldId: string; value: number }) {
  const rule = SOFT_WARNINGS[fieldId];
  if (!rule) return null;
  let msg = '';
  if (value > 0 && value < rule.min && rule.msgLow) msg = rule.msgLow;
  else if (value > rule.max && rule.msgHigh) msg = rule.msgHigh;
  if (!msg) return null;
  return (
    <div style={{ fontSize: '.78rem', color: '#b8860b', background: '#fef9ec', border: '1px solid #f0e6c8', borderRadius: '4px', padding: '6px 10px', marginTop: '4px', lineHeight: 1.4 }}>{msg}</div>
  );
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
  const PROD = 'https://sum.money/ru/ipoteka-kalkulyator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Annuity formula ──
function annuityPayment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  if (annualRate <= 0) return principal / (years * 12);
  const r = annualRate / 100 / 12;
  const n = years * 12;
  return principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

// Differentiated payment (first month — max)
function diffPaymentFirst(principal: number, annualRate: number, years: number): number {
  if (principal <= 0 || years <= 0) return 0;
  const n = years * 12;
  const bodyPart = principal / n;
  const interestPart = principal * (annualRate / 100 / 12);
  return bodyPart + interestPart;
}

// Total interest for differentiated
function diffTotalInterest(principal: number, annualRate: number, years: number): number {
  const n = years * 12;
  const r = annualRate / 100 / 12;
  const body = principal / n;
  let total = 0;
  let remaining = principal;
  for (let i = 0; i < n; i++) {
    total += remaining * r;
    remaining -= body;
  }
  return total;
}

export default function IpotekaCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('payment');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Payment tab
  const [pmPrice, setPmPrice] = useState(8000000);
  const [pmDown, setPmDown] = useState(1600000);
  const [pmRate, setPmRate] = useState(DEFAULT_RATE);
  const [pmTerm, setPmTerm] = useState('20');
  const [pmType, setPmType] = useState('annuity');

  // Afford tab
  const [afIncome, setAfIncome] = useState(150000);
  const [afDebts, setAfDebts] = useState(0);
  const [afRate, setAfRate] = useState(DEFAULT_RATE);
  const [afTerm, setAfTerm] = useState('20');
  const [afDown, setAfDown] = useState(1000000);

  // Prepay tab
  const [ppBalance, setPpBalance] = useState(5000000);
  const [ppExtra, setPpExtra] = useState(20000);
  const [ppRate, setPpRate] = useState(DEFAULT_RATE);
  const [ppRemaining, setPpRemaining] = useState(15);

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const savedTabValues = useRef<Record<string, Record<string, number | string>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['payment']));

  const calcPayment = useCallback(() => {
    const principal = pmPrice - pmDown;
    const term = parseInt(pmTerm);
    if (principal <= 0) {
      setResultLabel('Ежемесячный платёж');
      setResultPrimary('0 ₽');
      setResultDetails([]);
      return;
    }

    if (pmType === 'annuity') {
      const payment = annuityPayment(principal, pmRate, term);
      const totalPaid = payment * term * 12;
      const overpayment = totalPaid - principal;
      setResultLabel('Ежемесячный платёж');
      setResultPrimary(fmtRUB(payment));
      setResultDetails([
        { label: 'Сумма кредита', value: fmtRUB(principal) },
        { label: 'Переплата', value: fmtRUB(overpayment), red: true },
        { label: 'Общая сумма выплат', value: fmtRUB(totalPaid) },
        { label: 'Первоначальный взнос', value: fmtRUB(pmDown) + ' (' + Math.round(pmDown / pmPrice * 100) + '%)' },
      ]);
    } else {
      const firstPayment = diffPaymentFirst(principal, pmRate, term);
      const totalInterest = diffTotalInterest(principal, pmRate, term);
      const totalPaid = principal + totalInterest;
      const lastPayment = principal / (term * 12) + (principal / (term * 12)) * (pmRate / 100 / 12);
      setResultLabel('Первый платёж (макс.)');
      setResultPrimary(fmtRUB(firstPayment));
      setResultDetails([
        { label: 'Последний платёж (мин.)', value: fmtRUB(principal / (term * 12) * (1 + pmRate / 100 / 12)) },
        { label: 'Сумма кредита', value: fmtRUB(principal) },
        { label: 'Переплата', value: fmtRUB(totalInterest), red: true },
        { label: 'Общая сумма выплат', value: fmtRUB(totalPaid) },
      ]);
    }
  }, [pmPrice, pmDown, pmRate, pmTerm, pmType]);

  const calcAfford = useCallback(() => {
    const income = afIncome;
    const debts = afDebts;
    const term = parseInt(afTerm);
    // Max payment: 50% of income minus debts
    const maxPayment = income * 0.5 - debts;
    if (maxPayment <= 0) {
      setResultLabel('Максимальная сумма кредита');
      setResultPrimary('0 ₽');
      setResultDetails([{ label: 'Ошибка', value: 'Платежи по кредитам превышают 50% дохода', red: true }]);
      return;
    }
    // Reverse annuity: P = M × [(1+r)^n - 1] / [r × (1+r)^n]
    const r = afRate / 100 / 12;
    const n = term * 12;
    let maxLoan: number;
    if (r <= 0) {
      maxLoan = maxPayment * n;
    } else {
      maxLoan = maxPayment * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n));
    }
    const maxPrice = maxLoan + afDown;
    const payment = annuityPayment(maxLoan, afRate, term);

    setResultLabel('Максимальная стоимость квартиры');
    setResultPrimary(fmtRUB(maxPrice));
    setResultDetails([
      { label: 'Максимальный кредит', value: fmtRUB(maxLoan) },
      { label: 'Первоначальный взнос', value: fmtRUB(afDown) },
      { label: 'Ежемесячный платёж', value: fmtRUB(payment) },
      { label: 'Доля от дохода', value: Math.round(payment / income * 100) + '%' },
    ]);
  }, [afIncome, afDebts, afRate, afTerm, afDown]);

  const calcPrepay = useCallback(() => {
    const balance = ppBalance;
    const rate = ppRate / 100 / 12;
    const normalPayment = annuityPayment(balance, ppRate, ppRemaining);
    const totalPayment = normalPayment + ppExtra;

    // Simulate with overpayment
    let bal = balance;
    let monthsWithPrepay = 0;
    let totalInterestPrepay = 0;
    while (bal > 0 && monthsWithPrepay < ppRemaining * 12) {
      const interest = bal * rate;
      totalInterestPrepay += interest;
      const principal = totalPayment - interest;
      if (principal <= 0) break;
      bal -= principal;
      monthsWithPrepay++;
      if (bal <= 0) break;
    }

    const normalTotalInterest = normalPayment * ppRemaining * 12 - balance;
    const interestSaved = normalTotalInterest - totalInterestPrepay;
    const timeSavedMonths = ppRemaining * 12 - monthsWithPrepay;
    const yrs = Math.floor(timeSavedMonths / 12);
    const mos = timeSavedMonths % 12;
    let timeSavedStr = '';
    if (yrs > 0) timeSavedStr += yrs + ' г. ';
    timeSavedStr += mos + ' мес.';

    const newYrs = Math.floor(monthsWithPrepay / 12);
    const newMos = monthsWithPrepay % 12;

    setResultLabel('Экономия на процентах');
    setResultPrimary(fmtRUB(interestSaved));
    setResultDetails([
      { label: 'Сокращение срока', value: timeSavedStr, green: true },
      { label: 'Новый срок', value: newYrs + ' г. ' + newMos + ' мес.' },
      { label: 'Проценты без досрочного', value: fmtRUB(normalTotalInterest) },
      { label: 'Проценты с досрочным', value: fmtRUB(totalInterestPrepay), green: true },
      { label: 'Платёж с доплатой', value: fmtRUB(totalPayment) + '/мес.' },
    ]);
  }, [ppBalance, ppExtra, ppRate, ppRemaining]);

  useEffect(() => {
    switch (activeTab) {
      case 'payment': calcPayment(); break;
      case 'afford': calcAfford(); break;
      case 'prepay': calcPrepay(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcPayment, calcAfford, calcPrepay]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['payment', 'afford', 'prepay'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'payment') {
      if (params.has('price')) setPmPrice(get('price', 8000000));
      if (params.has('down')) setPmDown(get('down', 1600000));
      if (params.has('rate')) setPmRate(get('rate', DEFAULT_RATE));
      if (params.has('term')) setPmTerm(params.get('term') || '20');
      if (params.has('type')) setPmType(params.get('type') || 'annuity');
    }
    if (tabId === 'afford') {
      if (params.has('income')) setAfIncome(get('income', 150000));
      if (params.has('debts')) setAfDebts(get('debts', 0));
      if (params.has('rate')) setAfRate(get('rate', DEFAULT_RATE));
      if (params.has('term')) setAfTerm(params.get('term') || '20');
      if (params.has('down')) setAfDown(get('down', 1000000));
    }
    if (tabId === 'prepay') {
      if (params.has('balance')) setPpBalance(get('balance', 5000000));
      if (params.has('extra')) setPpExtra(get('extra', 20000));
      if (params.has('rate')) setPpRate(get('rate', DEFAULT_RATE));
      if (params.has('remaining')) setPpRemaining(get('remaining', 15));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'payment': savedTabValues.current['payment'] = { price: pmPrice, down: pmDown, rate: pmRate, term: pmTerm, type: pmType }; break;
      case 'afford': savedTabValues.current['afford'] = { income: afIncome, debts: afDebts, rate: afRate, term: afTerm, down: afDown }; break;
      case 'prepay': savedTabValues.current['prepay'] = { balance: ppBalance, extra: ppExtra, rate: ppRate, remaining: ppRemaining }; break;
    }
  }, [activeTab, pmPrice, pmDown, pmRate, pmTerm, pmType, afIncome, afDebts, afRate, afTerm, afDown, ppBalance, ppExtra, ppRate, ppRemaining]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const s = savedTabValues.current[tabId];
    if (!s) return;
    switch (tabId) {
      case 'payment': setPmPrice(s.price as number); setPmDown(s.down as number); setPmRate(s.rate as number); setPmTerm(s.term as string); setPmType(s.type as string); break;
      case 'afford': setAfIncome(s.income as number); setAfDebts(s.debts as number); setAfRate(s.rate as number); setAfTerm(s.term as string); setAfDown(s.down as number); break;
      case 'prepay': setPpBalance(s.balance as number); setPpExtra(s.extra as number); setPpRate(s.rate as number); setPpRemaining(s.remaining as number); break;
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'pm-price': setPmPrice, 'pm-down': setPmDown, 'pm-rate': setPmRate,
      'af-income': setAfIncome, 'af-debts': setAfDebts, 'af-rate': setAfRate, 'af-down': setAfDown,
      'pp-balance': setPpBalance, 'pp-extra': setPpExtra, 'pp-rate': setPpRate, 'pp-remaining': setPpRemaining,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'pm-term') setPmTerm(val);
    else if (id === 'pm-type') setPmType(val);
    else if (id === 'af-term') setAfTerm(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'payment': return { price: pmPrice, down: pmDown, rate: pmRate, term: pmTerm, type: pmType };
      case 'afford': return { income: afIncome, debts: afDebts, rate: afRate, term: afTerm, down: afDown };
      case 'prepay': return { balance: ppBalance, extra: ppExtra, rate: ppRate, remaining: ppRemaining };
    }
  };

  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    saveCurrentTabValues();
    if (visitedTabs.current.has(tabId)) restoreTabValues(tabId);
    else visitedTabs.current.add(tabId);
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prevTab, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Ипотечный калькулятор — sum.money', url });
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
            Калькулятор обновлён с момента создания ссылки. Ваши данные сохранены, но результат отражает актуальные параметры.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'payment' && (
          <div>
            <div className="calc-section-label">Параметры кредита</div>
            <div className="inputs-grid">
              <CalcInput id="pm-price" label="Стоимость квартиры" prefix="₽" defaultValue={8000000} value={pmPrice} onChange={handleInput} />
              <CalcInput id="pm-down" label="Первоначальный взнос" prefix="₽" defaultValue={1600000} value={pmDown} onChange={handleInput} helpText={pmPrice > 0 ? Math.round(pmDown / pmPrice * 100) + '% от стоимости' : ''} />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="pm-rate" label="Ставка" suffix="%" defaultValue={DEFAULT_RATE} value={pmRate} onChange={handleInput} helpText="Ключевая ставка ЦБ 15,5% + маржа банка" />
                <CalcInput id="pm-term" label="Срок" suffix="лет" defaultValue={20} value={parseInt(pmTerm) || 20} onChange={(id, val) => setPmTerm(String(Math.max(1, Math.min(30, Math.round(val)))))} />
                <CalcSelect id="pm-type" label="Тип платежа" options={[
                  { value: 'annuity', label: 'Аннуитетный' },
                  { value: 'diff', label: 'Дифференцированный' },
                ]} value={pmType} onChange={handleSelect} />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'afford' && (
          <div>
            <div className="calc-section-label">Ваши доходы</div>
            <div className="inputs-grid">
              <CalcInput id="af-income" label="Ежемесячный доход" prefix="₽" defaultValue={150000} value={afIncome} onChange={handleInput} helpText="Чистый доход на руки" />
              <CalcInput id="af-debts" label="Платежи по кредитам" prefix="₽" defaultValue={0} value={afDebts} onChange={handleInput} helpText="Все текущие ежемесячные платежи" />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="af-rate" label="Ставка" suffix="%" defaultValue={DEFAULT_RATE} value={afRate} onChange={handleInput} />
                <CalcInput id="af-term" label="Срок" suffix="лет" defaultValue={20} value={parseInt(afTerm) || 20} onChange={(id, val) => setAfTerm(String(Math.max(1, Math.min(30, Math.round(val)))))} />
                <CalcInput id="af-down" label="Первоначальный взнос" prefix="₽" defaultValue={1000000} value={afDown} onChange={handleInput} />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'prepay' && (
          <div>
            <div className="calc-section-label">Досрочное погашение</div>
            <div className="inputs-grid">
              <CalcInput id="pp-balance" label="Остаток кредита" prefix="₽" defaultValue={5000000} value={ppBalance} onChange={handleInput} />
              <CalcInput id="pp-extra" label="Доплата в месяц" prefix="₽" defaultValue={20000} value={ppExtra} onChange={handleInput} helpText="Сумма сверх обязательного платежа" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="pp-rate" label="Ставка" suffix="%" defaultValue={DEFAULT_RATE} value={ppRate} onChange={handleInput} />
                <CalcInput id="pp-remaining" label="Оставшийся срок" suffix="лет" defaultValue={15} value={ppRemaining} onChange={handleInput} />
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
        Ключевая ставка ЦБ РФ: 15,5% (февраль 2026). Актуальную ставку уточняйте на cbr.ru
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
