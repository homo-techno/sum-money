import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'employee' | 'selfemployed';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'employee', label: 'Работник', icon: '💼' },
  { id: 'selfemployed', label: 'Самозанятый', icon: '🧑‍💻' },
];

// ── НДФЛ 2025: Прогрессивная шкала (ФЗ от 12.07.2024 № 176-ФЗ) ──
const NDFL_BRACKETS: Array<[number, number]> = [
  [2400000, 0.13],    // 13% до 2.4 млн
  [5000000, 0.15],    // 15% 2.4–5 млн
  [20000000, 0.18],   // 18% 5–20 млн
  [50000000, 0.20],   // 20% 20–50 млн
  [Infinity, 0.22],   // 22% свыше 50 млн
];

// Стандартные вычеты на детей (2025, ФЗ №176-ФЗ)
// 1-й: 1400, 2-й: 2800, 3+: 6000. Лимит дохода: 450 000 руб.
const CHILD_DEDUCTIONS = [0, 1400, 2800, 6000]; // по индексу: 0 детей, 1, 2, 3+
const CHILD_DEDUCTION_LIMIT = 450000;

// НПД (самозанятые): 4% физлица, 6% юрлица, лимит 2 400 000/год
const NPD_RATE_PHYS = 0.04;
const NPD_RATE_LEGAL = 0.06;
const NPD_ANNUAL_LIMIT = 2400000;

// ── Formatting ──
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
  const PROD = 'https://sum.money/ru/ndfl-kalkulyator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Tax engine: progressive NDFL ──
function calculateNDFL(annualIncome: number): { tax: number; effectiveRate: number; marginalRate: number } {
  let tax = 0;
  let prev = 0;
  let marginalRate = 0.13;
  for (const [cap, rate] of NDFL_BRACKETS) {
    if (annualIncome <= prev) break;
    const chunk = Math.min(annualIncome, cap) - prev;
    tax += chunk * rate;
    marginalRate = rate;
    prev = cap;
  }
  const effectiveRate = annualIncome > 0 ? tax / annualIncome : 0;
  return { tax, effectiveRate, marginalRate };
}

// Monthly child deduction
function getMonthlyChildDeduction(children: number): number {
  if (children <= 0) return 0;
  let total = 0;
  for (let i = 1; i <= children; i++) {
    total += CHILD_DEDUCTIONS[Math.min(i, 3)];
  }
  return total;
}

// Annual child deduction (considering income limit)
function getAnnualChildDeduction(monthlyGross: number, children: number): number {
  if (children <= 0) return 0;
  const monthlyDed = getMonthlyChildDeduction(children);
  // Deduction applies until cumulative income from year start exceeds 450K
  const monthsEligible = Math.min(12, Math.floor(CHILD_DEDUCTION_LIMIT / monthlyGross));
  return monthlyDed * Math.max(monthsEligible, 0);
}

