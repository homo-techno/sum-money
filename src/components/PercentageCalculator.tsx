import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'of' | 'is-what' | 'change';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'of', label: 'X% of Y', icon: '🔢' },
  { id: 'is-what', label: 'X is what %', icon: '❓' },
  { id: 'change', label: '% Change', icon: '📈' },
];

// ── Formatting helpers ──
function formatNum(v: number): string {
  if (!isFinite(v) || isNaN(v)) return '0';
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ── Input component ──
function CalcInput({
  id, label, suffix, defaultValue,
  value, onChange,
}: {
  id: string;
  label: string;
  suffix?: string;
  defaultValue: number;
  value: number;
  onChange: (id: string, val: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayValue = focused ? String(value || '') : formatRate(value);

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        <input
          ref={inputRef}
          type="text"
          id={id}
          className={suffix ? 'has-suffix' : ''}
          inputMode="decimal"
          value={displayValue}
          onFocus={() => {
            setFocused(true);
            setTimeout(() => inputRef.current?.select(), 0);
          }}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const clean = e.target.value.replace(/[^0-9.\-]/g, '');
            onChange(id, parseFloat(clean) || 0);
          }}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </div>
    </div>
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
  const PROD = 'https://sum.money/percentage-calculator';
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
export default function PercentageCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('of');
  const completionTracked = useRef<Record<string, boolean>>({});

  // X% of Y
  const [ofPct, setOfPct] = useState(15);
  const [ofNum, setOfNum] = useState(200);

  // X is what % of Y
  const [iwX, setIwX] = useState(30);
  const [iwY, setIwY] = useState(200);

  // % Change
  const [chFrom, setChFrom] = useState(80);
  const [chTo, setChTo] = useState(100);

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  const savedTabValues = useRef<Record<string, Record<string, number>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['of']));

  const calcOf = useCallback(() => {
    const result = ofNum * ofPct / 100;
    setResultLabel('Result');
    setResultPrimary(formatNum(result));
    setResultDetails([
      { label: 'Calculation', value: `${formatRate(ofPct)}% of ${formatNum(ofNum)} = ${formatNum(result)}` },
    ]);
  }, [ofPct, ofNum]);

  const calcIsWhat = useCallback(() => {
    const pct = iwY !== 0 ? (iwX / iwY) * 100 : 0;
    setResultLabel('Result');
    setResultPrimary(`${pct.toFixed(2)}%`);
    setResultDetails([
      { label: 'Calculation', value: `${formatNum(iwX)} is ${pct.toFixed(2)}% of ${formatNum(iwY)}` },
    ]);
  }, [iwX, iwY]);

  const calcChange = useCallback(() => {
    const change = chFrom !== 0 ? ((chTo - chFrom) / Math.abs(chFrom)) * 100 : 0;
    const diff = chTo - chFrom;
    const isIncrease = diff >= 0;
    setResultLabel(isIncrease ? 'Increase' : 'Decrease');
    setResultPrimary(`${isIncrease ? '+' : ''}${change.toFixed(2)}%`);
    setResultDetails([
      { label: 'Difference', value: `${isIncrease ? '+' : ''}${formatNum(diff)}`, green: isIncrease, red: !isIncrease },
      { label: 'From', value: formatNum(chFrom) },
      { label: 'To', value: formatNum(chTo) },
    ]);
  }, [chFrom, chTo]);

  useEffect(() => {
    switch (activeTab) {
      case 'of': calcOf(); break;
      case 'is-what': calcIsWhat(); break;
      case 'change': calcChange(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcOf, calcIsWhat, calcChange]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;

    const tabId = params.get('tab') as TabId;
    if (['of', 'is-what', 'change'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }

    const get = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null ? parseFloat(v) || fallback : fallback;
    };

    if (tabId === 'of') {
      if (params.has('pct')) setOfPct(get('pct', 15));
      if (params.has('num')) setOfNum(get('num', 200));
    }
    if (tabId === 'is-what') {
      if (params.has('x')) setIwX(get('x', 30));
      if (params.has('y')) setIwY(get('y', 200));
    }
    if (tabId === 'change') {
      if (params.has('from')) setChFrom(get('from', 80));
      if (params.has('to')) setChTo(get('to', 100));
    }

    const urlVersion = params.get('v');
    const updatedAt = '2026-03-09';
    if (urlVersion && urlVersion < updatedAt) {
      setShowVersionBanner(true);
    }
  }, []);

  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'of': savedTabValues.current['of'] = { pct: ofPct, num: ofNum }; break;
      case 'is-what': savedTabValues.current['is-what'] = { x: iwX, y: iwY }; break;
      case 'change': savedTabValues.current['change'] = { from: chFrom, to: chTo }; break;
    }
  }, [activeTab, ofPct, ofNum, iwX, iwY, chFrom, chTo]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const saved = savedTabValues.current[tabId];
    if (!saved) return;
    switch (tabId) {
      case 'of': setOfPct(saved.pct); setOfNum(saved.num); break;
      case 'is-what': setIwX(saved.x); setIwY(saved.y); break;
      case 'change': setChFrom(saved.from); setChTo(saved.to); break;
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'of-pct': setOfPct, 'of-num': setOfNum,
      'iw-x': setIwX, 'iw-y': setIwY,
      'ch-from': setChFrom, 'ch-to': setChTo,
    };
    setters[id]?.(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'of': return { pct: ofPct, num: ofNum };
      case 'is-what': return { x: iwX, y: iwY };
      case 'change': return { from: chFrom, to: chTo };
    }
  };

  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    saveCurrentTabValues();
    if (visitedTabs.current.has(tabId)) {
      restoreTabValues(tabId);
    } else {
      visitedTabs.current.add(tabId);
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prevTab, to: tabId, tab: tabId });
  };

  const doShowFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setShowFeedback(true);
    setTimeout(() => setShowFeedback(false), 2200);
  };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) {
      navigator.share({ title: 'Percentage Calculator — sum.money', url });
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

      <div className="calc-card animate-in delay-4">
        {showVersionBanner && (
          <div style={{
            background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px',
            padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            Calculator updated since this link was created.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'of' && (
          <div>
            <div className="calc-section-label">What is X% of Y?</div>
            <div className="inputs-grid">
              <CalcInput id="of-pct" label="Percentage" suffix="%" defaultValue={15} value={ofPct} onChange={handleInput} />
              <CalcInput id="of-num" label="Number" defaultValue={200} value={ofNum} onChange={handleInput} />
            </div>
          </div>
        )}

        {activeTab === 'is-what' && (
          <div>
            <div className="calc-section-label">X is what % of Y?</div>
            <div className="inputs-grid">
              <CalcInput id="iw-x" label="X (part)" defaultValue={30} value={iwX} onChange={handleInput} />
              <CalcInput id="iw-y" label="Y (whole)" defaultValue={200} value={iwY} onChange={handleInput} />
            </div>
          </div>
        )}

        {activeTab === 'change' && (
          <div>
            <div className="calc-section-label">Percentage change</div>
            <div className="inputs-grid">
              <CalcInput id="ch-from" label="From" defaultValue={80} value={chFrom} onChange={handleInput} />
              <CalcInput id="ch-to" label="To" defaultValue={100} value={chTo} onChange={handleInput} />
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
              Share
            </button>
            <button className="btn btn-ghost" onClick={handleCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Copy result
            </button>
          </div>
        </div>
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
