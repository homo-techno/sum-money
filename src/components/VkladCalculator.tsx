import { useState, useEffect, useRef, useCallback } from 'react';

type TabId = 'calc' | 'compare';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'calc', label: 'Доходность', icon: '📈' },
  { id: 'compare', label: 'Сравнить', icon: '⚖️' },
];

// Средняя ставка по вкладам топ-10 банков (Q1 2025): ~20%
const DEFAULT_RATE = 20;
// НДФЛ на проценты по вкладам 2025: необлагаемая = 1 000 000 × 21% = 210 000 ₽
const DEPOSIT_TAX_FREE = 210000;
const DEPOSIT_TAX_RATE = 0.13;

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
  const PROD = 'https://sum.money/ru/vklad-kalkulyator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// Deposit calculation
function calcDeposit(amount: number, rate: number, months: number, capitalize: boolean, monthlyAdd: number): { total: number; interest: number } {
  const r = rate / 100 / 12;
  let balance = amount;
  let totalInterest = 0;

  if (capitalize) {
    for (let m = 0; m < months; m++) {
      const interest = balance * r;
      totalInterest += interest;
      balance += interest + monthlyAdd;
    }
  } else {
    // Interest paid at end
    for (let m = 0; m < months; m++) {
      totalInterest += (balance + monthlyAdd * m) * r;
    }
    balance = amount + monthlyAdd * months + totalInterest;
  }

  return { total: balance, interest: totalInterest };
}

