import { useState, useEffect, useRef } from 'react';

function fmtRUB(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '0 ₽';
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}

function trackEvent(eventName: string, data?: Record<string, unknown>) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), url: location.pathname, ...data };
    if (navigator.sendBeacon) navigator.sendBeacon('/api/track', JSON.stringify(payload));
  } catch { /* silent */ }
}

function buildShareURL(values: Record<string, number | string>) {
  const PROD = 'https://sum.money/ru/matkapital-kalkulyator';
  const base = typeof window !== 'undefined' && window.location.hostname === 'sum.money'
    ? window.location.origin + window.location.pathname : PROD;
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(values)) params.set(key, String(val));
  params.set('v', new Date().toISOString().slice(0, 10));
  return base + '?' + params.toString();
}

// Маткапитал 2025
const MK_FIRST = 690_266;      // на первого ребёнка
const MK_SECOND_ONLY = 912_162; // на второго, если на первого не получали
const MK_SUPPLEMENT = 221_895;  // доплата на второго, если получали на первого

type Purpose = 'ipoteka' | 'zhilyo' | 'obrazovanie' | 'pensiya' | 'adaptaciya';

const PURPOSE_LABELS: Record<Purpose, string> = {
  ipoteka: 'Ипотека / первоначальный взнос',
  zhilyo: 'Улучшение жилищных условий',
  obrazovanie: 'Образование детей',
  pensiya: 'Накопительная пенсия мамы',
  adaptaciya: 'Адаптация детей-инвалидов',
};

