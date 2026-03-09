import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'erstkaeufer' | 'anschluss' | 'sondertilgung';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'erstkaeufer', label: 'Erstkäufer', icon: '🏠' },
  { id: 'anschluss', label: 'Anschlussfinanzierung', icon: '♻️' },
  { id: 'sondertilgung', label: 'Sondertilgung', icon: '⚡' },
];

const ZINSBINDUNG_OPTIONS = [
  { value: '5', label: '5 Jahre' },
  { value: '10', label: '10 Jahre' },
  { value: '15', label: '15 Jahre' },
  { value: '20', label: '20 Jahre' },
  { value: '25', label: '25 Jahre' },
];

const RESTLAUFZEIT_OPTIONS = [
  { value: '5', label: '5 Jahre' },
  { value: '10', label: '10 Jahre' },
  { value: '15', label: '15 Jahre' },
  { value: '20', label: '20 Jahre' },
  { value: '25', label: '25 Jahre' },
];

// ── German annuity helpers ──
function monatlicheRate(darlehen: number, sollzins: number, tilgung: number): number {
  return darlehen * (sollzins / 100 + tilgung / 100) / 12;
}

function berechneRestschuld(darlehen: number, sollzins: number, tilgung: number, zinsbindungJahre: number): number {
  const rate = monatlicheRate(darlehen, sollzins, tilgung);
  let rest = darlehen;
  const monate = zinsbindungJahre * 12;
  for (let m = 0; m < monate; m++) {
    const zinsen = rest * (sollzins / 100) / 12;
    const tilg = rate - zinsen;
    rest -= tilg;
    if (rest <= 0) return 0;
  }
  return rest;
}

function berechneGesamtlaufzeit(darlehen: number, sollzins: number, tilgung: number): number {
  const rate = monatlicheRate(darlehen, sollzins, tilgung);
  let rest = darlehen;
  let monate = 0;
  while (rest > 0 && monate < 600) {
    const zinsen = rest * (sollzins / 100) / 12;
    const tilg = rate - zinsen;
    rest -= tilg;
    monate++;
  }
  return monate;
}

function berechneSondertilgung(darlehen: number, sollzins: number, tilgung: number, sondertilgungJahr: number) {
  const rate = monatlicheRate(darlehen, sollzins, tilgung);

  // Without Sondertilgung
  let restOhne = darlehen;
  let monateOhne = 0;
  let zinsenOhne = 0;
  while (restOhne > 0 && monateOhne < 600) {
    const z = restOhne * (sollzins / 100) / 12;
    zinsenOhne += z;
    restOhne -= (rate - z);
    monateOhne++;
  }

  // With Sondertilgung (applied at end of each year)
  let restMit = darlehen;
  let monateMit = 0;
  let zinsenMit = 0;
  while (restMit > 0 && monateMit < 600) {
    const z = restMit * (sollzins / 100) / 12;
    zinsenMit += z;
    restMit -= (rate - z);
    monateMit++;
    if (monateMit % 12 === 0 && restMit > 0) {
      restMit -= Math.min(sondertilgungJahr, restMit);
    }
  }

  return {
    zinsenOhne: Math.max(zinsenOhne, 0),
    zinsenMit: Math.max(zinsenMit, 0),
    zinsersparnis: Math.max(zinsenOhne - zinsenMit, 0),
    monateGespart: monateOhne - monateMit,
    laufzeitOhne: monateOhne,
    laufzeitMit: monateMit,
  };
}

// ── Formatting ──
function fmtEUR(n: number, decimals = 0): string {
  if (!isFinite(n) || isNaN(n)) return '0 €';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);
}

