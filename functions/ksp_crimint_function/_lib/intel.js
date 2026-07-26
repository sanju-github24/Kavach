/**
 * intel.js — analytical intelligence helpers shared by data-query actions.
 *
 * - MO (modus operandi) extraction + recurring-pattern grouping. The ERD has
 *   no MO column; the investigating officer's narrative lives in
 *   Inv_OccuranceTime.BriefFacts as "… MO: <description>." — extracted here.
 * - Holt-Winters triple exponential smoothing for crime-volume forecasting
 *   (level + trend + 12-month seasonality), with in-sample MAPE so the UI
 *   can report model accuracy honestly.
 * - Z-score anomaly detection on per-district monthly case counts.
 * - Live early-warning alert synthesis from the above (replaces hardcoded
 *   alert lists in the frontend).
 */

// ── MO extraction ────────────────────────────────────────────────────────────
function extractMO(briefFacts) {
  const m = /MO:\s*([^.]+)\./i.exec(briefFacts || '');
  return m ? m[1].trim() : null;
}

function timeBandOf(hour) {
  if (hour == null || Number.isNaN(hour)) return 'Unknown';
  if (hour >= 22 || hour < 5) return 'Night (22–05)';
  if (hour < 12) return 'Morning (05–12)';
  if (hour < 17) return 'Afternoon (12–17)';
  return 'Evening (17–22)';
}

// cases: [{ mo, crime_type, district, hour, date_filed, fir_number, fir_id }]
// Groups identical MO descriptions into recurring-pattern clusters with the
// districts / crimes / time-of-day windows they concentrate in.
function groupMOPatterns(cases) {
  const groups = {};
  cases.forEach(c => {
    if (!c.mo) return;
    const g = (groups[c.mo] ??= { mo: c.mo, count: 0, districts: {}, crimes: {}, bands: {}, cases: [] });
    g.count++;
    g.districts[c.district] = (g.districts[c.district] || 0) + 1;
    g.crimes[c.crime_type] = (g.crimes[c.crime_type] || 0) + 1;
    g.bands[timeBandOf(c.hour)] = (g.bands[timeBandOf(c.hour)] || 0) + 1;
    if (g.cases.length < 6) g.cases.push({ fir_number: c.fir_number, fir_id: c.fir_id, district: c.district, date: c.date_filed });
  });
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return Object.values(groups).sort((a, b) => b.count - a.count).map(g => ({
    mo: g.mo,
    count: g.count,
    topDistricts: top(g.districts).slice(0, 3).map(([name, n]) => ({ name, count: n })),
    topCrimes: top(g.crimes).slice(0, 3).map(([name, n]) => ({ name, count: n })),
    peakBand: top(g.bands)[0]?.[0] || 'Unknown',
    bandBreakdown: top(g.bands).map(([band, n]) => ({ band, count: n })),
    sampleCases: g.cases,
  }));
}