export default function MatkapitalCalculator() {
  const completionTracked = useRef(false);

  const [firstChildYear, setFirstChildYear] = useState(2025);
  const [hasFirst, setHasFirst] = useState(true);
  const [hasSecond, setHasSecond] = useState(false);
  const [gotForFirst, setGotForFirst] = useState(false);
  const [purpose, setPurpose] = useState<Purpose>('ipoteka');

  const [resultLabel, setResultLabel] = useState('');
  const [resultPrimary, setResultPrimary] = useState('—');
  const [resultDetails, setResultDetails] = useState<Array<{ label: string; value: string; green?: boolean; red?: boolean }>>([]);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    let total = 0;
    const breakdown: string[] = [];

    if (hasFirst && firstChildYear >= 2020) {
      total += MK_FIRST;
      breakdown.push(`На первого ребёнка: ${fmtRUB(MK_FIRST)}`);

      if (hasSecond) {
        total += MK_SUPPLEMENT;
        breakdown.push(`Доплата на второго: ${fmtRUB(MK_SUPPLEMENT)}`);
      }
    } else if (hasFirst && firstChildYear >= 2007 && firstChildYear < 2020) {
      // До 2020 маткапитал давали только на второго
      if (hasSecond) {
        total += MK_SECOND_ONLY;
        breakdown.push(`На второго ребёнка: ${fmtRUB(MK_SECOND_ONLY)}`);
      } else {
        breakdown.push('До 2020 года маткапитал назначался только при рождении второго ребёнка');
      }
    } else if (!hasFirst && hasSecond) {
      if (!gotForFirst) {
        total += MK_SECOND_ONLY;
        breakdown.push(`На второго ребёнка (полный): ${fmtRUB(MK_SECOND_ONLY)}`);
      } else {
        total += MK_SUPPLEMENT;
        breakdown.push(`Доплата на второго: ${fmtRUB(MK_SUPPLEMENT)}`);
      }
    }

    const purposeNote = purpose === 'ipoteka'
      ? 'Можно использовать сразу после получения сертификата'
      : purpose === 'zhilyo'
        ? 'Можно использовать после 3-летия ребёнка (кроме ипотеки)'
        : purpose === 'obrazovanie'
          ? 'На образование любого ребёнка в семье до 25 лет'
          : purpose === 'pensiya'
            ? 'Только для матери. Можно отозвать до назначения пенсии'
            : 'На товары и услуги по индивидуальной программе реабилитации';

    setResultLabel('Размер маткапитала');
    setResultPrimary(fmtRUB(total));

    const details: Array<{ label: string; value: string; green?: boolean; red?: boolean }> = [];
    if (breakdown.length > 0) {
      breakdown.forEach(b => details.push({ label: 'Расчёт', value: b }));
    }
    details.push({ label: 'Цель использования', value: PURPOSE_LABELS[purpose] });
    details.push({ label: 'Примечание', value: purposeNote });

    if (total > 0) {
      details.push({ label: 'Статус', value: 'Право на маткапитал есть', green: true });
    } else {
      details.push({ label: 'Статус', value: 'Право на маткапитал не определено', red: true });
    }

    setResultDetails(details);

    if (!completionTracked.current) {
      completionTracked.current = true;
      trackEvent('calc_complete', { variant: 'matkapital' });
    }
  }, [hasFirst, hasSecond, gotForFirst, firstChildYear, purpose]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('firstChildYear')) setFirstChildYear(parseInt(params.get('firstChildYear')!) || 2025);
    if (params.has('hasFirst')) setHasFirst(params.get('hasFirst') === 'true');
    if (params.has('hasSecond')) setHasSecond(params.get('hasSecond') === 'true');
    if (params.has('gotForFirst')) setGotForFirst(params.get('gotForFirst') === 'true');
    if (params.has('purpose')) setPurpose(params.get('purpose') as Purpose || 'ipoteka');
  }, []);

  const getCurrentValues = () => ({
    firstChildYear, hasFirst: String(hasFirst), hasSecond: String(hasSecond),
    gotForFirst: String(gotForFirst), purpose,
  });

  const doShowFeedback = (msg: string) => { setFeedbackMsg(msg); setShowFeedback(true); setTimeout(() => setShowFeedback(false), 2200); };

  const handleShare = () => {
    const url = buildShareURL(getCurrentValues());
    trackEvent('share_click', { method: navigator.share ? 'native' : 'clipboard' });
    if (navigator.share) navigator.share({ title: 'Калькулятор маткапитала — sum.money', url });
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
        <div className="calc-section-label">Параметры семьи</div>

        <div className="inputs-grid">
          <div className="input-group">
            <label>Есть первый ребёнок?</label>
            <div className="input-wrapper">
              <select value={hasFirst ? 'yes' : 'no'} onChange={(e) => setHasFirst(e.target.value === 'yes')}>
                <option value="yes">Да</option>
                <option value="no">Нет</option>
              </select>
            </div>
          </div>

          {hasFirst && (
            <div className="input-group">
              <label>Год рождения первого</label>
              <div className="input-wrapper">
                <select value={firstChildYear} onChange={(e) => setFirstChildYear(parseInt(e.target.value))}>
                  {Array.from({ length: 20 }, (_, i) => 2025 - i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="inputs-grid">
          <div className="input-group">
            <label>Есть второй ребёнок?</label>
            <div className="input-wrapper">
              <select value={hasSecond ? 'yes' : 'no'} onChange={(e) => setHasSecond(e.target.value === 'yes')}>
                <option value="yes">Да</option>
                <option value="no">Нет</option>
              </select>
            </div>
          </div>

          {hasSecond && (
            <div className="input-group">
              <label>Получали маткапитал на первого?</label>
              <div className="input-wrapper">
                <select value={gotForFirst ? 'yes' : 'no'} onChange={(e) => setGotForFirst(e.target.value === 'yes')}>
                  <option value="yes">Да</option>
                  <option value="no">Нет</option>
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="inputs-grid">
          <div className="input-group">
            <label>Цель использования</label>
            <div className="input-wrapper">
              <select value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)}>
                {Object.entries(PURPOSE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
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
        Суммы маткапитала на 2025 год. Индексация ежегодная.
      </div>

      <div className={`copy-feedback ${showFeedback ? 'show' : ''}`}>{feedbackMsg}</div>
    </>
  );
}