function formatNumber(v: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(v);
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatLaufzeit(monate: number): string {
  const j = Math.floor(monate / 12);
  const m = monate % 12;
  if (m === 0) return `${j} Jahre`;
  return `${j} J. ${m} Mon.`;
}

// ── Soft warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  income: { min: 12000, max: 500000, msgLow: 'Sehr niedriges Einkommen.', msgHigh: 'Ungewöhnlich hohes Einkommen.' },
  expenses: { min: 0, max: 5000, msgLow: '', msgHigh: 'Sehr hohe monatliche Ausgaben. Nur Kredite und Verbindlichkeiten angeben.' },
  sollzins: { min: 0.5, max: 15, msgLow: 'Ungewöhnlich niedriger Zinssatz.', msgHigh: 'Ungewöhnlich hoher Zinssatz.' },
  tilgung: { min: 1, max: 10, msgLow: 'Tilgung unter 1% wird von den meisten Banken nicht akzeptiert.', msgHigh: 'Tilgung über 10% ist ungewöhnlich.' },
  restschuld: { min: 1000, max: 10000000, msgLow: '', msgHigh: 'Ungewöhnlich hohe Restschuld.' },
  sonder: { min: 0, max: 100000, msgLow: '', msgHigh: 'Prüfen Sie, ob Ihr Vertrag eine Begrenzung der Sondertilgung vorsieht (meist 5% p.a.).' },
  darlehen: { min: 10000, max: 10000000, msgLow: '', msgHigh: 'Ungewöhnlich hohe Darlehenssumme.' },
};

function SoftWarning({ fieldId, value }: { fieldId: string; value: number }) {
  const rule = SOFT_WARNINGS[fieldId];
  if (!rule) return null;
  let msg = '';
  if (value > 0 && value < rule.min && rule.msgLow) msg = rule.msgLow;
  else if (value > rule.max && rule.msgHigh) msg = rule.msgHigh;
  if (!msg) return null;
  return (
    <div style={{
      fontSize: '.78rem', color: '#b8860b', background: '#fef9ec',
      border: '1px solid #f0e6c8', borderRadius: '4px', padding: '6px 10px',
      marginTop: '4px', lineHeight: 1.4,
    }}>
      {msg}
    </div>
  );
}

// ── Input component ──
function CalcInput({
  id, label, prefix, suffix, defaultValue, helpText,
  value, onChange, warnId,
}: {
  id: string;
  label: string;
  prefix?: string;
  suffix?: string;
  defaultValue: number;
  helpText?: string;
  value: number;
  onChange: (id: string, val: number) => void;
  warnId?: string;
}) {
  const [displayValue, setDisplayValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focused) {
      if (prefix) {
        setDisplayValue(formatNumber(value));
      } else {
        setDisplayValue(formatRate(value));
      }
    }
  }, [value, focused, prefix]);

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        {prefix && <span className="input-prefix">{prefix}</span>}
        <input
          ref={inputRef}
          type="text"
          id={id}
          className={prefix ? 'has-prefix' : suffix ? 'has-suffix' : ''}
          inputMode="decimal"
          value={focused ? String(value || '') : displayValue}
          onFocus={() => {
            setFocused(true);
            setTimeout(() => inputRef.current?.select(), 0);
          }}
          onBlur={() => {
            setFocused(false);
            setBlurred(true);
          }}
          onChange={(e) => {
            const clean = e.target.value.replace(/[^0-9.\-]/g, '');
            onChange(id, parseFloat(clean) || 0);
          }}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </div>
      {helpText && (
        <small style={{ color: 'var(--ink-muted)', fontSize: '0.72rem', marginTop: '4px', display: 'block', lineHeight: 1.3 }}>
          {helpText}
        </small>
      )}
      {blurred && <SoftWarning fieldId={warnId || id} value={value} />}
    </div>
  );
}

