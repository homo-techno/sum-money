import { useState, useEffect, useRef, useCallback } from 'react';

type TabId = 'snowball' | 'avalanche';
interface TabConfig { id: TabId; label: string; icon: string; }
const TABS: TabConfig[] = [
  { id: 'snowball', label: 'Snowball', icon: '⛷️' },
  { id: 'avalanche', label: 'Avalanche', icon: '🏔️' },
];

interface Debt { name: string; balance: number; rate: number; minPayment: number; }

function fmtUSD(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '$0';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function formatCurrency(v: number): string { return v.toLocaleString('en-US'); }
function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/us/debt-payoff-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

function simulatePayoff(debts: Debt[], extra: number, strategy: TabId): { months: number; totalInterest: number; order: string[] } {
  // Clone debts
  const active = debts.filter(d => d.balance > 0).map(d => ({ ...d }));
  if (active.length === 0) return { months: 0, totalInterest: 0, order: [] };

  let months = 0;
  let totalInterest = 0;
  const order: string[] = [];
  const maxMonths = 600; // 50 years safety

  while (active.some(d => d.balance > 0) && months < maxMonths) {
    months++;

    // Accrue interest
    for (const d of active) {
      if (d.balance <= 0) continue;
      const monthlyRate = d.rate / 100 / 12;
      const interest = d.balance * monthlyRate;
      totalInterest += interest;
      d.balance += interest;
    }

    // Pay minimums first
    let remaining = extra;
    for (const d of active) {
      if (d.balance <= 0) continue;
      const payment = Math.min(d.minPayment, d.balance);
      d.balance -= payment;
    }

    // Sort by strategy for extra payment
    const withBalance = active.filter(d => d.balance > 0);
    if (strategy === 'snowball') {
      withBalance.sort((a, b) => a.balance - b.balance);
    } else {
      withBalance.sort((a, b) => b.rate - a.rate);
    }

    // Apply extra to target
    for (const d of withBalance) {
      if (remaining <= 0) break;
      const payment = Math.min(remaining, d.balance);
      d.balance -= payment;
      remaining -= payment;
      if (d.balance <= 0 && !order.includes(d.name)) order.push(d.name);
    }

    // Check for newly paid off debts
    for (const d of active) {
      if (d.balance <= 0 && !order.includes(d.name)) order.push(d.name);
    }
  }

  return { months, totalInterest, order };
}

function DebtRow({ index, debt, onChange, visible }: {
  index: number; debt: Debt; onChange: (index: number, field: keyof Debt, value: string | number) => void; visible: boolean;
}) {
  if (!visible) return null;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
      <div style={{ fontWeight: 600, fontSize: '.85rem', marginBottom: '8px', color: 'var(--ink)' }}>Debt {index + 1}</div>
      <div className="inputs-grid">
        <div className="input-group">
          <label htmlFor={`d${index}-name`}>Name</label>
          <div className="input-wrapper">
            <input type="text" id={`d${index}-name`} value={debt.name}
              onChange={(e) => onChange(index, 'name', e.target.value)} placeholder="e.g. Visa" />
          </div>
        </div>
        <div className="input-group">
          <label htmlFor={`d${index}-balance`}>Balance</label>
          <div className="input-wrapper">
            <span className="input-prefix">$</span>
            <input type="text" id={`d${index}-balance`} className="has-prefix" inputMode="decimal"
              value={debt.balance || ''} onChange={(e) => onChange(index, 'balance', parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
          </div>
        </div>
        <div className="input-group">
          <label htmlFor={`d${index}-rate`}>Interest rate</label>
          <div className="input-wrapper">
            <input type="text" id={`d${index}-rate`} className="has-suffix" inputMode="decimal"
              value={debt.rate || ''} onChange={(e) => onChange(index, 'rate', parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
            <span className="input-suffix">%</span>
          </div>
        </div>
        <div className="input-group">
          <label htmlFor={`d${index}-min`}>Minimum payment</label>
          <div className="input-wrapper">
            <span className="input-prefix">$</span>
            <input type="text" id={`d${index}-min`} className="has-prefix" inputMode="decimal"
              value={debt.minPayment || ''} onChange={(e) => onChange(index, 'minPayment', parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DebtPayoffCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('snowball');
  const completionTracked = useRef<Record<string, boolean>>({});

  const [debts, setDebts] = useState<Debt[]>([
    { name: 'Credit Card', balance: 5000, rate: 22, minPayment: 100 },
    { name: 'Car Loan', balance: 12000, rate: 6.5, minPayment: 250 },
    { name: 'Student Loan', balance: 25000, rate: 5, minPayment: 280 },
  ]);
  const [visibleCount, setVisibleCount] = useState(2);
  const [extra, setExtra] = useState(200);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const updateDebt = (index: number, field: keyof Debt, value: string | number) => {
    setDebts(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const calculate = useCallback(() => {
    const activeDebts = debts.slice(0, visibleCount).filter(d => d.balance > 0);
    if (activeDebts.length === 0) {
      setResultLabel('No debts to pay off');
      setResultPrimary('$0');
      setResultDetails([]);
      return;
    }

    const result = simulatePayoff(activeDebts, extra, activeTab);
    const totalBalance = activeDebts.reduce((s, d) => s + d.balance, 0);

    // Also calculate without extra for comparison
    const noExtra = simulatePayoff(activeDebts, 0, activeTab);
    const interestSaved = noExtra.totalInterest - result.totalInterest;
    const monthsSaved = noExtra.months - result.months;

    const years = Math.floor(result.months / 12);
    const mos = result.months % 12;
    const dateStr = years > 0 ? `${years}y ${mos}m` : `${mos} months`;

    const now = new Date();
    const payoffDate = new Date(now);
    payoffDate.setMonth(payoffDate.getMonth() + result.months);
    const payoffStr = payoffDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const strategyName = activeTab === 'snowball' ? 'Snowball' : 'Avalanche';
    setResultLabel(`Debt-free in ${dateStr}`);
    setResultPrimary(payoffStr);
    setResultDetails([
      { label: 'Total debt', value: fmtUSD(totalBalance) },
      { label: 'Total interest paid', value: fmtUSD(result.totalInterest) },
      { label: 'Interest saved (vs min only)', value: fmtUSD(interestSaved), green: interestSaved > 0 },
      { label: 'Months saved', value: monthsSaved > 0 ? `${monthsSaved} months` : '—', green: monthsSaved > 0 },
      { label: `${strategyName} order`, value: result.order.join(' → ') },
    ]);
  }, [debts, visibleCount, extra, activeTab]);

  useEffect(() => {
    calculate();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [calculate, activeTab]);

  const switchTab = (tabId: TabId) => {
    const prev = activeTab;
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prev, to: tabId, tab: tabId });
  };

  const getCurrentValues = (): Record<string, number | string> => {
    const v: Record<string, number | string> = { extra };
    debts.slice(0, visibleCount).forEach((d, i) => {
      v[`d${i}name`] = d.name;
      v[`d${i}bal`] = d.balance;
      v[`d${i}rate`] = d.rate;
      v[`d${i}min`] = d.minPayment;
    });
    return v;
  };

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };
  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Debt Payoff Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
  };
  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    navigator.clipboard.writeText(`${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`).then(() => doShowFeedback('Result copied'));
  };

  return (
    <>
      <div className="tabs animate-in delay-3" role="tablist">
        {TABS.map((tab) => (
          <button key={tab.id} className={`tab ${activeTab === tab.id ? 'active' : ''}`} role="tab"
            aria-selected={activeTab === tab.id} onClick={() => switchTab(tab.id)}>
            <span className="tab-icon">{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <div className="calc-card animate-in delay-4">
        <div className="calc-section-label">Your debts</div>

        {debts.map((debt, i) => (
          <DebtRow key={i} index={i} debt={debt} onChange={updateDebt} visible={i < visibleCount} />
        ))}

        {visibleCount < 3 && (
          <button
            type="button"
            onClick={() => setVisibleCount(prev => Math.min(prev + 1, 3))}
            style={{
              background: 'none', border: '1px dashed var(--border)', borderRadius: '8px',
              padding: '10px', width: '100%', cursor: 'pointer', color: 'var(--accent)',
              fontSize: '.85rem', marginBottom: '12px',
            }}
          >
            + Add another debt
          </button>
        )}

        <div style={{ marginTop: '8px' }}>
          <div className="input-group">
            <label htmlFor="extra">Extra monthly payment (above minimums)</label>
            <div className="input-wrapper">
              <span className="input-prefix">$</span>
              <input type="text" id="extra" className="has-prefix" inputMode="decimal"
                value={extra || ''} onChange={(e) => setExtra(parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0)} />
            </div>
            <small style={{ color: 'var(--ink-muted)', fontSize: '0.72rem', marginTop: '4px', display: 'block' }}>
              {activeTab === 'snowball' ? 'Extra goes to smallest balance first' : 'Extra goes to highest interest rate first'}
            </small>
          </div>
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
              Share
            </button>
            <button className="btn btn-ghost" onClick={handleCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Copy result
            </button>
          </div>
        </div>
      </div>
      <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '.78rem', color: 'var(--ink-muted)', fontStyle: 'italic' }}>
        Snowball pays smallest balance first (motivation). Avalanche pays highest rate first (saves money).
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
