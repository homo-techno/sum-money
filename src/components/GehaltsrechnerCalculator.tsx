import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'brutto-netto' | 'netto-brutto';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'brutto-netto', label: 'Brutto → Netto', icon: '📉' },
  { id: 'netto-brutto', label: 'Netto → Brutto', icon: '📈' },
];

// ── 2025 Tax Constants ──
const GRUNDFREIBETRAG = 12_096;
const WERBUNGSKOSTEN = 1_230;
const SONDERAUSGABEN = 36;
const ENTLASTUNG_ALLEINERZ = 4_260;
const SOLI_FREIGRENZE = 39_900;
const BBG_KV = 66_150;
const BBG_RV = 96_600;
const KV_SATZ = 0.146;
const PV_SATZ = 0.036;
const PV_KINDERLOS = 0.006;
const RV_SATZ = 0.186;
const AV_SATZ = 0.026;

const STEUERKLASSE_OPTIONS = [
  { value: 'I', label: 'I — Ledig' },
  { value: 'II', label: 'II — Alleinerziehend' },
  { value: 'III', label: 'III — Verheiratet (Alleinverdiener)' },
  { value: 'IV', label: 'IV — Verheiratet (Doppelverdiener)' },
  { value: 'V', label: 'V — Verheiratet (Partner hat III)' },
  { value: 'VI', label: 'VI — Zweitjob' },
];

const KIST_OPTIONS = [
  { value: '0', label: 'Keine' },
  { value: '0.08', label: '8 % (Bayern, Baden-Württemberg)' },
  { value: '0.09', label: '9 % (übrige Bundesländer)' },
];

// ── §32a EStG 2025 ──
function berechneESt(zvE: number): number {
  zvE = Math.floor(Math.max(zvE, 0));
  if (zvE <= 12_096) return 0;
  if (zvE <= 17_443) {
    const y = (zvE - 12_096) / 10_000;
    return Math.floor((932.30 * y + 1_400) * y);
  }
  if (zvE <= 68_480) {
    const z = (zvE - 17_443) / 10_000;
    return Math.floor((176.64 * z + 2_397) * z + 1_015.13);
  }
  if (zvE <= 277_825) return Math.floor(0.42 * zvE - 10_911.92);
  return Math.floor(0.45 * zvE - 19_246.67);
}

function berechneSoli(est: number): number {
  if (est <= SOLI_FREIGRENZE) return 0;
  return Math.round(Math.min(0.055 * est, 0.119 * (est - SOLI_FREIGRENZE)) * 100) / 100;
}

function pvRateAN(kinderlos: boolean, kinder: number): number {
  let rate = PV_SATZ / 2;
  if (kinderlos) rate += PV_KINDERLOS;
  if (kinder >= 2) rate -= Math.min(kinder - 1, 4) * 0.0025;
  return Math.max(rate, 0);
}

// ── Monthly netto calculator ──
interface MonatsResult {
  monatsnetto: number;
  lohnsteuer: number;
  soli: number;
  kist: number;
  kv: number;
  pv: number;
  rv: number;
  av: number;
  svGesamt: number;
}

function berechneMonat(monatsbrutto: number, klasse: string, kistSatz: number, kinder: number, kvZusatz: number): MonatsResult {
  const jahresbrutto = monatsbrutto * 12;
  const kinderlos = kinder === 0;

  // SV (monthly)
  const monatsBasisKV = Math.min(monatsbrutto, BBG_KV / 12);
  const monatsBasisRV = Math.min(monatsbrutto, BBG_RV / 12);
  const kv = monatsBasisKV * (KV_SATZ + kvZusatz) / 2;
  const pv = monatsBasisKV * pvRateAN(kinderlos, kinder);
  const rv = monatsBasisRV * RV_SATZ / 2;
  const av = monatsBasisRV * AV_SATZ / 2;
  const svGesamt = kv + pv + rv + av;

  // Annual SV for Vorsorge deduction
  const kvJ = kv * 12;
  const pvJ = pv * 12;
  const rvJ = rv * 12;
  const vorsorge = rvJ + kvJ * 0.96 + pvJ;

  // zvE (annual)
  let zvE = jahresbrutto;
  if (klasse !== 'VI') { zvE -= WERBUNGSKOSTEN; zvE -= SONDERAUSGABEN; }
  zvE -= vorsorge;
  if (klasse === 'II') zvE -= ENTLASTUNG_ALLEINERZ;
  zvE = Math.max(zvE, 0);

  // ESt (annual)
  let est: number;
  if (klasse === 'III') est = berechneESt(Math.floor(zvE / 2)) * 2;
  else if (klasse === 'VI') est = berechneESt(zvE + GRUNDFREIBETRAG);
  else est = berechneESt(zvE);

  const soliJ = berechneSoli(est);
  const kistJ = kistSatz > 0 ? Math.round(est * kistSatz * 100) / 100 : 0;

  // Monthly tax
  const lohnsteuer = est / 12;
  const soli = soliJ / 12;
  const kist = kistJ / 12;
  const monatsnetto = monatsbrutto - lohnsteuer - soli - kist - svGesamt;

  return { monatsnetto, lohnsteuer, soli, kist, kv, pv, rv, av, svGesamt };
}

