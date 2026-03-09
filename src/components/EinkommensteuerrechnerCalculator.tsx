import { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ──
type TabId = 'arbeitnehmer' | 'selbststaendig';

interface TabConfig { id: TabId; label: string; icon: string; }

const TABS: TabConfig[] = [
  { id: 'arbeitnehmer', label: 'Arbeitnehmer', icon: '💼' },
  { id: 'selbststaendig', label: 'Selbstständig', icon: '🏢' },
];

// ── 2025 Tax Constants ──
const GRUNDFREIBETRAG = 12_096;
const WERBUNGSKOSTEN = 1_230;
const SONDERAUSGABEN = 36;
const ENTLASTUNG_ALLEINERZ = 4_260;
const SOLI_FREIGRENZE = 39_900;
const BBG_KV = 66_150;
const BBG_RV = 96_600;
const KV_SATZ_AN = 0.146;
const KV_SATZ_SE = 0.140; // ermäßigt, ohne Krankengeld
const PV_SATZ = 0.036;
const PV_KINDERLOS = 0.006;
const RV_SATZ = 0.186;
const AV_SATZ = 0.026;
const MIN_BEMESSUNG_SE = 14_140;

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

const KV_TYPE_OPTIONS = [
  { value: 'gesetzlich', label: 'Gesetzlich' },
  { value: 'privat', label: 'Privat' },
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

function pvRateSE(kinderlos: boolean, kinder: number): number {
  let rate = PV_SATZ;
  if (kinderlos) rate += PV_KINDERLOS;
  if (kinder >= 2) rate -= Math.min(kinder - 1, 4) * 0.0025;
  return Math.max(rate, 0);
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
  brutto: { min: 12000, max: 500000, msgLow: 'Sehr niedriges Einkommen.', msgHigh: 'Ungewöhnlich hohes Einkommen.' },
  umsatz: { min: 5000, max: 2000000, msgLow: 'Sehr niedriger Umsatz.', msgHigh: 'Ungewöhnlich hoher Umsatz.' },
  ausgaben: { min: 0, max: 500000, msgLow: '', msgHigh: 'Prüfen Sie Ihre Betriebsausgaben.' },
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
  const PROD = 'https://sum.money/de/einkommensteuerrechner';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  params.set('tab', activeTab);
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// ── Main Component ──
export default function EinkommensteuerrechnerCalculator() {
  const [activeTab, setActiveTab] = useState<TabId>('arbeitnehmer');
  const completionTracked = useRef<Record<string, boolean>>({});

  // Arbeitnehmer state
  const [anBrutto, setAnBrutto] = useState(55000);
  const [anKlasse, setAnKlasse] = useState('I');
  const [anKist, setAnKist] = useState('0');
  const [anKinder, setAnKinder] = useState(0);
  const [anKvType, setAnKvType] = useState('gesetzlich');
  const [anKvZusatz, setAnKvZusatz] = useState(2.5);
  const [anKvPrivat, setAnKvPrivat] = useState(400);

  // Selbstständig state
  const [seUmsatz, setSeUmsatz] = useState(80000);
  const [seAusgaben, setSeAusgaben] = useState(10000);
  const [seKlasse, setSeKlasse] = useState('I');
  const [seKist, setSeKist] = useState('0');
  const [seKinder, setSeKinder] = useState(0);
  const [seKvType, setSeKvType] = useState('gesetzlich');
  const [seKvZusatz, setSeKvZusatz] = useState(2.5);
  const [seKvPrivat, setSeKvPrivat] = useState(600);

  // Result
  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultSecondary, setResultSecondary] = useState('');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; sub?: boolean }>>([]);

  const [showVersionBanner, setShowVersionBanner] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const savedTabValues = useRef<Record<string, Record<string, any>>>({});
  const visitedTabs = useRef<Set<TabId>>(new Set(['arbeitnehmer']));

  // ── Arbeitnehmer ──
  const calcArbeitnehmer = useCallback(() => {
    const brutto = anBrutto;
    const klasse = anKlasse;
    const kistSatz = parseFloat(anKist);
    const kinderlos = anKinder === 0;
    const kinder = anKinder;
    const kvZusatz = anKvZusatz / 100;
    const isGKV = anKvType === 'gesetzlich';

    // SV
    const basisKV = Math.min(brutto, BBG_KV);
    const basisRV = Math.min(brutto, BBG_RV);
    let kvAN: number, pvAN: number;
    if (isGKV) {
      kvAN = basisKV * (KV_SATZ_AN + kvZusatz) / 2;
      pvAN = basisKV * pvRateAN(kinderlos, kinder);
    } else {
      kvAN = anKvPrivat * 12;
      pvAN = 0;
    }
    const rvAN = basisRV * RV_SATZ / 2;
    const avAN = basisRV * AV_SATZ / 2;
    const svGesamt = kvAN + pvAN + rvAN + avAN;

    // Vorsorgeaufwendungen
    const vorsorge = rvAN + (isGKV ? kvAN * 0.96 + pvAN : kvAN * 0.96);

    // zvE
    let zvE = brutto;
    if (klasse !== 'VI') { zvE -= WERBUNGSKOSTEN; zvE -= SONDERAUSGABEN; }
    zvE -= vorsorge;
    if (klasse === 'II') zvE -= ENTLASTUNG_ALLEINERZ;
    zvE = Math.max(zvE, 0);

    // ESt
    let est: number;
    if (klasse === 'III') est = berechneESt(Math.floor(zvE / 2)) * 2;
    else if (klasse === 'VI') est = berechneESt(zvE + GRUNDFREIBETRAG);
    else est = berechneESt(zvE);

    const soli = berechneSoli(est);
    const kist = kistSatz > 0 ? Math.round(est * kistSatz * 100) / 100 : 0;
    const steuerGesamt = est + soli + kist;
    const netto = brutto - steuerGesamt - svGesamt;
    const effSteuersatz = brutto > 0 ? (steuerGesamt / brutto) * 100 : 0;

    setResultLabel('Nettoeinkommen');
    setResultPrimary(fmtEUR(netto));
    setResultSecondary(`${fmtEUR(netto / 12)}/Monat`);

    const d: Array<{ label: string; value: string; sub?: boolean }> = [
      { label: 'Einkommensteuer', value: fmtEUR(est) },
    ];
    if (soli > 0) d.push({ label: 'Solidaritätszuschlag', value: fmtEUR(soli, 2) });
    if (kist > 0) d.push({ label: 'Kirchensteuer', value: fmtEUR(kist, 2) });
    d.push(
      { label: 'Sozialabgaben', value: fmtEUR(svGesamt) },
      { label: 'KV', value: fmtEUR(kvAN), sub: true },
      { label: 'PV', value: fmtEUR(pvAN), sub: true },
      { label: 'RV', value: fmtEUR(rvAN), sub: true },
      { label: 'AV', value: fmtEUR(avAN), sub: true },
      { label: 'Effektiver Steuersatz', value: formatPct(effSteuersatz) },
    );
    setResultDetails(d);
  }, [anBrutto, anKlasse, anKist, anKinder, anKvType, anKvZusatz, anKvPrivat]);

  // ── Selbstständig ──
  const calcSelbststaendig = useCallback(() => {
    const gewinn = Math.max(seUmsatz - seAusgaben, 0);
    const klasse = seKlasse;
    const kistSatz = parseFloat(seKist);
    const kinderlos = seKinder === 0;
    const kinder = seKinder;
    const kvZusatz = seKvZusatz / 100;
    const isGKV = seKvType === 'gesetzlich';

    // SV (self-employed: full rate, no RV/AV)
    let kvSE: number, pvSE: number;
    if (isGKV) {
      const basisKV = Math.min(Math.max(gewinn, MIN_BEMESSUNG_SE), BBG_KV);
      kvSE = basisKV * (KV_SATZ_SE + kvZusatz);
      pvSE = basisKV * pvRateSE(kinderlos, kinder);
    } else {
      kvSE = seKvPrivat * 12;
      pvSE = 0;
    }
    const svGesamt = kvSE + pvSE;

    // Vorsorge
    const vorsorge = isGKV ? kvSE * 0.96 + pvSE : kvSE * 0.96;

    // zvE
    let zvE = gewinn - SONDERAUSGABEN - vorsorge;
    if (klasse === 'II') zvE -= ENTLASTUNG_ALLEINERZ;
    zvE = Math.max(zvE, 0);

    let est: number;
    if (klasse === 'III') est = berechneESt(Math.floor(zvE / 2)) * 2;
    else est = berechneESt(zvE);

    const soli = berechneSoli(est);
    const kist = kistSatz > 0 ? Math.round(est * kistSatz * 100) / 100 : 0;
    const steuerGesamt = est + soli + kist;
    const gesamtLast = steuerGesamt + svGesamt;
    const effSatz = gewinn > 0 ? (gesamtLast / gewinn) * 100 : 0;

    setResultLabel('Geschätzte Gesamtbelastung');
    setResultPrimary(fmtEUR(gesamtLast));
    setResultSecondary(`Vorauszahlung: ${fmtEUR(steuerGesamt / 4)}/Quartal`);

    const d: Array<{ label: string; value: string; sub?: boolean }> = [
      { label: 'Gewinn', value: fmtEUR(gewinn) },
      { label: 'Einkommensteuer', value: fmtEUR(est) },
    ];
    if (soli > 0) d.push({ label: 'Solidaritätszuschlag', value: fmtEUR(soli, 2) });
    if (kist > 0) d.push({ label: 'Kirchensteuer', value: fmtEUR(kist, 2) });
    d.push(
      { label: 'KV + PV', value: fmtEUR(svGesamt) },
      { label: 'Effektiver Gesamtsatz', value: formatPct(effSatz) },
    );
    setResultDetails(d);
  }, [seUmsatz, seAusgaben, seKlasse, seKist, seKinder, seKvType, seKvZusatz, seKvPrivat]);

  // ── Effects ──
  useEffect(() => {
    if (activeTab === 'arbeitnehmer') calcArbeitnehmer();
    else calcSelbststaendig();
    if (!completionTracked.current[activeTab]) {
      completionTracked.current[activeTab] = true;
      trackEvent('calc_complete', { variant: activeTab, tab: activeTab });
    }
  }, [activeTab, calcArbeitnehmer, calcSelbststaendig]);

  // URL parsing
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (!p.has('tab')) return;
    const tabId = p.get('tab') as TabId;
    if (['arbeitnehmer', 'selbststaendig'].includes(tabId)) {
      setActiveTab(tabId);
      visitedTabs.current.add(tabId);
    }
    const g = (k: string, fb: number) => { const v = p.get(k); return v !== null ? parseFloat(v) || fb : fb; };
    if (tabId === 'arbeitnehmer') {
      if (p.has('brutto')) setAnBrutto(g('brutto', 55000));
      if (p.has('klasse')) setAnKlasse(p.get('klasse') || 'I');
      if (p.has('kist')) setAnKist(p.get('kist') || '0');
      if (p.has('kinder')) setAnKinder(g('kinder', 0));
      if (p.has('kv')) setAnKvType(p.get('kv') || 'gesetzlich');
      if (p.has('kvz')) setAnKvZusatz(g('kvz', 2.5));
    }
    if (tabId === 'selbststaendig') {
      if (p.has('umsatz')) setSeUmsatz(g('umsatz', 80000));
      if (p.has('ausgaben')) setSeAusgaben(g('ausgaben', 10000));
      if (p.has('klasse')) setSeKlasse(p.get('klasse') || 'I');
      if (p.has('kist')) setSeKist(p.get('kist') || '0');
      if (p.has('kinder')) setSeKinder(g('kinder', 0));
      if (p.has('kv')) setSeKvType(p.get('kv') || 'gesetzlich');
      if (p.has('kvz')) setSeKvZusatz(g('kvz', 2.5));
    }
    const urlV = p.get('v');
    if (urlV && urlV < '2026-03-09') setShowVersionBanner(true);
  }, []);

  // Tab switching
  const saveCurrentTabValues = useCallback(() => {
    if (activeTab === 'arbeitnehmer') {
      savedTabValues.current['arbeitnehmer'] = { brutto: anBrutto, klasse: anKlasse, kist: anKist, kinder: anKinder, kv: anKvType, kvz: anKvZusatz, kvp: anKvPrivat };
    } else {
      savedTabValues.current['selbststaendig'] = { umsatz: seUmsatz, ausgaben: seAusgaben, klasse: seKlasse, kist: seKist, kinder: seKinder, kv: seKvType, kvz: seKvZusatz, kvp: seKvPrivat };
    }
  }, [activeTab, anBrutto, anKlasse, anKist, anKinder, anKvType, anKvZusatz, anKvPrivat, seUmsatz, seAusgaben, seKlasse, seKist, seKinder, seKvType, seKvZusatz, seKvPrivat]);

  const restoreTabValues = useCallback((tabId: TabId) => {
    const s = savedTabValues.current[tabId];
    if (!s) return;
    if (tabId === 'arbeitnehmer') {
      setAnBrutto(s.brutto); setAnKlasse(s.klasse); setAnKist(s.kist);
      setAnKinder(s.kinder); setAnKvType(s.kv); setAnKvZusatz(s.kvz); setAnKvPrivat(s.kvp);
    } else {
      setSeUmsatz(s.umsatz); setSeAusgaben(s.ausgaben); setSeKlasse(s.klasse);
      setSeKist(s.kist); setSeKinder(s.kinder); setSeKvType(s.kv); setSeKvZusatz(s.kvz); setSeKvPrivat(s.kvp);
    }
  }, []);

  const switchTab = (tabId: TabId) => {
    const prev = activeTab;
    saveCurrentTabValues();
    if (visitedTabs.current.has(tabId)) {
      restoreTabValues(tabId);
    } else {
      // Transfer shared settings on first visit
      if (prev === 'arbeitnehmer') {
        setSeKlasse(anKlasse); setSeKist(anKist); setSeKinder(anKinder);
        setSeKvType(anKvType); setSeKvZusatz(anKvZusatz); setSeKvPrivat(anKvPrivat);
      } else {
        setAnKlasse(seKlasse); setAnKist(seKist); setAnKinder(seKinder);
        setAnKvType(seKvType); setAnKvZusatz(seKvZusatz); setAnKvPrivat(seKvPrivat);
      }
      visitedTabs.current.add(tabId);
    }
    setActiveTab(tabId);
    trackEvent('tab_switch', { from: prev, to: tabId, tab: tabId });
  };

  const handleInput = (id: string, val: number) => {
    const m: Record<string, (v: number) => void> = {
      'an-brutto': setAnBrutto, 'an-kinder': setAnKinder, 'an-kvz': setAnKvZusatz, 'an-kvp': setAnKvPrivat,
      'se-umsatz': setSeUmsatz, 'se-ausgaben': setSeAusgaben, 'se-kinder': setSeKinder, 'se-kvz': setSeKvZusatz, 'se-kvp': setSeKvPrivat,
    };
    m[id]?.(val);
  };

  const handleSelect = (id: string, val: string) => {
    const m: Record<string, (v: string) => void> = {
      'an-klasse': setAnKlasse, 'an-kist': setAnKist, 'an-kv': setAnKvType,
      'se-klasse': setSeKlasse, 'se-kist': setSeKist, 'se-kv': setSeKvType,
    };
    m[id]?.(val);
  };

  const getCurrentValues = (): Record<string, number | string> => {
    if (activeTab === 'arbeitnehmer') {
      return { brutto: anBrutto, klasse: anKlasse, kist: anKist, kinder: anKinder, kv: anKvType, kvz: anKvZusatz };
    }
    return { umsatz: seUmsatz, ausgaben: seAusgaben, klasse: seKlasse, kist: seKist, kinder: seKinder, kv: seKvType, kvz: seKvZusatz };
  };

  const doShowFeedback = (msg: string) => {
    setFeedbackMsg(msg); setShowFeedback(true);
    setTimeout(() => setShowFeedback(false), 2200);
  };

  const handleShare = () => {
    const url = buildShareURL(activeTab, getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard', tab: activeTab });
    if (navigator.share) navigator.share({ title: 'Einkommensteuerrechner — sum.money', url });
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

        {activeTab === 'arbeitnehmer' && (
          <div>
            <div className="calc-section-label">Was bleibt netto vom Brutto?</div>
            <div className="inputs-grid">
              <CalcInput id="an-brutto" label="Jahresbruttoeinkommen" prefix="€" value={anBrutto} onChange={handleInput} warnId="brutto" />
              <CalcSelect id="an-klasse" label="Steuerklasse" options={STEUERKLASSE_OPTIONS} value={anKlasse} onChange={handleSelect} />
            </div>
            <MoreOptions count={4}>
              <div className="inputs-grid">
                <CalcSelect id="an-kist" label="Kirchensteuer" options={KIST_OPTIONS} value={anKist} onChange={handleSelect} />
                <CalcInput id="an-kinder" label="Kinder" value={anKinder} onChange={handleInput} />
                <CalcSelect id="an-kv" label="Krankenversicherung" options={KV_TYPE_OPTIONS} value={anKvType} onChange={handleSelect} />
                {anKvType === 'gesetzlich' ? (
                  <CalcInput id="an-kvz" label="KV-Zusatzbeitrag" suffix="%" value={anKvZusatz} onChange={handleInput} />
                ) : (
                  <CalcInput id="an-kvp" label="Monatl. KV-Beitrag" prefix="€" value={anKvPrivat} onChange={handleInput} />
                )}
              </div>
            </MoreOptions>
          </div>
        )}

        {activeTab === 'selbststaendig' && (
          <div>
            <div className="calc-section-label">Steuerlast für Selbstständige</div>
            <div className="inputs-grid">
              <CalcInput id="se-umsatz" label="Jahresumsatz" prefix="€" value={seUmsatz} onChange={handleInput} warnId="umsatz" />
              <CalcSelect id="se-klasse" label="Steuerklasse" options={STEUERKLASSE_OPTIONS} value={seKlasse} onChange={handleSelect} />
            </div>
            <MoreOptions count={5}>
              <div className="inputs-grid">
                <CalcInput id="se-ausgaben" label="Betriebsausgaben" prefix="€" value={seAusgaben} onChange={handleInput} warnId="ausgaben" />
                <CalcSelect id="se-kist" label="Kirchensteuer" options={KIST_OPTIONS} value={seKist} onChange={handleSelect} />
                <CalcInput id="se-kinder" label="Kinder" value={seKinder} onChange={handleInput} />
                <CalcSelect id="se-kv" label="Krankenversicherung" options={KV_TYPE_OPTIONS} value={seKvType} onChange={handleSelect} />
                {seKvType === 'gesetzlich' ? (
                  <CalcInput id="se-kvz" label="KV-Zusatzbeitrag" suffix="%" value={seKvZusatz} onChange={handleInput} />
                ) : (
                  <CalcInput id="se-kvp" label="Monatl. KV-Beitrag" prefix="€" value={seKvPrivat} onChange={handleInput} />
                )}
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
