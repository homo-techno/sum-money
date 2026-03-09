import { useState, useEffect, useRef, useCallback } from 'react';

function fmtRUB(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '0 ₽';
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}
function formatCurrency(v: number): string { return v.toLocaleString('ru-RU'); }

function CalcInput({ id, label, prefix, suffix, defaultValue, helpText, value, onChange }: {
  id: string; label: string; prefix?: string; suffix?: string; defaultValue: number; helpText?: string;
  value: number; onChange: (id: string, val: number) => void;
}) {
  const [displayValue, setDisplayValue] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focused) setDisplayValue(prefix ? formatCurrency(value) : String(value));
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

function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

function buildShareURL(values: Record<string, number | string>) {
  const PROD = 'https://sum.money/ru/usn-kalkulyator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// УСН 2025 ставки
const USN_DOHODY_RATE = 0.06;
const USN_DOHODY_RASHODY_RATE = 0.15;
const MIN_TAX_RATE = 0.01; // минимальный налог 1% от доходов (для ДР)

// Повышенные ставки при доходе > 60M (до 450M)
const USN_DOHODY_HIGH = 0.08;
const USN_DOHODY_RASHODY_HIGH = 0.20;
const HIGH_THRESHOLD = 60_000_000;

// Страховые взносы ИП 2025
const IP_FIXED = 53_658;         // фиксированные взносы
const IP_EXTRA_RATE = 0.01;      // 1% сверх 300 000
const IP_EXTRA_THRESHOLD = 300_000;
const IP_MAX_EXTRA = 354_546;    // максимум общих взносов

type Tab = 'dohody' | 'dohody-rashody';

export default function UsnCalculator() {
  const completionTracked = useRef(false);

  const [activeTab, setActiveTab] = useState<Tab>('dohody');
  const [savedValues, setSavedValues] = useState<Record<string, Record<string, number>>>({});
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set(['dohody']));

  // Доходы
  const [income, setIncome] = useState(3_000_000);
  // Доходы минус расходы
  const [expenses, setExpenses] = useState(1_500_000);
  // Общее
  const [isIp, setIsIp] = useState(true);
  const [employees, setEmployees] = useState(0);
  const [quarters, setQuarters] = useState(4); // кол-во кварталов работы

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const switchTab = (tab: Tab) => {
    const currentVals = activeTab === 'dohody'
      ? { income, expenses, isIp: isIp ? 1 : 0, employees, quarters }
      : { income, expenses, isIp: isIp ? 1 : 0, employees, quarters };
    setSavedValues(prev => ({ ...prev, [activeTab]: currentVals }));

    if (savedValues[tab]) {
      const v = savedValues[tab];
      setIncome(v.income ?? 3_000_000);
      setExpenses(v.expenses ?? 1_500_000);
      setIsIp(v.isIp !== undefined ? v.isIp === 1 : true);
      setEmployees(v.employees ?? 0);
      setQuarters(v.quarters ?? 4);
    }

    setActiveTab(tab);
    setVisitedTabs(prev => new Set(prev).add(tab));
  };

  const calculate = useCallback(() => {
    const annualIncome = income;

    // Страховые взносы ИП
    let ipContributions = 0;
    if (isIp) {
      ipContributions = IP_FIXED;
      if (activeTab === 'dohody') {
        const extraBase = annualIncome - IP_EXTRA_THRESHOLD;
        if (extraBase > 0) ipContributions += extraBase * IP_EXTRA_RATE;
      } else {
        const profit = Math.max(annualIncome - expenses, 0);
        const extraBase = profit - IP_EXTRA_THRESHOLD;
        if (extraBase > 0) ipContributions += extraBase * IP_EXTRA_RATE;
      }
      ipContributions = Math.min(ipContributions, IP_MAX_EXTRA);
    }

    if (activeTab === 'dohody') {
      const rate = annualIncome > HIGH_THRESHOLD ? USN_DOHODY_HIGH : USN_DOHODY_RATE;
      let tax = annualIncome * rate;

      // ИП без работников — вычет 100% взносов, с работниками — до 50%
      let deduction = 0;
      if (isIp) {
        if (employees === 0) {
          deduction = Math.min(ipContributions, tax);
        } else {
          deduction = Math.min(ipContributions, tax * 0.5);
        }
      }

      tax = Math.max(tax - deduction, 0);

      const effectiveRate = annualIncome > 0 ? (tax / annualIncome * 100) : 0;
      const netIncome = annualIncome - tax - ipContributions + deduction; // взносы уже вычтены из налога

      setResultLabel('Налог УСН (Доходы)');
      setResultPrimary(fmtRUB(tax));
      setResultDetails([
        { label: 'Ставка', value: `${(rate * 100).toFixed(0)}%${annualIncome > HIGH_THRESHOLD ? ' (повышенная)' : ''}` },
        ...(isIp ? [
          { label: 'Страховые взносы ИП', value: fmtRUB(ipContributions) },
          { label: 'Вычет из налога', value: fmtRUB(deduction), green: true as const },
        ] : []),
        { label: 'Эффективная ставка', value: effectiveRate.toFixed(1) + '%' },
        { label: 'К уплате за год', value: fmtRUB(tax + (isIp ? ipContributions - deduction : 0)), red: true },
      ]);
    } else {
      const profit = Math.max(annualIncome - expenses, 0);
      const rate = annualIncome > HIGH_THRESHOLD ? USN_DOHODY_RASHODY_HIGH : USN_DOHODY_RASHODY_RATE;
      let tax = profit * rate;

      // Минимальный налог — 1% от доходов
      const minTax = annualIncome * MIN_TAX_RATE;
      const isMinTax = tax < minTax && profit > 0;
      if (isMinTax) tax = minTax;

      // На ДР взносы включаются в расходы, не вычитаются из налога
      const totalPayments = tax + ipContributions;
      const effectiveRate = annualIncome > 0 ? (totalPayments / annualIncome * 100) : 0;

      setResultLabel('Налог УСН (Доходы − Расходы)');
      setResultPrimary(fmtRUB(tax));
      setResultDetails([
        { label: 'Доходы', value: fmtRUB(annualIncome) },
        { label: 'Расходы', value: fmtRUB(expenses) },
        { label: 'Налоговая база', value: fmtRUB(profit) },
        { label: 'Ставка', value: `${(rate * 100).toFixed(0)}%${annualIncome > HIGH_THRESHOLD ? ' (повышенная)' : ''}` },
        ...(isMinTax ? [{ label: 'Минимальный налог (1%)', value: fmtRUB(minTax), red: true as const }] : []),
        ...(isIp ? [{ label: 'Страховые взносы ИП', value: fmtRUB(ipContributions) }] : []),
        { label: 'Итого к уплате', value: fmtRUB(totalPayments), red: true },
        { label: 'Эффективная нагрузка', value: effectiveRate.toFixed(1) + '% от доходов' },
      ]);
    }

    if (!completionTracked.current) {
      completionTracked.current = true;
      trackEvent('calc_complete', { variant: activeTab });
    }
  }, [income, expenses, isIp, employees, activeTab, quarters]);

  useEffect(() => { calculate(); }, [calculate]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (params.has('income')) setIncome(get('income', 3_000_000));
    if (params.has('expenses')) setExpenses(get('expenses', 1_500_000));
    if (params.has('isIp')) setIsIp(params.get('isIp') !== 'false');
    if (params.has('employees')) setEmployees(get('employees', 0));
    if (params.has('tab')) { const t = params.get('tab') as Tab; if (['dohody', 'dohody-rashody'].includes(t)) { setActiveTab(t); setVisitedTabs(prev => new Set(prev).add(t)); } }
  }, []);

  const handleInput = (id: string, val: number) => {
    if (id === 'u-income') setIncome(val);
    else if (id === 'u-expenses') setExpenses(val);
    else if (id === 'u-employees') setEmployees(val);
  };

  const getCurrentValues = () => ({ income, expenses, isIp: String(isIp), employees, tab: activeTab });

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Калькулятор УСН — sum.money', url });
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
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={activeTab === 'dohody'} className={activeTab === 'dohody' ? 'active' : ''} onClick={() => switchTab('dohody')}>Доходы (6%)</button>
          <button role="tab" aria-selected={activeTab === 'dohody-rashody'} className={activeTab === 'dohody-rashody' ? 'active' : ''} onClick={() => switchTab('dohody-rashody')}>Доходы − Расходы (15%)</button>
        </div>

        <div className="calc-section-label">{activeTab === 'dohody' ? 'УСН «Доходы»' : 'УСН «Доходы минус расходы»'}</div>

        <div className="inputs-grid">
          <CalcInput id="u-income" label="Годовой доход" prefix="₽" defaultValue={3_000_000} value={income} onChange={handleInput} />
          {activeTab === 'dohody-rashody' && (
            <CalcInput id="u-expenses" label="Годовые расходы" prefix="₽" defaultValue={1_500_000} value={expenses} onChange={handleInput}
              helpText="Документально подтверждённые расходы" />
          )}
        </div>

        <div className="inputs-grid">
          <div className="input-group">
            <label>Форма</label>
            <div className="input-wrapper">
              <select value={isIp ? 'ip' : 'ooo'} onChange={(e) => setIsIp(e.target.value === 'ip')}>
                <option value="ip">ИП</option>
                <option value="ooo">ООО</option>
              </select>
            </div>
          </div>

          {isIp && (
            <CalcInput id="u-employees" label="Кол-во работников" defaultValue={0} value={employees} onChange={handleInput}
              helpText="0 = ИП без работников" />
          )}
        </div>

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
        Ставки и лимиты УСН на 2025 год. Расчёт приблизительный.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