// ── Reverse-solve: Netto → Brutto ──
function findBrutto(targetNetto: number, klasse: string, kistSatz: number, kinder: number, kvZusatz: number): number {
  let low = targetNetto;
  let high = targetNetto * 3;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    const r = berechneMonat(mid, klasse, kistSatz, kinder, kvZusatz);
    if (r.monatsnetto < targetNetto) low = mid;
    else high = mid;
    if (Math.abs(high - low) < 0.01) break;
  }
  return Math.round((low + high) / 2 * 100) / 100;
}

// ── Formatting ──
function fmtEUR(n: number, dec = 0): string {
  if (!isFinite(n) || isNaN(n)) return '0 €';
  return new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: dec, maximumFractionDigits: dec,
  }).format(n);
}

function formatNumber(v: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(v);
}

function formatRate(v: number): string {
  return v % 1 === 0 ? v.toString() : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function formatPct(v: number): string {
  return v.toFixed(1).replace('.', ',') + ' %';
}

// ── Soft Warnings ──
const SOFT_WARNINGS: Record<string, { min: number; max: number; msgLow: string; msgHigh: string }> = {
  brutto: { min: 1000, max: 25000, msgLow: 'Sehr niedriges Gehalt.', msgHigh: 'Ungewöhnlich hohes Gehalt.' },
  netto: { min: 800, max: 15000, msgLow: 'Sehr niedriges Netto.', msgHigh: 'Ungewöhnlich hohes Wunsch-Netto.' },
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
    }}>{msg}</div>
  );
}

