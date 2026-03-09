import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'workplace' | 'state';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'workplace', label: 'Workplace Pension', icon: '💼' },
  { id: 'state', label: 'State Pension', icon: '🏛️' },
];

// ── UK 2025/26 Pension Constants ──
// Source: GOV.UK benefit-and-pension-rates-2025-to-2026
const STATE_PENSION_WEEKLY = 230.25; // Full new State Pension 2025/26
const STATE_PENSION_ANNUAL = STATE_PENSION_WEEKLY * 52;
const QUALIFYING_YEARS_FULL = 35;
const QUALIFYING_YEARS_MIN = 10;

// ── Formatting ──
function fmtGBP(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '£0';
  return '£' + Math.round(n).toLocaleString('en-GB');
}
function formatCurrency(v: number): string { return v.toLocaleString('en-GB'); }
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

function MoreOptions({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`more-options-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} type="button">
        <span className="arrow">▼</span> More options ({count})
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
  const PROD = 'https://sum.money/uk/pension-calculator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

export default function PensionCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('workplace');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Workplace
  const [wpAge, setWpAge] = useState(30);
  const [wpRetirement, setWpRetirement] = useState(67);
  const [wpSalary, setWpSalary] = useState(45000);
  const [wpEmployeeContrib, setWpEmployeeContrib] = useState(5);
  const [wpEmployerContrib, setWpEmployerContrib] = useState(3);
  const [wpCurrentPot, setWpCurrentPot] = useState(10000);
  const [wpReturn, setWpReturn] = useState(5);

  // State
  const [spYears, setSpYears] = useState(35);

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const visitedTabs = useRef<Set<TabId>>(new Set(['workplace']));
  const savedTabValues = useRef<Record<string, Record<string, number | string>>>({});

  const calcWorkplace = useCallback(() => {
    const years = Math.max(wpRetirement - wpAge, 0);
    const annualContrib = wpSalary * ((wpEmployeeContrib + wpEmployerContrib) / 100);
    const employeeAnnual = wpSalary * (wpEmployeeContrib / 100);
    const employerAnnual = wpSalary * (wpEmployerContrib / 100);
    const monthlyContrib = annualContrib / 12;
    const monthlyReturn = wpReturn / 100 / 12;
    const months = years * 12;

    // FV = PV(1+r)^n + PMT×[(1+r)^n−1]/r
    let fv: number;
    if (monthlyReturn === 0) {
      fv = wpCurrentPot + monthlyContrib * months;
    } else {
      fv = wpCurrentPot * Math.pow(1 + monthlyReturn, months) +
        monthlyContrib * (Math.pow(1 + monthlyReturn, months) - 1) / monthlyReturn;
    }

    const totalYourContribs = employeeAnnual * years;
    const totalEmployerContribs = employerAnnual * years;
    const totalGrowth = fv - wpCurrentPot - totalYourContribs - totalEmployerContribs;
    const annualPensionIncome = fv * 0.04; // 4% safe withdrawal rule

    setResultLabel('Projected pension pot at ' + wpRetirement);
    setResultPrimary(fmtGBP(fv));
    setResultDetails([
      { label: 'Your contributions', value: fmtGBP(totalYourContribs) },
      { label: 'Employer contributions', value: fmtGBP(totalEmployerContribs), green: true },
      { label: 'Investment growth', value: fmtGBP(totalGrowth), green: totalGrowth > 0 },
      { label: 'Current pot', value: fmtGBP(wpCurrentPot) },
      { label: 'Annual income (4% rule)', value: fmtGBP(annualPensionIncome) + '/yr' },
      { label: 'Monthly income (4% rule)', value: fmtGBP(annualPensionIncome / 12) + '/mo' },
    ]);
  }, [wpAge, wpRetirement, wpSalary, wpEmployeeContrib, wpEmployerContrib, wpCurrentPot, wpReturn]);

  const calcState = useCallback(() => {
    const years = Math.min(Math.max(spYears, 0), QUALIFYING_YEARS_FULL);

    let weeklyAmount: number;
    if (years < QUALIFYING_YEARS_MIN) {
      weeklyAmount = 0;
    } else {
      weeklyAmount = STATE_PENSION_WEEKLY * (years / QUALIFYING_YEARS_FULL);
    }
    const annualAmount = weeklyAmount * 52;

    setResultLabel('Your State Pension');
    setResultPrimary(fmtGBP(weeklyAmount) + '/wk');
    setResultDetails([
      { label: 'Annual amount', value: fmtGBP(annualAmount) },
      { label: 'Monthly amount', value: fmtGBP(annualAmount / 12) },
      { label: 'Full State Pension', value: fmtGBP(STATE_PENSION_WEEKLY) + '/wk (' + QUALIFYING_YEARS_FULL + ' years)' },
      { label: 'Your qualifying years', value: years + ' of ' + QUALIFYING_YEARS_FULL },
      ...(years < QUALIFYING_YEARS_MIN ? [{ label: 'Warning', value: 'Need at least 10 qualifying years to receive any State Pension', red: true }] : []),
      ...(years >= QUALIFYING_YEARS_MIN && years < QUALIFYING_YEARS_FULL ? [{ label: 'Shortfall', value: (QUALIFYING_YEARS_FULL - years) + ' more years for full pension' }] : []),
      ...(years >= QUALIFYING_YEARS_FULL ? [{ label: 'Status', value: 'Full State Pension entitlement ✓', green: true }] : []),
    ]);
  }, [spYears]);

  useEffect(() => {
    switch (activeTab) {
      case 'workplace': calcWorkplace(); break;
      case 'state': calcState(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcWorkplace, calcState]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;
    const tabId = params.get('tab') as TabId;
    if (['workplace', 'state'].includes(tabId)) { setActiveTab(tabId); visitedTabs.current.add(tabId); }
    const get = (key: string, fb: number) => { const v = params.get(key); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'workplace') {
      if (params.has('age')) setWpAge(get('age', 30));
      if (params.has('retirement')) setWpRetirement(get('retirement', 67));
      if (params.has('salary')) setWpSalary(get('salary', 45000));
      if (params.has('employee')) setWpEmployeeContrib(get('employee', 5));
      if (params.has('employer')) setWpEmployerContrib(get('employer', 3));
      if (params.has('pot')) setWpCurrentPot(get('pot', 10000));
      if (params.has('return')) setWpReturn(get('return', 5));
    }
    if (tabId === 'state') {
      if (params.has('years')) setSpYears(get('years', 35));
    }
    const urlVersion = params.get('v');
    if (urlVersion && urlVersion < '2026-03-09') setShowVersionBanner(true);
  }, []);

  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'workplace': savedTabValues.current['workplace'] = { age: wpAge, retirement: wpRetirement, salary: wpSalary, employee: wpEmployeeContrib, employer: wpEmployerContrib, pot: wpCurrentPot, return: wpReturn }; break;
      case 'state': savedTabValues.current['state'] = { years: spYears }; break;
    }
  }, [activeTab, wpAge, wpRetirement, wpSalary, wpEmployeeContrib, wpEmployerContrib, wpCurrentPot, wpReturn, spYears]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const s = savedTabValues.current[tabId];
    if (!s) return;
    switch (tabId) {
      case 'workplace': setWpAge(s.age as number); setWpRetirement(s.retirement as number); setWpSalary(s.salary as number); setWpEmployeeContrib(s.employee as number); setWpEmployerContrib(s.employer as number); setWpCurrentPot(s.pot as number); setWpReturn(s.return as number); break;
      case 'state': setSpYears(s.years as number); break;
    }
  }, []);

  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'wp-age': setWpAge, 'wp-retirement': setWpRetirement, 'wp-salary': setWpSalary,
      'wp-employee': setWpEmployeeContrib, 'wp-employer': setWpEmployerContrib,
      'wp-pot': setWpCurrentPot, 'wp-return': setWpReturn, 'sp-years': setSpYears,
    };
    setters[id]?.(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'workplace': return { age: wpAge, retirement: wpRetirement, salary: wpSalary, employee: wpEmployeeContrib, employer: wpEmployerContrib, pot: wpCurrentPot, return: wpReturn };
      case 'state': return { years: spYears };
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
    if (navigator.share) navigator.share({ title: 'UK Pension Calculator — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link copied to clipboard'));
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
          <button key={tab.id} className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            role="tab" aria-selected={activeTab === tab.id} onClick={() => switchTab(tab.id)}>
            <span className="tab-icon">{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <div className="calc-card animate-in delay-4">
        {showVersionBanner && (
          <div style={{ background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px', padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Calculator updated since this link was created.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'workplace' && (
          <div>
            <div className="calc-section-label">Your details</div>
            <div className="inputs-grid">
              <CalcInput id="wp-age" label="Current age" suffix="years" defaultValue={30} value={wpAge} onChange={handleInput} />
              <CalcInput id="wp-retirement" label="Retirement age" suffix="years" defaultValue={67} value={wpRetirement} onChange={handleInput} helpText="UK State Pension age is currently 67" />
              <CalcInput id="wp-salary" label="Annual salary" prefix="£" defaultValue={45000} value={wpSalary} onChange={handleInput} />
              <CalcInput id="wp-employee" label="Your contribution" suffix="%" defaultValue={5} value={wpEmployeeContrib} onChange={handleInput} helpText="Auto-enrolment minimum: 5%" />
              <CalcInput id="wp-employer" label="Employer contribution" suffix="%" defaultValue={3} value={wpEmployerContrib} onChange={handleInput} helpText="Auto-enrolment minimum: 3%" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcInput id="wp-pot" label="Current pot value" prefix="£" defaultValue={10000} value={wpCurrentPot} onChange={handleInput} />
                <CalcInput id="wp-return" label="Expected annual return" suffix="%" defaultValue={5} value={wpReturn} onChange={handleInput} helpText="Typical: 4–7% for a diversified fund" />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'state' && (
          <div>
            <div className="calc-section-label">Your NI record</div>
            <div className="inputs-grid">
              <CalcInput id="sp-years" label="NI qualifying years" suffix="years" defaultValue={35} value={spYears} onChange={handleInput}
                helpText="Check at gov.uk/check-state-pension. Need 35 for full pension, minimum 10." />
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

      <div style={{ textAlign: 'center', marginTop: '12px', fontSize: '.78rem', color: 'var(--ink-muted)', fontStyle: 'italic' }}>
        State Pension rates for 2025/26. Workplace projections assume constant contributions and returns.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