// ── Time series helpers ──────────────────────────────────────────────────────
function monthKey(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

// Returns { labels: ['2018-01', …], values: [n, …] } — contiguous months from
// first to last case, zero-filled so the series is regular for the model.
function monthlySeries(dates) {
  const counts = {};
  let min = null, max = null;
  dates.forEach(d => {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return;
    const k = monthKey(dt);
    counts[k] = (counts[k] || 0) + 1;
    if (!min || dt < min) min = dt;
    if (!max || dt > max) max = dt;
  });
  if (!min) return { labels: [], values: [] };
  const labels = []; const values = [];
  const cur = new Date(min.getFullYear(), min.getMonth(), 1);
  const end = new Date(max.getFullYear(), max.getMonth(), 1);
  while (cur <= end) {
    const k = monthKey(cur);
    labels.push(k);
    values.push(counts[k] || 0);
    cur.setMonth(cur.getMonth() + 1);
  }
  return { labels, values };
}

// ── Holt-Winters triple exponential smoothing (additive) ────────────────────
function holtWinters(values, season = 12, horizon = 6, alpha = 0.35, beta = 0.05, gamma = 0.25) {
  const n = values.length;
  if (n < season * 2) {
    // Not enough history for seasonality — fall back to double exponential (level+trend)
    let level = values[0] || 0, trend = n > 1 ? values[1] - values[0] : 0;
    const fitted = [level];
    for (let i = 1; i < n; i++) {
      const prevLevel = level;
      level = alpha * values[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
      fitted.push(level + trend);
    }
    const forecast = Array.from({ length: horizon }, (_, h) => Math.max(0, Math.round(level + trend * (h + 1))));
    return { forecast, fitted: fitted.map(v => Math.round(v)), mape: mape(values, fitted), method: 'Holt double exponential smoothing (level + trend)' };
  }

  // Initial level/trend/seasonals from the first two seasons
  const seasonAvg = (s) => values.slice(s * season, (s + 1) * season).reduce((a, b) => a + b, 0) / season;
  let level = seasonAvg(0);
  let trend = (seasonAvg(1) - seasonAvg(0)) / season;
  const seasonals = Array.from({ length: season }, (_, i) => {
    let sum = 0, cnt = 0;
    for (let s = 0; s * season + i < n; s++) { sum += values[s * season + i] - seasonAvg(Math.min(s, Math.floor(n / season) - 1)); cnt++; }
    return sum / cnt;
  });

  const fitted = [];
  for (let i = 0; i < n; i++) {
    const si = i % season;
    fitted.push(level + trend + seasonals[si]);
    const prevLevel = level;
    level = alpha * (values[i] - seasonals[si]) + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    seasonals[si] = gamma * (values[i] - level) + (1 - gamma) * seasonals[si];
  }
  const forecast = Array.from({ length: horizon }, (_, h) =>
    Math.max(0, Math.round(level + trend * (h + 1) + seasonals[(n + h) % season])));

  return {
    forecast, fitted: fitted.map(v => Math.round(v)), mape: mape(values, fitted),
    method: 'Holt-Winters triple exponential smoothing (additive, 12-month seasonality)',
    params: { alpha, beta, gamma, season },
  };
}

function mape(actual, fitted) {
  let sum = 0, cnt = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] > 0) { sum += Math.abs((actual[i] - fitted[i]) / actual[i]); cnt++; }
  }
  return cnt ? Math.round((sum / cnt) * 1000) / 10 : null; // percent, 1 decimal
}

// ── Anomaly detection ────────────────────────────────────────────────────────
// Per-district monthly counts → z-score of each recent month against that
// district's own history. |z| >= 2 flags a statistically significant spike/drop.
function detectAnomalies(cases, { recentMonths = 6, minHistory = 8, zThreshold = 2 } = {}) {
  const byDistrict = {};
  cases.forEach(c => {
    if (!c.date_filed) return;
    (byDistrict[c.district] ??= []).push(c.date_filed);
  });

  const anomalies = [];
  Object.entries(byDistrict).forEach(([district, dates]) => {
    const { labels, values } = monthlySeries(dates);
    if (values.length < minHistory) return;
    const historyEnd = values.length - recentMonths;
    if (historyEnd < minHistory) return;
    const history = values.slice(0, historyEnd);
    const mean = history.reduce((a, b) => a + b, 0) / history.length;
    const sd = Math.sqrt(history.reduce((a, b) => a + (b - mean) ** 2, 0) / history.length) || 1;
    for (let i = historyEnd; i < values.length; i++) {
      const z = (values[i] - mean) / sd;
      if (Math.abs(z) >= zThreshold) {
        anomalies.push({
          district, month: labels[i], count: values[i],
          expected: Math.round(mean * 10) / 10,
          zscore: Math.round(z * 100) / 100,
          direction: z > 0 ? 'spike' : 'drop',
          severity: Math.abs(z) >= 3 ? 'CRITICAL' : 'HIGH',
        });
      }
    }
  });
  return anomalies.sort((a, b) => Math.abs(b.zscore) - Math.abs(a.zscore));
}