export default function VkladCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('calc');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Calc tab
  const [cAmount, setCAmount] = useState(500000);
  const [cRate, setCRate] = useState(DEFAULT_RATE);
  const [cTerm, setCTerm] = useState('12');
  const [cCapitalize, setCCapitalize] = useState('monthly');
  const [cMonthlyAdd, setCMonthlyAdd] = useState(0);

  // Compare tab
  const [aAmount, setAAmount] = useState(500000);
  const [aRate, setARate] = useState(20);
  const [aTerm, setATerm] = useState('12');
  const [bAmount, setBAmount] = useState(500000);
  const [bRate, setBRate] = useState(18);
  const [bTerm, setBTerm] = useState('18');

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const visitedTabs = useRef<Set<TabId>>(new Set(['calc']));

  const calcMain = useCallback(() => {
    const months = parseInt(cTerm);
    const capitalize = cCapitalize === 'monthly';
    const { total, interest } = calcDeposit(cAmount, cRate, months, capitalize, cMonthlyAdd);

    // Tax on interest
    const taxableInterest = Math.max(interest - DEPOSIT_TAX_FREE, 0);
    const tax = taxableInterest * DEPOSIT_TAX_RATE;
    const netInterest = interest - tax;

    setResultLabel('Итого к получению');
    setResultPrimary(fmtRUB(total - tax));
    setResultDetails([
      { label: 'Начисленные проценты', value: fmtRUB(interest), green: true },
      ...(tax > 0 ? [
        { label: 'НДФЛ на проценты', value: fmtRUB(tax), red: true },
        { label: 'Проценты после налога', value: fmtRUB(netInterest), green: true },
      ] : [{ label: 'НДФЛ', value: 'Не облагается (проценты < ' + fmtRUB(DEPOSIT_TAX_FREE) + ')', green: true }]),
      { label: 'Вложено', value: fmtRUB(cAmount + cMonthlyAdd * months) },
      { label: 'Капитализация', value: capitalize ? 'Ежемесячная' : 'В конце срока' },
    ]);
  }, [cAmount, cRate, cTerm, cCapitalize, cMonthlyAdd]);

  const calcCompare = useCallback(() => {
    const aMonths = parseInt(aTerm);
    const bMonths = parseInt(bTerm);
    const resA = calcDeposit(aAmount, aRate, aMonths, true, 0);
    const resB = calcDeposit(bAmount, bRate, bMonths, true, 0);

    const aWins = resA.interest > resB.interest;
    const diff = Math.abs(resA.interest - resB.interest);

    setResultLabel(aWins ? 'Вклад A выгоднее' : resA.interest === resB.interest ? 'Одинаково' : 'Вклад B выгоднее');
    setResultPrimary('на ' + fmtRUB(diff));
    setResultDetails([
      { label: 'Вклад A: проценты', value: fmtRUB(resA.interest), green: aWins },
      { label: 'Вклад A: итого', value: fmtRUB(resA.total) },
      { label: 'Вклад B: проценты', value: fmtRUB(resB.interest), green: !aWins },
      { label: 'Вклад B: итого', value: fmtRUB(resB.total) },
    ]);
  }, [aAmount, aRate, aTerm, bAmount, bRate, bTerm]);

  useEffect(() => {
    switch (activeTab) {
      case 'calc': calcMain(); break;
      case 'compare': calcCompare(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcMain, calcCompare]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['calc', 'compare'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'calc') {
      if (params.has('amount')) setCAmount(get('amount', 500000));
      if (params.has('rate')) setCRate(get('rate', DEFAULT_RATE));
      if (params.has('term')) setCTerm(params.get('term') || '12');
      if (params.has('capitalize')) setCCapitalize(params.get('capitalize') || 'monthly');
      if (params.has('add')) setCMonthlyAdd(get('add', 0));
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'c-amount': setCAmount, 'c-rate': setCRate, 'c-add': setCMonthlyAdd,
      'a-amount': setAAmount, 'a-rate': setARate, 'b-amount': setBAmount, 'b-rate': setBRate,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'c-term') setCTerm(val);
    else if (id === 'c-capitalize') setCCapitalize(val);
    else if (id === 'a-term') setATerm(val);
    else if (id === 'b-term') setBTerm(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'calc': return { amount: cAmount, rate: cRate, term: cTerm, capitalize: cCapitalize, add: cMonthlyAdd };
      case 'compare': return { aAmount, aRate, aTerm, bAmount, bRate, bTerm };
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
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Калькулятор вкладов — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Ссылка скопирована'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Результат скопирован'));
  };

  const TERM_OPTIONS = [
    { value: '3', label: '3 месяца' }, { value: '6', label: '6 месяцев' },
    { value: '12', label: '12 месяцев' }, { value: '18', label: '18 месяцев' },
    { value: '24', label: '24 месяца' },
  ];

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
        {activeTab === 'calc' && (
          <div>
            <div className="calc-section-label">Параметры вклада</div>
            <div className="inputs-grid">
              <CalcInput id="c-amount" label="Сумма вклада" prefix="₽" defaultValue={500000} value={cAmount} onChange={handleInput} />
              <CalcInput id="c-rate" label="Ставка" suffix="%" defaultValue={DEFAULT_RATE} value={cRate} onChange={handleInput} helpText="Средняя ставка топ-10 банков: ~20%" />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcSelect id="c-term" label="Срок" options={TERM_OPTIONS} value={cTerm} onChange={handleSelect} />
                <CalcSelect id="c-capitalize" label="Капитализация" options={[
                  { value: 'monthly', label: 'Ежемесячная' }, { value: 'end', label: 'В конце срока' },
                ]} value={cCapitalize} onChange={handleSelect} />
                <CalcInput id="c-add" label="Пополнение" prefix="₽" defaultValue={0} value={cMonthlyAdd} onChange={handleInput} helpText="Ежемесячное пополнение" />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'compare' && (
          <div>
            <div className="calc-section-label">Вклад A</div>
            <div className="inputs-grid">
              <CalcInput id="a-amount" label="Сумма" prefix="₽" defaultValue={500000} value={aAmount} onChange={handleInput} />
              <CalcInput id="a-rate" label="Ставка" suffix="%" defaultValue={20} value={aRate} onChange={handleInput} />
              <CalcSelect id="a-term" label="Срок" options={TERM_OPTIONS} value={aTerm} onChange={handleSelect} />
            </div>
            <div className="calc-section-label" style={{ marginTop: '16px' }}>Вклад B</div>
            <div className="inputs-grid">
              <CalcInput id="b-amount" label="Сумма" prefix="₽" defaultValue={500000} value={bAmount} onChange={handleInput} />
              <CalcInput id="b-rate" label="Ставка" suffix="%" defaultValue={18} value={bRate} onChange={handleInput} />
              <CalcSelect id="b-term" label="Срок" options={TERM_OPTIONS} value={bTerm} onChange={handleSelect} />
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
        НДФЛ на проценты по вкладам: необлагаемая сумма 210 000 ₽ (2025). Ключевая ставка ЦБ: 21%.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