// ── Select component ──
function CalcSelect({
  id, label, options, value, onChange,
}: {
  id: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (id: string, val: string) => void;
}) {
  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        <select id={id} value={value} onChange={(e) => onChange(id, e.target.value)}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── More Options toggle ──
function MoreOptions({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={`more-options-toggle ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="arrow">▼</span> Weitere Optionen ({count})
      </button>
      <div className={`more-options ${open ? 'show' : ''}`}>
        {children}
      </div>
    </>
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
  const PROD = 'https://sum.money/de/hypothekenrechner';
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

// ── Net income factor (German approximation: ~60% of gross for average income) ──
const NET_FACTOR = 0.60;
const HOUSING_RATIO = 0.35; // 35% of net income max for housing

// ── Main Calculator Component ──
export default function HypothekenrechnerCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('erstkaeufer');
  const completionTracked = useRef<Record<string, boolean>>({});

  // ── State: Erstkäufer ──
  const [ekIncome, setEkIncome] = useState(95000);
  const [ekExpenses, setEkExpenses] = useState(0);
  const [ekZins, setEkZins] = useState(3.5);
  const [ekBindung, setEkBindung] = useState('10');
  const [ekEigenkapital, setEkEigenkapital] = useState(20);
  const [ekTilgung, setEkTilgung] = useState(2);
  const [ekNebenkosten, setEkNebenkosten] = useState(10);

  // ── State: Anschlussfinanzierung ──
  const [afRestschuld, setAfRestschuld] = useState(275000);
  const [afAltZins, setAfAltZins] = useState(3.5);
  const [afNeuZins, setAfNeuZins] = useState(3.0);
  const [afRestlaufzeit, setAfRestlaufzeit] = useState('15');
  const [afTilgung, setAfTilgung] = useState(2);

  // ── State: Sondertilgung ──
  const [stDarlehen, setStDarlehen] = useState(360000);
  const [stSonder, setStSonder] = useState(5000);
  const [stZins, setStZins] = useState(3.5);
  const [stTilgung, setStTilgung] = useState(2);
  const [stBindung, setStBindung] = useState('10');

  // ── State: result ──
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);
  const [resultNote, setResultNote] = useState('');

  // ── State: version banner ──
  const [showVersionBanner, setShowVersionBanner] = useState(false);

  // ── State: copy feedback ──
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  // ── Tab state storage ──
  const savedTabValues = useRef<Record<string, Record<string, number | string>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['erstkaeufer']));

  // ── Calculation: Erstkäufer ──
  const calcErstkaeufer = useCallback(() => {
    const nettoMonatlich = ekIncome / 12 * NET_FACTOR;
    const maxRate = Math.max(nettoMonatlich * HOUSING_RATIO - ekExpenses, 0);
    const maxDarlehen = (ekZins + ekTilgung) > 0
      ? maxRate * 12 / ((ekZins + ekTilgung) / 100)
      : 0;
    const eigenkapitalAnteil = ekEigenkapital / 100;
    const maxKaufpreis = eigenkapitalAnteil < 1 ? maxDarlehen / (1 - eigenkapitalAnteil) : 0;
    const nebenkosten = maxKaufpreis * ekNebenkosten / 100;
    const benoetigtesEK = maxKaufpreis * eigenkapitalAnteil + nebenkosten;

    const rate = monatlicheRate(maxDarlehen, ekZins, ekTilgung);
    const restschuld = berechneRestschuld(maxDarlehen, ekZins, ekTilgung, parseInt(ekBindung));

    setResultLabel('Sie können sich leisten');
    setResultPrimary(fmtEUR(maxKaufpreis));
    setResultDetails([
      { label: 'Monatliche Rate', value: fmtEUR(rate) },
      { label: 'Kaufnebenkosten (~' + ekNebenkosten + '%)', value: fmtEUR(nebenkosten) },
      { label: 'Benötigtes Eigenkapital', value: fmtEUR(benoetigtesEK) },
      { label: 'Restschuld nach ' + ekBindung + ' J.', value: fmtEUR(restschuld) },
    ]);
    setResultNote('Eigenkapital sollte mindestens die Kaufnebenkosten decken. Berechnung basiert auf 35% des geschätzten Nettoeinkommens.');
  }, [ekIncome, ekExpenses, ekZins, ekBindung, ekEigenkapital, ekTilgung, ekNebenkosten]);

  // ── Calculation: Anschlussfinanzierung ──
  const calcAnschluss = useCallback(() => {
    const alteRate = monatlicheRate(afRestschuld, afAltZins, afTilgung);
    const neueRate = monatlicheRate(afRestschuld, afNeuZins, afTilgung);
    const monatlicheErsparnis = alteRate - neueRate;

    // Simulate both over Restlaufzeit
    const restlaufzeitMonate = parseInt(afRestlaufzeit) * 12;
    let restAlt = afRestschuld, zinsenAlt = 0;
    let restNeu = afRestschuld, zinsenNeu = 0;

    for (let m = 0; m < restlaufzeitMonate; m++) {
      if (restAlt > 0) {
        const zA = restAlt * (afAltZins / 100) / 12;
        zinsenAlt += zA;
        restAlt -= (alteRate - zA);
      }
      if (restNeu > 0) {
        const zN = restNeu * (afNeuZins / 100) / 12;
        zinsenNeu += zN;
        restNeu -= (neueRate - zN);
      }
    }

    const gesamtersparnis = zinsenAlt - zinsenNeu;
    const zinsDiff = afAltZins - afNeuZins;

    setResultLabel(zinsDiff > 0 ? 'Ihre Ersparnis' : 'Mehrkosten');
    setResultPrimary(fmtEUR(Math.abs(monatlicheErsparnis)) + '/Monat');
    setResultDetails([
      { label: 'Alte Rate', value: fmtEUR(alteRate) },
      { label: 'Neue Rate', value: fmtEUR(neueRate) },
      { label: 'Gesamtersparnis (' + afRestlaufzeit + ' J.)', value: fmtEUR(gesamtersparnis), green: gesamtersparnis > 0 },
      { label: 'Restschuld (neuer Zins)', value: fmtEUR(Math.max(restNeu, 0)) },
    ]);
    setResultNote('');
  }, [afRestschuld, afAltZins, afNeuZins, afRestlaufzeit, afTilgung]);

  // ── Calculation: Sondertilgung ──
  const calcSondertilgung = useCallback(() => {
    const result = berechneSondertilgung(stDarlehen, stZins, stTilgung, stSonder);
    const rate = monatlicheRate(stDarlehen, stZins, stTilgung);

    setResultLabel('Sie sparen');
    setResultPrimary(fmtEUR(result.zinsersparnis));
    setResultDetails([
      { label: 'Monatliche Rate', value: fmtEUR(rate) },
      { label: 'Schnellere Tilgung', value: result.monateGespart + ' Monate', green: result.monateGespart > 0 },
      { label: 'Laufzeit ohne Sondertilgung', value: formatLaufzeit(result.laufzeitOhne) },
      { label: 'Laufzeit mit Sondertilgung', value: formatLaufzeit(result.laufzeitMit), green: true },
    ]);
    setResultNote('Die meisten Verträge erlauben max. 5% der Darlehenssumme pro Jahr als Sondertilgung.');
  }, [stDarlehen, stSonder, stZins, stTilgung]);

  // ── Recalculate on input change ──
  useEffect(() => {
    switch (activeTab) {
      case 'erstkaeufer': calcErstkaeufer(); break;
      case 'anschluss': calcAnschluss(); break;
      case 'sondertilgung': calcSondertilgung(); break;
    }
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcErstkaeufer, calcAnschluss, calcSondertilgung]);

  // ── Load from URL on mount ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return;

    const tabId = params.get('tab') as TabId;
    if (['erstkaeufer', 'anschluss', 'sondertilgung'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }

    const get = (key: string, fallback: number) => {
      const v = params.get(key);
      return v !== null ? parseFloat(v) || fallback : fallback;
    };
    const getStr = (key: string, fallback: string) => params.get(key) || fallback;

    if (tabId === 'erstkaeufer' || !tabId) {
      if (params.has('income')) setEkIncome(get('income', 95000));
      if (params.has('expenses')) setEkExpenses(get('expenses', 0));
      if (params.has('zins')) setEkZins(get('zins', 3.5));
      if (params.has('bindung')) setEkBindung(getStr('bindung', '10'));
      if (params.has('ek')) setEkEigenkapital(get('ek', 20));
      if (params.has('tilgung')) setEkTilgung(get('tilgung', 2));
      if (params.has('nk')) setEkNebenkosten(get('nk', 10));
    }
    if (tabId === 'anschluss') {
      if (params.has('rest')) setAfRestschuld(get('rest', 275000));
      if (params.has('alt')) setAfAltZins(get('alt', 3.5));
      if (params.has('neu')) setAfNeuZins(get('neu', 3.0));
      if (params.has('laufzeit')) setAfRestlaufzeit(getStr('laufzeit', '15'));
      if (params.has('tilgung')) setAfTilgung(get('tilgung', 2));
    }
    if (tabId === 'sondertilgung') {
      if (params.has('darlehen')) setStDarlehen(get('darlehen', 360000));
      if (params.has('sonder')) setStSonder(get('sonder', 5000));
      if (params.has('zins')) setStZins(get('zins', 3.5));
      if (params.has('tilgung')) setStTilgung(get('tilgung', 2));
      if (params.has('bindung')) setStBindung(getStr('bindung', '10'));
    }

    const urlVersion = params.get('v');
    const updatedAt = '2026-03-09';
    if (urlVersion && urlVersion < updatedAt) {
      setShowVersionBanner(true);
    }
  }, []);

  // ── Save / restore tab values ──
  const saveCurrentTabValues = useCallback(() => {
    switch (activeTab) {
      case 'erstkaeufer':
        savedTabValues.current['erstkaeufer'] = {
          income: ekIncome, expenses: ekExpenses, zins: ekZins,
          bindung: ekBindung, ek: ekEigenkapital, tilgung: ekTilgung, nk: ekNebenkosten,
        };
        break;
      case 'anschluss':
        savedTabValues.current['anschluss'] = {
          rest: afRestschuld, alt: afAltZins, neu: afNeuZins,
          laufzeit: afRestlaufzeit, tilgung: afTilgung,
        };
        break;
      case 'sondertilgung':
        savedTabValues.current['sondertilgung'] = {
          darlehen: stDarlehen, sonder: stSonder, zins: stZins,
          tilgung: stTilgung, bindung: stBindung,
        };
        break;
    }
  }, [activeTab, ekIncome, ekExpenses, ekZins, ekBindung, ekEigenkapital, ekTilgung, ekNebenkosten,
      afRestschuld, afAltZins, afNeuZins, afRestlaufzeit, afTilgung,
      stDarlehen, stSonder, stZins, stTilgung, stBindung]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const saved = savedTabValues.current[tabId];
    if (!saved) return;
    switch (tabId) {
      case 'erstkaeufer':
        setEkIncome(saved.income as number); setEkExpenses(saved.expenses as number);
        setEkZins(saved.zins as number); setEkBindung(saved.bindung as string);
        setEkEigenkapital(saved.ek as number); setEkTilgung(saved.tilgung as number);
        setEkNebenkosten(saved.nk as number);
        break;
      case 'anschluss':
        setAfRestschuld(saved.rest as number); setAfAltZins(saved.alt as number);
        setAfNeuZins(saved.neu as number); setAfRestlaufzeit(saved.laufzeit as string);
        setAfTilgung(saved.tilgung as number);
        break;
      case 'sondertilgung':
        setStDarlehen(saved.darlehen as number); setStSonder(saved.sonder as number);
        setStZins(saved.zins as number); setStTilgung(saved.tilgung as number);
        setStBindung(saved.bindung as string);
        break;
    }
  }, []);

  // ── Input handlers ──
  const handleInput = (id: string, val: number) => {
    const setters: Record<string, (v: number) => void> = {
      'ek-income': setEkIncome, 'ek-expenses': setEkExpenses,
      'ek-zins': setEkZins, 'ek-eigenkapital': setEkEigenkapital,
      'ek-tilgung': setEkTilgung, 'ek-nebenkosten': setEkNebenkosten,
      'af-restschuld': setAfRestschuld, 'af-alt': setAfAltZins,
      'af-neu': setAfNeuZins, 'af-tilgung': setAfTilgung,
      'st-darlehen': setStDarlehen, 'st-sonder': setStSonder,
      'st-zins': setStZins, 'st-tilgung': setStTilgung,
    };
    setters[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    const setters: Record<string, (v: string) => void> = {
      'ek-bindung': setEkBindung, 'af-laufzeit': setAfRestlaufzeit,
      'st-bindung': setStBindung,
    };
    setters[id]?.(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    switch (activeTab) {
      case 'erstkaeufer':
        return { income: ekIncome, expenses: ekExpenses, zins: ekZins, bindung: ekBindung, ek: ekEigenkapital, tilgung: ekTilgung, nk: ekNebenkosten };
      case 'anschluss':
        return { rest: afRestschuld, alt: afAltZins, neu: afNeuZins, laufzeit: afRestlaufzeit, tilgung: afTilgung };
      case 'sondertilgung':
        return { darlehen: stDarlehen, sonder: stSonder, zins: stZins, tilgung: stTilgung, bindung: stBindung };
    }
  };

  // ── Tab switch with field transfer ──
  const switchTab = (tabId: TabId) => {
    const prevTab = activeTab;
    saveCurrentTabValues();

    if (visitedTabs.current.has(tabId)) {
      restoreTabValues(tabId);
    } else {
      visitedTabs.current.add(tabId);
      // Transfer relevant fields on first visit
      if (tabId === 'anschluss' && prevTab === 'erstkaeufer') {
        setAfAltZins(ekZins);
        setAfTilgung(ekTilgung);
      } else if (tabId === 'sondertilgung' && prevTab === 'erstkaeufer') {
        setStZins(ekZins);
        setStTilgung(ekTilgung);
        setStBindung(ekBindung);
      } else if (tabId === 'sondertilgung' && prevTab === 'anschluss') {
        setStZins(afNeuZins);
        setStTilgung(afTilgung);
      }
    }

    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prevTab, to: tabId, tab: tabId });
  };

  // ── Share / Copy ──
  const doShowFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setShowFeedback(true);
    setTimeout(() => setShowFeedback(false), 2200);
  };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) {
      navigator.share({ title: 'Hypothekenrechner — sum.money', url });
    } else {
      navigator.clipboard.writeText(url).then(() => doShowFeedback('Link in die Zwischenablage kopiert'));
    }
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Ergebnis kopiert'));
  };

  return (
    <>
      {/* TABS */}
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

      {/* CALCULATOR CARD */}
      <div className="calc-card animate-in delay-4">

        {/* Version banner */}
        {showVersionBanner && (
          <div style={{
            background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px',
            padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            Rechner seit Erstellung dieses Links aktualisiert. Ihre Eingaben bleiben erhalten.
            <button
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }}
              onClick={() => setShowVersionBanner(false)}
            >
              ×
            </button>
          </div>
        )}

        {/* ERSTKÄUFER */}
        {activeTab === 'erstkaeufer' && (
          <div>
            <div className="calc-section-label">Ihr Einkommen</div>
            <div className="inputs-grid">
              <CalcInput id="ek-income" label="Jahresbruttoeinkommen" prefix="€" defaultValue={95000} value={ekIncome} onChange={handleInput} warnId="income" />
              <CalcInput id="ek-expenses" label="Monatliche Ausgaben" prefix="€" defaultValue={0} value={ekExpenses} onChange={handleInput} warnId="expenses" helpText="Bestehende Kredite, Unterhalt etc." />
            </div>
            <MoreOptions count={5}>
              <div className="inputs-grid">
                <CalcInput id="ek-zins" label="Sollzinssatz" suffix="%" defaultValue={3.5} value={ekZins} onChange={handleInput} warnId="sollzins" />
                <CalcSelect id="ek-bindung" label="Zinsbindung" options={ZINSBINDUNG_OPTIONS} value={ekBindung} onChange={handleSelect} />
                <CalcInput id="ek-eigenkapital" label="Eigenkapital" suffix="%" defaultValue={20} value={ekEigenkapital} onChange={handleInput} helpText="Anteil am Kaufpreis" />
                <CalcInput id="ek-tilgung" label="Anfängliche Tilgung" suffix="%" defaultValue={2} value={ekTilgung} onChange={handleInput} warnId="tilgung" />
                <CalcInput id="ek-nebenkosten" label="Kaufnebenkosten" suffix="%" defaultValue={10} value={ekNebenkosten} onChange={handleInput} helpText="Grunderwerbsteuer + Notar + Makler" />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* ANSCHLUSSFINANZIERUNG */}
        {activeTab === 'anschluss' && (
          <div>
            <div className="calc-section-label">Ihre aktuelle Finanzierung</div>
            <div className="inputs-grid">
              <CalcInput id="af-restschuld" label="Restschuld" prefix="€" defaultValue={275000} value={afRestschuld} onChange={handleInput} warnId="restschuld" />
              <CalcInput id="af-alt" label="Aktueller Zinssatz" suffix="%" defaultValue={3.5} value={afAltZins} onChange={handleInput} warnId="sollzins" />
              <CalcInput id="af-neu" label="Neuer Zinssatz" suffix="%" defaultValue={3.0} value={afNeuZins} onChange={handleInput} warnId="sollzins" />
            </div>
            <MoreOptions count={2}>
              <div className="inputs-grid">
                <CalcSelect id="af-laufzeit" label="Restlaufzeit" options={RESTLAUFZEIT_OPTIONS} value={afRestlaufzeit} onChange={handleSelect} />
                <CalcInput id="af-tilgung" label="Tilgungssatz" suffix="%" defaultValue={2} value={afTilgung} onChange={handleInput} warnId="tilgung" />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* SONDERTILGUNG */}
        {activeTab === 'sondertilgung' && (
          <div>
            <div className="calc-section-label">Ihr Darlehen</div>
            <div className="inputs-grid">
              <CalcInput id="st-darlehen" label="Darlehenssumme" prefix="€" defaultValue={360000} value={stDarlehen} onChange={handleInput} warnId="darlehen" />
              <CalcInput id="st-sonder" label="Jährliche Sondertilgung" prefix="€" defaultValue={5000} value={stSonder} onChange={handleInput} warnId="sonder" />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcInput id="st-zins" label="Sollzinssatz" suffix="%" defaultValue={3.5} value={stZins} onChange={handleInput} warnId="sollzins" />
                <CalcInput id="st-tilgung" label="Anfängliche Tilgung" suffix="%" defaultValue={2} value={stTilgung} onChange={handleInput} warnId="tilgung" />
                <CalcSelect id="st-bindung" label="Zinsbindung" options={ZINSBINDUNG_OPTIONS} value={stBindung} onChange={handleSelect} />
              </div>
            </MoreOptions>
          </div>
        )}

        {/* RESULT */}
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
          {resultNote && (
            <div style={{
              fontSize: '.78rem', color: 'var(--ink-muted)', marginTop: '12px',
              paddingTop: '12px', borderTop: '1px solid var(--result-border)',
              lineHeight: 1.5, fontStyle: 'italic',
            }}>
              {resultNote}
            </div>
          )}
          <div className="result-actions" style={resultNote ? {} : undefined}>
            <button className="btn btn-primary" onClick={handleShare}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              Teilen
            </button>
            <button className="btn btn-ghost" onClick={handleCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Kopieren
            </button>
          </div>
        </div>
      </div>

      {/* Copy feedback toast */}
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