export default function NdflCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('employee');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Employee
  const [empGross, setEmpGross] = useState(150000);
  const [empChildren, setEmpChildren] = useState('0');
  const [empPropertyDed, setEmpPropertyDed] = useState(0);

  // Self-employed
  const [seIncome, setSeIncome] = useState(80000);
  const [seClientType, setSeClientType] = useState('phys');

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const visitedTabs = useRef<Set<TabId>>(new Set(['employee']));
  const savedTabValues = useRef<Record<string, Record<string, number | string>>>({});

  const calcEmployee = useCallback(() => {
    const monthlyGross = empGross;
    const annualGross = monthlyGross * 12;
    const children = parseInt(empChildren);
    const childDeduction = getAnnualChildDeduction(monthlyGross, children);
    const propertyDeduction = empPropertyDed;
    const totalDeductions = childDeduction + propertyDeduction;
    const taxableIncome = Math.max(annualGross - totalDeductions, 0);

    const { tax, effectiveRate, marginalRate } = calculateNDFL(taxableIncome);
    const monthlyTax = tax / 12;
    const monthlyNet = monthlyGross - monthlyTax;

    setResultLabel('Зарплата на руки');
    setResultPrimary(fmtRUB(monthlyNet) + '/мес.');
    setResultDetails([
      { label: 'Годовой доход', value: fmtRUB(annualGross) },
      { label: 'НДФЛ за год', value: fmtRUB(tax) },
      { label: 'НДФЛ в месяц', value: fmtRUB(monthlyTax) },
      ...(totalDeductions > 0 ? [{ label: 'Вычеты за год', value: fmtRUB(totalDeductions), green: true }] : []),
      { label: 'Эффективная ставка', value: (effectiveRate * 100).toFixed(1) + '%' },
      { label: 'Маргинальная ставка', value: (marginalRate * 100) + '%' },
    ]);
  }, [empGross, empChildren, empPropertyDed]);

  const calcSelfEmployed = useCallback(() => {
    const monthlyIncome = seIncome;
    const annualIncome = monthlyIncome * 12;

    let rate: number;
    let rateLabel: string;
    if (seClientType === 'phys') {
      rate = NPD_RATE_PHYS;
      rateLabel = '4% (физлица)';
    } else if (seClientType === 'legal') {
      rate = NPD_RATE_LEGAL;
      rateLabel = '6% (юрлица)';
    } else {
      // Mixed: assume 50/50
      rate = (NPD_RATE_PHYS + NPD_RATE_LEGAL) / 2;
      rateLabel = '~5% (смешанный)';
    }

    const monthlyTax = monthlyIncome * rate;
    const annualTax = annualIncome * rate;
    const overLimit = annualIncome > NPD_ANNUAL_LIMIT;

    setResultLabel('Налог за месяц');
    setResultPrimary(fmtRUB(monthlyTax) + '/мес.');
    setResultDetails([
      { label: 'Налог за год', value: fmtRUB(annualTax) },
      { label: 'Ставка', value: rateLabel },
      { label: 'Доход за год', value: fmtRUB(annualIncome) },
      { label: 'На руки за год', value: fmtRUB(annualIncome - annualTax), green: true },
      ...(overLimit ? [{ label: 'Лимит НПД', value: 'Превышен лимит 2,4 млн ₽/год. Нужна другая система налогообложения.', red: true }] : []),
    ]);
  }, [seIncome, seClientType]);

  useEffect(() => {
    switch (activeTab) {
      case 'employee': calcEmployee(); break;
      case 'selfemployed': calcSelfEmployed(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcEmployee, calcSelfEmployed]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['employee', 'selfemployed'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'employee') {
      if (params.has('gross')) setEmpGross(get('gross', 150000));
      if (params.has('children')) setEmpChildren(params.get('children') || '0');
      if (params.has('propertyDed')) setEmpPropertyDed(get('propertyDed', 0));
    }
    if (tabId === 'selfemployed') {
      if (params.has('income')) setSeIncome(get('income', 80000));
      if (params.has('clientType')) setSeClientType(params.get('clientType') || 'phys');
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'employee': savedTabValues.current['employee'] = { gross: empGross, children: empChildren, propertyDed: empPropertyDed }; break;
      case 'selfemployed': savedTabValues.current['selfemployed'] = { income: seIncome, clientType: seClientType }; break;
    }
  }, [activeTab, empGross, empChildren, empPropertyDed, seIncome, seClientType]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const s = savedTabValues.current[tabId];
    if (!s) return;
    switch (tabId) {
      case 'employee': setEmpGross(s.gross as number); setEmpChildren(s.children as string); setEmpPropertyDed(s.propertyDed as number); break;
      case 'selfemployed': setSeIncome(s.income as number); setSeClientType(s.clientType as string); break;
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'e-gross': setEmpGross, 'e-propertyDed': setEmpPropertyDed, 's-income': setSeIncome,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'e-children') setEmpChildren(val);
    else if (id === 's-clientType') setSeClientType(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'employee': return { gross: empGross, children: empChildren, propertyDed: empPropertyDed };
      case 'selfemployed': return { income: seIncome, clientType: seClientType };
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
    if (navigator.share) navigator.share({ title: 'Калькулятор НДФЛ 2025 — sum.money', url });
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
            Калькулятор обновлён. Результат отражает актуальные ставки.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'employee' && (
          <div>
            <div className="calc-section-label">Ваша зарплата</div>
            <div className="inputs-grid">
              <CalcInput id="e-gross" label="Зарплата gross" prefix="₽" defaultValue={150000} value={empGross} onChange={handleInput} helpText="До вычета НДФЛ, в месяц" />
              <CalcSelect id="e-children" label="Дети" options={[
                { value: '0', label: 'Нет' }, { value: '1', label: '1 ребёнок' },
                { value: '2', label: '2 детей' }, { value: '3', label: '3 и более' },
              ]} value={empChildren} onChange={handleSelect} />
            </div>
            <MoreOptions count={1}>
              <div className="inputs-grid">
                <CalcInput id="e-propertyDed" label="Имущественный вычет" prefix="₽" defaultValue={0} value={empPropertyDed} onChange={handleInput} helpText="Сумма вычета за год (макс. 260 000 ₽ возврата)" />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'selfemployed' && (
          <div>
            <div className="calc-section-label">Ваш доход</div>
            <div className="inputs-grid">
              <CalcInput id="s-income" label="Доход в месяц" prefix="₽" defaultValue={80000} value={seIncome} onChange={handleInput} />
              <CalcSelect id="s-clientType" label="Тип клиентов" options={[
                { value: 'phys', label: 'Физлица (4%)' },
                { value: 'legal', label: 'Юрлица (6%)' },
                { value: 'mixed', label: 'Смешанный (~5%)' },
              ]} value={seClientType} onChange={handleSelect} />
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
        Прогрессивная шкала НДФЛ с 2025 года: 13/15/18/20/22%. Без учёта региональных особенностей.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
