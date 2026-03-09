import { useState, useEffect, useRef, useCallback } from 'react';

type TabId = 'gross-net' | 'net-gross';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'gross-net', label: 'Начислено → На руки', icon: '💰' },
  { id: 'net-gross', label: 'На руки → Начислено', icon: '🔄' },
];

// НДФЛ 2025 прогрессивная шкала
const NDFL_BRACKETS: Array<[number, number]> = [
  [2400000, 0.13], [5000000, 0.15], [20000000, 0.18], [50000000, 0.20], [Infinity, 0.22],
];

const CHILD_DEDUCTIONS = [0, 1400, 2800, 6000];
const CHILD_DEDUCTION_LIMIT = 450000;

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

function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/ru/zarplata-kalkulyator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

function calculateNDFL(annualIncome: number): number {
  let tax = 0, prev = 0;
  for (const [cap, rate] of NDFL_BRACKETS) {
    if (annualIncome <= prev) break;
    tax += (Math.min(annualIncome, cap) - prev) * rate;
    prev = cap;
  }
  return tax;
}

function getMonthlyChildDeduction(children: number): number {
  if (children <= 0) return 0;
  let total = 0;
  for (let i = 1; i <= children; i++) total += CHILD_DEDUCTIONS[Math.min(i, 3)];
  return total;
}

function getAnnualChildDeduction(monthlyGross: number, children: number): number {
  if (children <= 0) return 0;
  const monthlyDed = getMonthlyChildDeduction(children);
  const monthsEligible = Math.min(12, Math.floor(CHILD_DEDUCTION_LIMIT / monthlyGross));
  return monthlyDed * Math.max(monthsEligible, 0);
}

export default function ZarplataCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('gross-net');
  const completionTracked = useRef<Record<string, boolean>>({});

  const [gnGross, setGnGross] = useState(200000);
  const [gnChildren, setGnChildren] = useState('0');

  const [ngNet, setNgNet] = useState(150000);
  const [ngChildren, setNgChildren] = useState('0');

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const visitedTabs = useRef<Set<TabId>>(new Set(['gross-net']));

  const calcGrossNet = useCallback(() => {
    const monthlyGross = gnGross;
    const children = parseInt(gnChildren);
    const annualGross = monthlyGross * 12;
    const childDed = getAnnualChildDeduction(monthlyGross, children);
    const taxable = Math.max(annualGross - childDed, 0);
    const annualTax = calculateNDFL(taxable);
    const monthlyTax = annualTax / 12;
    const monthlyNet = monthlyGross - monthlyTax;

    setResultLabel('На руки');
    setResultPrimary(fmtRUB(monthlyNet) + '/мес.');
    setResultDetails([
      { label: 'Начислено', value: fmtRUB(monthlyGross) + '/мес.' },
      { label: 'НДФЛ', value: fmtRUB(monthlyTax) + '/мес.' },
      ...(childDed > 0 ? [{ label: 'Вычеты на детей (год)', value: fmtRUB(childDed), green: true }] : []),
      { label: 'На руки за год', value: fmtRUB(monthlyNet * 12) },
    ]);
  }, [gnGross, gnChildren]);

  const calcNetGross = useCallback(() => {
    const desiredNet = ngNet;
    const children = parseInt(ngChildren);
    // Binary search for gross
    let lo = desiredNet, hi = desiredNet * 2;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const annualGross = mid * 12;
      const childDed = getAnnualChildDeduction(mid, children);
      const taxable = Math.max(annualGross - childDed, 0);
      const tax = calculateNDFL(taxable);
      const net = annualGross - tax;
      if (net / 12 < desiredNet) lo = mid;
      else hi = mid;
    }
    const grossNeeded = Math.round((lo + hi) / 2);
    const annualGross = grossNeeded * 12;
    const childDed = getAnnualChildDeduction(grossNeeded, children);
    const taxable = Math.max(annualGross - childDed, 0);
    const annualTax = calculateNDFL(taxable);
    const monthlyTax = annualTax / 12;

    setResultLabel('Нужный оклад (начислено)');
    setResultPrimary(fmtRUB(grossNeeded) + '/мес.');
    setResultDetails([
      { label: 'Желаемая на руки', value: fmtRUB(desiredNet) + '/мес.' },
      { label: 'НДФЛ', value: fmtRUB(monthlyTax) + '/мес.' },
      { label: 'Разница', value: fmtRUB(grossNeeded - desiredNet) + '/мес.' },
      ...(childDed > 0 ? [{ label: 'Вычеты на детей (год)', value: fmtRUB(childDed), green: true }] : []),
    ]);
  }, [ngNet, ngChildren]);

  useEffect(() => {
    switch (activeTab) {
      case 'gross-net': calcGrossNet(); break;
      case 'net-gross': calcNetGross(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcGrossNet, calcNetGross]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['gross-net', 'net-gross'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'gross-net') {
      if (params.has('gross')) setGnGross(get('gross', 200000));
      if (params.has('children')) setGnChildren(params.get('children') || '0');
    }
    if (tabId === 'net-gross') {
      if (params.has('net')) setNgNet(get('net', 150000));
      if (params.has('children')) setNgChildren(params.get('children') || '0');
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    if (id === 'gn-gross') setGnGross(val);
    else if (id === 'ng-net') setNgNet(val);
  };

  const handleSelect = (id: string, val: string) => {
    if (id === 'gn-children') setGnChildren(val);
    else if (id === 'ng-children') setNgChildren(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'gross-net': return { gross: gnGross, children: gnChildren };
      case 'net-gross': return { net: ngNet, children: ngChildren };
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
    if (navigator.share) navigator.share({ title: 'Калькулятор зарплаты — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Ссылка скопирована'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Результат скопирован'));
  };

  const CHILDREN_OPTIONS = [
    { value: '0', label: 'Нет' }, { value: '1', label: '1 ребёнок' },
    { value: '2', label: '2 детей' }, { value: '3', label: '3 и более' },
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
        {activeTab === 'gross-net' && (
          <div>
            <div className="calc-section-label">Сколько получу на карту?</div>
            <div className="inputs-grid">
              <CalcInput id="gn-gross" label="Оклад (начислено)" prefix="₽" defaultValue={200000} value={gnGross} onChange={handleInput} helpText="Сумма в вакансии / оффере" />
              <CalcSelect id="gn-children" label="Дети" options={CHILDREN_OPTIONS} value={gnChildren} onChange={handleSelect} />
            </div>
          </div>
        )}

        {activeTab === 'net-gross' && (
          <div>
            <div className="calc-section-label">Сколько просить у работодателя?</div>
            <div className="inputs-grid">
              <CalcInput id="ng-net" label="Желаемая на руки" prefix="₽" defaultValue={150000} value={ngNet} onChange={handleInput} helpText="Сколько хотите получать на карту" />
              <CalcSelect id="ng-children" label="Дети" options={CHILDREN_OPTIONS} value={ngChildren} onChange={handleSelect} />
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
        НДФЛ 2025: прогрессивная шкала 13/15/18/20/22%. Вычеты на детей до лимита 450 000 ₽.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