// ── CalcInput ──
function CalcInput({ id, label, prefix, suffix, value, onChange, warnId }: {
  id: string; label: string; prefix?: string; suffix?: string;
  value: number; onChange: (id: string, val: number) => void; warnId?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const display = focused ? String(value || '') : prefix ? formatNumber(value) : formatRate(value);

  return (
    <div className="input-group">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrapper">
        {prefix && <span className="input-prefix">{prefix}</span>}
        <input
          ref={inputRef} type="text" id={id}
          className={prefix ? 'has-prefix' : suffix ? 'has-suffix' : ''}
          inputMode="decimal" value={display}
          onFocus={() => { setFocused(true); setTimeout(() => inputRef.current?.select(), 0); }}
          onBlur={() => { setFocused(false); setBlurred(true); }}
          onChange={(e) => onChange(id, parseFloat(e.target.value.replace(/[^0-9.\-]/g, '')) || 0)}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </div>
      {blurred && <SoftWarning fieldId={warnId || id} value={value} />}
    </div>
  );
}

// ── CalcSelect ──
function CalcSelect({ id, label, options, value, onChange }: {
  id: string; label: string; options: Array<{ value: string; label: string }>;
  value: string; onChange: (id: string, val: string) => void;
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

// ── MoreOptions ──
function MoreOptions({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`more-options-toggle ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} type="button">
        <span className="arrow">▼</span> Weitere Optionen ({count})
      </button>
      <div className={`more-options ${open ? 'show' : ''}`}>{children}</div>
    </>
  );
}

// ── Event tracking ──
function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

// ── Share URL ──
function buildShareURL(activeTab: TabId, values: Record<string, number | string>) {
  const PROD = 'https://sum.money/de/gehaltsrechner';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Main Component ──
export default function GehaltsrechnerCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('brutto-netto');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Brutto → Netto
  const [bnBrutto, setBnBrutto] = useState(4500);
  const [bnKlasse, setBnKlasse] = useState('I');
  const [bnKist, setBnKist] = useState('0');
  const [bnKinder, setBnKinder] = useState(0);
  const [bnKvZusatz, setBnKvZusatz] = useState(2.5);

  // Netto → Brutto
  const [nbNetto, setNbNetto] = useState(3000);
  const [nbKlasse, setNbKlasse] = useState('I');
  const [nbKist, setNbKist] = useState('0');
  const [nbKinder, setNbKinder] = useState(0);
  const [nbKvZusatz, setNbKvZusatz] = useState(2.5);

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultSecondary, setResultSecondary] = useState('');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; sub?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const savedTabValues = useRef<Record<string, Record<string, any>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['brutto-netto']));

  // ── Brutto → Netto ──
  const calcBruttoNetto = useCallback(() => {
    const r = berechneMonat(bnBrutto, bnKlasse, parseFloat(bnKist), bnKinder, bnKvZusatz / 100);
    const abzuege = bnBrutto - r.monatsnetto;
    const abzuegePct = bnBrutto > 0 ? (abzuege / bnBrutto) * 100 : 0;

    setResultLabel('Monatsnetto');
    setResultPrimary(fmtEUR(r.monatsnetto, 2));
    setResultSecondary(`${fmtEUR(r.monatsnetto * 12)}/Jahr`);

    const d: Array<{ label: string; value: string; sub?: boolean }> = [
      { label: 'Lohnsteuer', value: fmtEUR(r.lohnsteuer, 2) },
    ];
    if (r.soli > 0) d.push({ label: 'Solidaritätszuschlag', value: fmtEUR(r.soli, 2) });
    if (r.kist > 0) d.push({ label: 'Kirchensteuer', value: fmtEUR(r.kist, 2) });
    d.push(
      { label: 'Sozialabgaben', value: fmtEUR(r.svGesamt, 2) },
      { label: 'KV', value: fmtEUR(r.kv, 2), sub: true },
      { label: 'PV', value: fmtEUR(r.pv, 2), sub: true },
      { label: 'RV', value: fmtEUR(r.rv, 2), sub: true },
      { label: 'AV', value: fmtEUR(r.av, 2), sub: true },
      { label: 'Abzüge gesamt', value: `${fmtEUR(abzuege, 2)} (${formatPct(abzuegePct)})` },
    );
    setResultDetails(d);
  }, [bnBrutto, bnKlasse, bnKist, bnKinder, bnKvZusatz]);

  // ── Netto → Brutto ──
  const calcNettoBrutto = useCallback(() => {
    const brutto = findBrutto(nbNetto, nbKlasse, parseFloat(nbKist), nbKinder, nbKvZusatz / 100);
    const r = berechneMonat(brutto, nbKlasse, parseFloat(nbKist), nbKinder, nbKvZusatz / 100);

    setResultLabel('Benötigtes Bruttogehalt');
    setResultPrimary(fmtEUR(brutto, 2));
    setResultSecondary(`${fmtEUR(brutto * 12)}/Jahr`);

    const d: Array<{ label: string; value: string; sub?: boolean }> = [
      { label: 'Wunsch-Netto', value: fmtEUR(nbNetto, 2) },
      { label: 'Lohnsteuer', value: fmtEUR(r.lohnsteuer, 2) },
    ];
    if (r.soli > 0) d.push({ label: 'Solidaritätszuschlag', value: fmtEUR(r.soli, 2) });
    if (r.kist > 0) d.push({ label: 'Kirchensteuer', value: fmtEUR(r.kist, 2) });
    d.push(
      { label: 'Sozialabgaben', value: fmtEUR(r.svGesamt, 2) },
      { label: 'KV', value: fmtEUR(r.kv, 2), sub: true },
      { label: 'PV', value: fmtEUR(r.pv, 2), sub: true },
      { label: 'RV', value: fmtEUR(r.rv, 2), sub: true },
      { label: 'AV', value: fmtEUR(r.av, 2), sub: true },
    );
    setResultDetails(d);
  }, [nbNetto, nbKlasse, nbKist, nbKinder, nbKvZusatz]);

  // ── Effects ──
  useEffect(() => {
    if (activeTab === 'brutto-netto') calcBruttoNetto();
    else calcNettoBrutto();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcBruttoNetto, calcNettoBrutto]);

  // URL parsing
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (!p.has('tab')) return;
    const tabId = p.get('tab') as TabId;
    if (['brutto-netto', 'netto-brutto'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }
    const g = (k: string, fb: number) => { const v = p.get(k); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'brutto-netto') {
      if (p.has('brutto')) setBnBrutto(g('brutto', 4500));
      if (p.has('klasse')) setBnKlasse(p.get('klasse') || 'I');
      if (p.has('kist')) setBnKist(p.get('kist') || '0');
      if (p.has('kinder')) setBnKinder(g('kinder', 0));
      if (p.has('kvz')) setBnKvZusatz(g('kvz', 2.5));
    }
    if (tabId === 'netto-brutto') {
      if (p.has('netto')) setNbNetto(g('netto', 3000));
      if (p.has('klasse')) setNbKlasse(p.get('klasse') || 'I');
      if (p.has('kist')) setNbKist(p.get('kist') || '0');
      if (p.has('kinder')) setNbKinder(g('kinder', 0));
      if (p.has('kvz')) setNbKvZusatz(g('kvz', 2.5));
    }
    const urlV = p.get('v');
    if (urlV && urlV < '2026-03-09') setShowVersionBanner(true);
  }, []);

  // Tab switching
  const saveCurrentTabValues = useCallback(() => {
    if (activeTab === 'brutto-netto') {
      savedTabValues.current['brutto-netto'] = { brutto: bnBrutto, klasse: bnKlasse, kist: bnKist, kinder: bnKinder, kvz: bnKvZusatz };
    } else {
      savedTabValues.current['netto-brutto'] = { netto: nbNetto, klasse: nbKlasse, kist: nbKist, kinder: nbKinder, kvz: nbKvZusatz };
    }
  }, [activeTab, bnBrutto, bnKlasse, bnKist, bnKinder, bnKvZusatz, nbNetto, nbKlasse, nbKist, nbKinder, nbKvZusatz]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const s = savedTabValues.current[tabId];
    if (!s) return;
    if (tabId === 'brutto-netto') {
      setBnBrutto(s.brutto); setBnKlasse(s.klasse); setBnKist(s.kist);
      setBnKinder(s.kinder); setBnKvZusatz(s.kvz);
    } else {
      setNbNetto(s.netto); setNbKlasse(s.klasse); setNbKist(s.kist);
      setNbKinder(s.kinder); setNbKvZusatz(s.kvz);
    }
  }, []);

  const switchTab = (tabId: TabId) => {
    const prev = activeTab;
    saveCurrentTabValues();
    if (visitedTabs.current.has(tabId)) {
      restoreTabValues(tabId);
    } else {
      // Transfer shared settings
      if (prev === 'brutto-netto') {
        setNbKlasse(bnKlasse); setNbKist(bnKist); setNbKinder(bnKinder); setNbKvZusatz(bnKvZusatz);
      } else {
        setBnKlasse(nbKlasse); setBnKist(nbKist); setBnKinder(nbKinder); setBnKvZusatz(nbKvZusatz);
      }
      visitedTabs.current.add(tabId);
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prev, to: tabId, tab: tabId });
  };

  const handleInput = (id: string, val: number) => {
    const m: Record<string, (v: number) => void> = {
      'bn-brutto': setBnBrutto, 'bn-kinder': setBnKinder, 'bn-kvz': setBnKvZusatz,
      'nb-netto': setNbNetto, 'nb-kinder': setNbKinder, 'nb-kvz': setNbKvZusatz,
    };
    m[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    const m: Record<string, (v: string) => void> = {
      'bn-klasse': setBnKlasse, 'bn-kist': setBnKist,
      'nb-klasse': setNbKlasse, 'nb-kist': setNbKist,
    };
    m[id]?.(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    if (activeTab === 'brutto-netto') {
      return { brutto: bnBrutto, klasse: bnKlasse, kist: bnKist, kinder: bnKinder, kvz: bnKvZusatz };
    }
    return { netto: nbNetto, klasse: nbKlasse, kist: nbKist, kinder: nbKinder, kvz: nbKvZusatz };
  };

  const doShowFeedback = (msg: string) => {
    setFeedbackMsg(msg); setShowFeedback(true);
    setTimeout(() => setShowFeedback(false), 2200);
  };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Gehaltsrechner — sum.money', url });
    else navigator.clipboard.writeText(url).then(() => doShowFeedback('Link in Zwischenablage kopiert'));
  };

  const handleCopy = () => {
    const details = resultDetails.map(d => `${d.sub ? '  ' : ''}${d.label}: ${d.value}`).join('\n');
    const text = `${resultLabel}\n${resultPrimary}\n${resultSecondary}\n${details}\n\n${buildShareURL(activeTab, getCurrentValues())}`;
    navigator.clipboard.writeText(text).then(() => doShowFeedback('Ergebnis kopiert'));
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
          <div style={{
            background: '#e8f4fd', border: '1px solid #b8d9f0', borderRadius: '6px',
            padding: '10px 16px', marginBottom: '16px', fontSize: '.85rem', color: '#1a5a8a',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            Rechner wurde seit Erstellung dieses Links aktualisiert.
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: '#1a5a8a', padding: '0 0 0 12px' }} onClick={() => setShowVersionBanner(false)}>×</button>
          </div>
        )}

        {activeTab === 'brutto-netto' && (
          <div>
            <div className="calc-section-label">Monatsbrutto eingeben — Netto sofort sehen</div>
            <div className="inputs-grid">
              <CalcInput id="bn-brutto" label="Monatsbrutto" prefix="€" value={bnBrutto} onChange={handleInput} warnId="brutto" />
              <CalcSelect id="bn-klasse" label="Steuerklasse" options={STEUERKLASSE_OPTIONS} value={bnKlasse} onChange={handleSelect} />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcSelect id="bn-kist" label="Kirchensteuer" options={KIST_OPTIONS} value={bnKist} onChange={handleSelect} />
                <CalcInput id="bn-kinder" label="Kinder" value={bnKinder} onChange={handleInput} />
                <CalcInput id="bn-kvz" label="KV-Zusatzbeitrag" suffix="%" value={bnKvZusatz} onChange={handleInput} />
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'netto-brutto' && (
          <div>
            <div className="calc-section-label">Wunsch-Netto eingeben — Brutto berechnen</div>
            <div className="inputs-grid">
              <CalcInput id="nb-netto" label="Wunsch-Netto" prefix="€" value={nbNetto} onChange={handleInput} warnId="netto" />
              <CalcSelect id="nb-klasse" label="Steuerklasse" options={STEUERKLASSE_OPTIONS} value={nbKlasse} onChange={handleSelect} />
            </div>
            <MoreOptions count={3}>
              <div className="inputs-grid">
                <CalcSelect id="nb-kist" label="Kirchensteuer" options={KIST_OPTIONS} value={nbKist} onChange={handleSelect} />
                <CalcInput id="nb-kinder" label="Kinder" value={nbKinder} onChange={handleInput} />
                <CalcInput id="nb-kvz" label="KV-Zusatzbeitrag" suffix="%" value={nbKvZusatz} onChange={handleInput} />
              </div>
            </MoreOptions>
          </div>
        )}

        <div className="result-card">
          <div className="result-label">{resultLabel}</div>
          <div className="result-primary">{resultPrimary}</div>
          {resultSecondary && <div style={{ fontSize: '1rem', color: 'var(--ink-muted)', marginTop: '4px' }}>{resultSecondary}</div>}
          <div className="result-details">
            {resultDetails.map((d, i) => (
              <div key={i} className="result-detail">
                <span className="result-detail-label" style={d.sub ? { paddingLeft: '12px', fontSize: '.82rem', color: 'var(--ink-muted)' } : {}}>
                  {d.label}
                </span>
                <span className="result-detail-value" style={d.sub ? { fontSize: '.82rem', color: 'var(--ink-muted)' } : {}}>
                  {d.value}
                </span>
              </div>
            ))}
          </div>
          <div className="result-actions">
            <button className="btn btn-primary" onClick={handleShare}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
              Teilen
            </button>
            <button className="btn btn-ghost" onClick={handleCopy}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Ergebnis kopieren
            </button>
          </div>
        </div>
      </div>
      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