// ── Live early-warning alerts ────────────────────────────────────────────────
// Synthesises the alert feed from real signals instead of hardcoded strings.
function buildLiveAlerts({ cases = [], profiles = [], accounts = [], moGroups = [], anomalies = [] }) {
  const alerts = [];

  anomalies.slice(0, 3).forEach(a => {
    alerts.push({
      type: a.direction === 'spike' ? 'CRIME SPIKE' : 'ANOMALY',
      severity: a.severity,
      msg: `${a.district}: ${a.count} cases in ${a.month} vs ${a.expected} expected (z=${a.zscore}). ${a.direction === 'spike' ? 'Deploy additional patrol.' : 'Verify reporting pipeline.'}`,
      source: 'Z-score anomaly detection on CaseMaster monthly series',
    });
  });

  const topRepeat = profiles.filter(p => p.is_repeat_offender === 1).sort((a, b) => b.risk_score - a.risk_score)[0];
  if (topRepeat) {
    alerts.push({
      type: 'REPEAT OFFENDER', severity: 'HIGH',
      msg: `${topRepeat.name} (${topRepeat.accused_id}) — risk ${topRepeat.risk_score}/100, linked to ${topRepeat.primary_crime} in ${topRepeat.district}. Surveillance recommended.`,
      source: 'Derived risk scoring over Accused + CaseMaster',
    });
  }

  const topMO = moGroups[0];
  if (topMO && topMO.count >= 3) {
    alerts.push({
      type: 'PATTERN MATCH', severity: 'HIGH',
      msg: `${topMO.count} cases share identical MO — "${topMO.mo}" — concentrated in ${topMO.topDistricts.map(d => d.name).join(', ')}, peak ${topMO.peakBand}. Cross-case investigation recommended.`,
      source: 'Recurring-MO clustering on Inv_OccuranceTime.BriefFacts',
    });
  }

  const flagged = accounts.filter(a => Number(a.flagged) === 1 || a.flagged === true);
  if (flagged.length) {
    const total = flagged.reduce((s, a) => s + (Number(a.total_suspicious_amount) || 0), 0);
    alerts.push({
      type: 'FINANCIAL ALERT', severity: total > 1000000 ? 'HIGH' : 'MEDIUM',
      msg: `${flagged.length} flagged accounts, ₹${(total / 100000).toFixed(1)}L suspicious volume traced. Forward high-value accounts to FIU-IND.`,
      source: 'FinancialAccounts flagged-transaction aggregation',
    });
  }

  // Seasonal signal from the data itself: which quarter historically runs hottest
  const qCounts = [0, 0, 0, 0];
  cases.forEach(c => { const d = new Date(c.date_filed); if (!Number.isNaN(d.getTime())) qCounts[Math.floor(d.getMonth() / 3)]++; });
  const totalQ = qCounts.reduce((a, b) => a + b, 0);
  if (totalQ) {
    const maxQ = qCounts.indexOf(Math.max(...qCounts));
    const pct = Math.round((qCounts[maxQ] / (totalQ / 4) - 1) * 100);
    if (pct >= 5) {
      const qName = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'][maxQ];
      alerts.push({
        type: 'SEASONAL ALERT', severity: 'MEDIUM',
        msg: `${qName} historically runs ${pct}% above the quarterly average across recorded history. Plan patrol strength accordingly.`,
        source: 'Quarterly aggregation of CrimeRegisteredDate',
      });
    }
  }

  const sevRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return alerts.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPOTLIGHTS — the single most important thing to look at on each module page,
// derived from the same live data. Powers the "KAVACH Spotlight" proactive
// callouts + nav attention badges. Each insight carries a `metric` with a
// stable key so the frontend can diff it against the last-seen snapshot and
// show "changed since your last visit". Returns { [moduleId]: [insight, …] }.
// ─────────────────────────────────────────────────────────────────────────────
function computeSpotlights({ cases = [], profiles = [], moGroups = [], anomalies = [], accounts = [] }) {
  const sev = (s) => (s === 'CRITICAL' ? 'critical' : s === 'HIGH' ? 'high' : 'info');
  const out = {};

  // ANALYTICS — worst open-case district
  const byDist = {};
  cases.forEach(f => {
    const d = f.district || 'Unknown';
    (byDist[d] ??= { total: 0, open: 0 });
    byDist[d].total++;
    if (f.status !== 'Closed - FR') byDist[d].open++;
  });
  const worst = Object.entries(byDist).filter(([, v]) => v.total >= 5)
    .map(([d, v]) => ({ d, pct: Math.round((v.open / v.total) * 100), open: v.open, total: v.total }))
    .sort((a, b) => b.pct - a.pct)[0];
  if (worst) out.analytics = [{
    level: worst.pct >= 90 ? 'critical' : 'high',
    title: `${worst.d} has the state's highest open-case rate`,
    detail: `${worst.pct}% of ${worst.total} cases are still open (${worst.open} unresolved) — prioritise investigation resources here.`,
    metric: { key: 'analytics.worst_open', label: `${worst.d} open rate`, value: worst.pct, unit: '%' },
  }];

  // FORECAST — top statistical crime spike
  const spike = anomalies.filter(a => a.direction === 'spike').sort((a, b) => b.zscore - a.zscore)[0];
  if (spike) out.forecast = [{
    level: sev(spike.severity),
    title: `Crime spike detected in ${spike.district}`,
    detail: `${spike.count} cases in ${spike.month} vs ${spike.expected} expected (z=${spike.zscore}). Deploy additional patrol.`,
    metric: { key: `forecast.spike`, label: `${spike.district} · ${spike.month}`, value: spike.count },
  }];

  // PROFILER — highest-risk offender + statewide high-risk count
  const topRisk = [...profiles].sort((a, b) => b.risk_score - a.risk_score)[0];
  const highCount = profiles.filter(p => p.risk_score >= 80).length;
  if (topRisk) out.profiler = [{
    level: topRisk.risk_score >= 85 ? 'critical' : 'high',
    title: `${topRisk.name} is the highest-risk offender`,
    detail: `Rated ${topRisk.risk_score}/100 in ${topRisk.district}, ${topRisk.repeat_case_count} case(s) on record. ${highCount} offenders are high-risk statewide.`,
    metric: { key: 'profiler.high_count', label: 'High-risk offenders', value: highCount },
  }];

  // CASE INSIGHT — top recurring modus operandi cluster
  const topMO = moGroups[0];
  if (topMO && topMO.count >= 3) out.caseinsight = [{
    level: 'info',
    title: 'Recurring modus operandi identified',
    detail: `${topMO.count} cases share the MO "${topMO.mo}", concentrated in ${(topMO.topDistricts || []).map(d => d.name).join(', ') || 'multiple districts'}. Consider a cross-case investigation.`,
    metric: { key: 'caseinsight.top_mo', label: 'Cases sharing top MO', value: topMO.count },
  }];

  // NETWORK — flagged financial accounts
  const flagged = accounts.filter(a => Number(a.flagged) === 1 || a.flagged === true || String(a.flagged) === 'true');
  if (flagged.length) {
    const total = flagged.reduce((s, a) => s + (Number(a.total_suspicious_amount) || 0), 0);
    out.network = [{
      level: total > 1000000 ? 'high' : 'info',
      title: `${flagged.length} flagged financial accounts`,
      detail: `₹${(total / 100000).toFixed(1)}L in suspicious volume traced across the network. Forward high-value accounts to FIU-IND.`,
      metric: { key: 'network.flagged', label: 'Flagged accounts', value: flagged.length },
    }];
  }

  return out;
}

module.exports = { extractMO, timeBandOf, groupMOPatterns, monthlySeries, holtWinters, detectAnomalies, buildLiveAlerts, computeSpotlights };
