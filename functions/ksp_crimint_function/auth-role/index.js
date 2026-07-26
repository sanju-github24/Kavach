/**
 * KAVACH — Main Intelligence Backend
 * Handles ALL routes: chat, analytics, networks, profiler, cases, forecast, role check
 *
 * Tables: UserProfiles, Accused, Victims, FIRs, FIR_Accused, Relationships, FinancialAccounts, AuditLogs
 *
 * Env vars:
 *   ZOHO_CLIENT_ID     — from Zoho API Console
 *   ZOHO_CLIENT_SECRET — from Zoho API Console
 */

const https   = require('https');
const catalyst = require('zcatalyst-sdk-node');
const { escStr, escId } = require('../_lib/sanitize');

const PROJECT_ID   = '47756000000013047';
const CATALYST_ORG = '60073493322';
const DOC_ID       = '3868000000003019';

const SYSTEM_INTRO = `You are KAVACH, a crime intelligence assistant for Karnataka State Police.
You are given REAL database records from the live Data Store below. Answer ONLY from this data.
Be specific: cite FIR numbers, accused IDs, district names, exact case counts from the data.
Use **bold** for key names and numbers. Keep answer under 150 words. End with one actionable recommendation.`;

// ── TABLE NAMES ───────────────────────────────────────────────────────────────
const T = {
  USERS:   'UserProfiles',
  FIRS:    'FIRs',
  ACCUSED: 'Accused',
  VICTIMS: 'Victims',
  FIR_ACC: 'FIR_Accused',
  REL:     'Relationships',
  FIN:     'FinancialAccounts',
  AUDIT:   'AuditLogs',
};

// ── HTTPS POST (with timeout) ────────────────────────────────────────────────
function httpsPost(hostname, path, headers, payload, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const req  = https.request(
      { hostname, path, method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ response: data }); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error(`POST timeout: ${hostname}${path}`)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── OAUTH TOKEN — cached in-memory (valid ~1hr) ──────────────────────────────
let _cachedToken = null;
let _tokenExp    = 0;

async function getFreshToken(app) {
  const now = Date.now();
  if (_cachedToken && now < _tokenExp - 60_000) return _cachedToken;

  // Try Catalyst Segment Cache
  if (app) {
    try {
      const segment = app.cache().segment();
      const token = await segment.getValue('oauth_token');
      const expiryStr = await segment.getValue('oauth_token_expiry');
      const expiry = expiryStr ? Number(expiryStr) : 0;
      if (token && now < expiry - 60_000) {
        console.log('TOKEN: retrieved from Catalyst Segment Cache');
        _cachedToken = token;
        _tokenExp = expiry;
        return token;
      }
    } catch (e) {
      console.log('CACHE_GET_SKIP:', e.message);
    }
  }

  const params = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    scope:         'ZohoCatalyst.datastore.rows.ALL,ZohoCatalyst.datastore.ALL,ZohoCatalyst.quickml.READ',
  });
  const r = await httpsPost(
    'accounts.zoho.in', '/oauth/v2/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' },
    params.toString(), 10000
  );
  if (!r.access_token) throw new Error('OAuth failed: ' + JSON.stringify(r));
  _cachedToken = r.access_token;
  _tokenExp    = now + (r.expires_in || 3600) * 1000;
  console.log('TOKEN: refreshed, expires_in:', r.expires_in);

  // Save to Catalyst Segment Cache
  if (app) {
    try {
      const segment = app.cache().segment();
      await Promise.all([
        segment.put('oauth_token', _cachedToken),
        segment.put('oauth_token_expiry', String(_tokenExp))
      ]);
      console.log('TOKEN: saved to Catalyst Segment Cache');
    } catch (e) {
      console.log('CACHE_PUT_SKIP:', e.message);
    }
  }

  return _cachedToken;
}

// ── SAFE ZCQL QUERY (with timeout) ───────────────────────────────────────────
async function q(app, query, timeoutMs = 7000) {
  try {
    const dbP  = app.zcql().executeZCQLQuery(query);
    const tP   = new Promise((_, rej) => setTimeout(() => rej(new Error('ZCQL_TIMEOUT')), timeoutMs));
    const rows = await Promise.race([dbP, tP]);
    return rows || [];
  } catch (e) {
    console.error('ZCQL_ERR:', e.message, '| Q:', query.slice(0, 100));
    return [];
  }
}

// Helper to flatten Catalyst SDK row format
function flat(row, table) {
  return row[table] || row;
}

// ── INTENT DETECTION ──────────────────────────────────────────────────────────
function detectIntent(msg) {
  const m = msg.toLowerCase();
  if (/\bfir[\s\/]|case number|fir number|cases in|open case/.test(m)) return 'fir_lookup';
  if (/accused|offender|suspect|profile|A-\d{4}/.test(m))              return 'offender_profile';
  if (/victim/.test(m))                                                  return 'victim_lookup';
  if (/network|gang|link|connect|associat|financial/.test(m))           return 'network_analysis';
  if (/forecast|predict|next|upcoming|risk area|hotspot/.test(m))       return 'forecast';
  if (/repeat|habitual/.test(m))                                         return 'repeat_offenders';
  if (/pattern|trend|statistic|district|analysis|all/.test(m))          return 'pattern_analysis';
  return 'general';
}

// ── FETCH RELEVANT DATA FROM DATA STORE ──────────────────────────────────────
async function fetchRelevantData(app, intent, message) {
  let rows    = [];
  let context = '';

  try {
    if (intent === 'repeat_offenders' || intent === 'offender_profile') {
      const idMatch = message.match(/A-(\d{4})/i);
      if (idMatch) {
        rows = await q(app, `SELECT * FROM ${T.ACCUSED} WHERE accused_id = 'A-${escStr(idMatch[1])}'`);
      } else {
        rows = (await q(app, `SELECT accused_id, name, age, gender, district, risk_score, primary_crime, modus_operandi, occupation, education, economic_status, is_repeat_offender FROM ${T.ACCUSED} WHERE is_repeat_offender = 1 ORDER BY risk_score DESC`)).slice(0, 10);
      }
      context = 'ACCUSED RECORDS:\n' + rows.map(r => {
        const a = flat(r, T.ACCUSED);
        return `ID:${a.accused_id} | Name:${a.name} | Age:${a.age} | Gender:${a.gender} | District:${a.district} | Risk:${a.risk_score} | Crime:${a.primary_crime} | Occupation:${a.occupation} | MO:${a.modus_operandi}`;
      }).join('\n');
    }

    else if (intent === 'fir_lookup') {
      const firMatch  = message.match(/FIR\/[\w\/]+/i);
      const distMatch = message.match(/\b(bengaluru|mysuru|kalaburagi|ballari|mangaluru|hubballi|vijayapura|belagavi|dakshina|shivamogga|tumakuru)\b/i);
      if (firMatch) {
        rows = await q(app, `SELECT * FROM ${T.FIRS} WHERE fir_number = '${escStr(firMatch[0])}'`);
      } else if (distMatch) {
        rows = (await q(app, `SELECT * FROM ${T.FIRS} WHERE district LIKE '%${escStr(distMatch[1])}%'`)).slice(0, 15);
      } else {
        rows = (await q(app, `SELECT * FROM ${T.FIRS} WHERE status = 'Under Investigation'`)).slice(0, 10);
      }
      context = 'FIR RECORDS:\n' + rows.map(r => {
        const f = flat(r, T.FIRS);
        return `FIR:${f.fir_number} | District:${f.district} | Station:${f.station} | Crime:${f.crime_type} | IPC:${f.ipc_sections} | Status:${f.status} | Date:${f.date_filed} | Victims:${f.victim_count} | MO:${f.mo}`;
      }).join('\n');
    }

    else if (intent === 'victim_lookup') {
      rows = (await q(app, `SELECT * FROM ${T.VICTIMS}`)).slice(0, 15);
      context = 'VICTIM RECORDS:\n' + rows.map(r => {
        const v = flat(r, T.VICTIMS);
        return `ID:${v.victim_id} | FIR:${v.fir_id} | Name:${v.name} | Age:${v.age} | Gender:${v.gender} | District:${v.district} | Occupation:${v.occupation}`;
      }).join('\n');
    }

    else if (intent === 'network_analysis') {
      const [rels, fin, accused] = await Promise.all([
        q(app, `SELECT rel_id, from_id, from_type, to_id, to_type, rel_type, strength, fir_ref FROM ${T.REL}`),
        q(app, `SELECT account_number, bank, linked_accused_id, suspicious_txn_count, total_suspicious_amount, notes FROM ${T.FIN} WHERE flagged = 1`),
        q(app, `SELECT accused_id, name, district, primary_crime, risk_score FROM ${T.ACCUSED} WHERE is_repeat_offender = 1`),
      ]);
      context = 'RELATIONSHIPS:\n' + rels.slice(0, 15).map(r => {
        const x = flat(r, T.REL);
        return `${x.from_id}(${x.from_type}) --[${x.rel_type}]--> ${x.to_id}(${x.to_type}) | Strength:${x.strength} | FIR:${x.fir_ref}`;
      }).join('\n');
      if (fin.length) {
        context += '\n\nFLAGGED ACCOUNTS:\n' + fin.slice(0, 10).map(r => {
          const x = flat(r, T.FIN);
          return `Account:${x.account_number} | Bank:${x.bank} | Linked:${x.linked_accused_id} | Txns:${x.suspicious_txn_count} | Amount:₹${x.total_suspicious_amount} | Notes:${x.notes}`;
        }).join('\n');
      }
      if (accused.length) {
        context += '\n\nACCUSED IN NETWORK:\n' + accused.slice(0, 8).map(r => {
          const a = flat(r, T.ACCUSED);
          return `${a.accused_id} | ${a.name} | Risk:${a.risk_score} | Crime:${a.primary_crime} | District:${a.district}`;
        }).join('\n');
      }
      rows = rels;
    }

    else {
      // pattern_analysis / forecast / general — aggregate everything
      const [firs, accused] = await Promise.all([
        q(app, `SELECT district, crime_type, status, date_filed, victim_count, mo FROM ${T.FIRS}`),
        q(app, `SELECT accused_id, name, risk_score, primary_crime, district, is_repeat_offender FROM ${T.ACCUSED} WHERE is_repeat_offender = 1`),
      ]);

      const byDistrict = {};
      firs.forEach(row => {
        const f = flat(row, T.FIRS);
        const d = f.district   || 'Unknown';
        const t = f.crime_type || 'Other';
        if (!byDistrict[d]) byDistrict[d] = { total: 0, types: {} };
        byDistrict[d].total++;
        byDistrict[d].types[t] = (byDistrict[d].types[t] || 0) + 1;
      });

      const summary = Object.entries(byDistrict)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([d, v]) => {
          const top = Object.entries(v.types).sort((a, b) => b[1] - a[1])[0];
          return `${d}: ${v.total} cases (top: ${top?.[0] || 'N/A'})`;
        }).join('\n');

      context  = `DISTRICT SUMMARY (${firs.length} total FIRs):\n${summary}\n\n`;
      context += `TOP REPEAT OFFENDERS:\n` + accused.slice(0, 8).map(row => {
        const a = flat(row, T.ACCUSED);
        return `${a.accused_id} | ${a.name} | Risk:${a.risk_score} | Crime:${a.primary_crime} | District:${a.district}`;
      }).join('\n');

      rows = firs;
    }

  } catch (e) {
    console.error('FETCH_ERR:', e.message);
    context = '';
  }

  return { context, rowCount: rows.length };
}

// ── UI HELPERS ────────────────────────────────────────────────────────────────
function extractHighlights(reply) {
  const nums   = [...reply.matchAll(/\*\*(\d[\d,]*)\*\*/g)].slice(0, 3);
  const labels = [...reply.matchAll(/\*\*([A-Za-z][\w\s-]{2,18})\*\*/g)].slice(0, 3);
  const colors = ['cyan','red','amber','green'];
  return nums.map((m, i) => ({
    value: m[1],
    label: labels[i]?.[1] || ['Cases','Districts','Accused','FIRs'][i] || 'Count',
    color: colors[i % colors.length],
  }));
}

function getSuggestions(intent) {
  const map = {
    fir_lookup:       ['Who is the accused in this FIR?','What is the current investigation status?','Are there similar cases nearby?'],
    offender_profile: ['Show all FIRs linked to this accused','List co-accused in these cases','What is the risk score?'],
    repeat_offenders: ['Show FIRs for the highest risk offender','Which district has most repeat offenders?','Show financial links for top offenders'],
    network_analysis: ['Show flagged financial accounts','List all accused in this network','Which locations appear most?'],
    pattern_analysis: ['Which district has most unsolved cases?','Show top repeat offenders by risk','Analyse extortion cases'],
    forecast:         ['Show current hotspot districts','List unsolved cases in high risk areas','Which crime type is rising?'],
    victim_lookup:    ['How many victims in this district?','Show repeat victimisation cases','Link victims to accused'],
    general:          ['Show crime statistics by district','List repeat offenders with 4+ cases','Show extortion cases in Vijayapura'],
  };
  return map[intent] || map.general;
}

function getAction(intent) {
  const map = {
    fir_lookup:       { label:'Find similar cases by MO',        query:'Show cases with similar modus operandi'        },
    offender_profile: { label:'Show full network for accused',   query:'Show criminal network and associates'          },
    repeat_offenders: { label:'Risk profile top offender',       query:'Show complete profile of highest risk offender'},
    network_analysis: { label:'Trace financial money trail',     query:'Show flagged financial accounts and transactions'},
    pattern_analysis: { label:'Show unsolved high-risk cases',   query:'List all unsolved murder and extortion cases'  },
    forecast:         { label:'View active hotspot districts',   query:'Show districts with most active open cases'    },
    general:          { label:'Run full pattern analysis',       query:'Show crime pattern analysis across all districts'},
  };
  return map[intent] || map.general;
}

function getAlert(reply) {
  const r = reply.toLowerCase();
  if (/unsolved.*murder|murder.*unsolved/.test(r)) return 'Unsolved murder detected — escalate to senior IO immediately';
  if (/risk.*\b(8[5-9]|9\d|100)\b/.test(r))       return 'Extreme risk offender identified — recommend immediate surveillance';
  if (/gang|organised crime/.test(r))              return 'Organised crime network detected — coordinate with Special Branch';
  if (/arms act|weapon|explosive/.test(r))         return 'Arms Act violation — notify District Armed Reserve';
  return null;
}

// ── ROLE PERMISSIONS ──────────────────────────────────────────────────────────
const ROLE_PERMISSIONS = {
  admin:        ['dashboard','chat','analytics','network','profiler','forecast','settings','user_management'],
  supervisor:   ['dashboard','chat','analytics','network','profiler','forecast','settings'],
  investigator: ['dashboard','chat','network','profiler'],
  analyst:      ['dashboard','chat','analytics','forecast'],
  policymaker:  ['dashboard','analytics','forecast'],
};

// ── WRITE AUDIT LOG ───────────────────────────────────────────────────────────
async function writeAuditLog(app, userId, action, resourceType, queryText, ip) {
  try {
    const log_id = `LOG-${Date.now()}`;
    const safeUid = escStr(userId), safeAction = escId(action), safeRes = escId(resourceType);
    const safeQuery = escStr(queryText || ''), safeIp = escStr(ip || '');
    await q(app,
      `INSERT INTO ${T.AUDIT} (log_id, user_id, action, resource_type, query_text, ip_address) VALUES ('${log_id}', '${safeUid}', '${safeAction}', '${safeRes}', '${safeQuery}', '${safeIp}')`
    );
  } catch (e) {
    // Audit logging is non-critical — ignore errors
    console.log('Audit log skip:', e.message);
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────
module.exports = async (context, basicIO) => {
  const res = basicIO?.response || context?.res || context?.response;
  const req  = basicIO?.request  || context?.req || context?.request;

  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).send('');

  try {
    const body   = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const isChatRequest = body.message && (!body.action || body.action === 'chat');
    const action = isChatRequest ? 'chat' : (body.action || 'role');

    // Init Catalyst SDK
    const app = catalyst.initialize(context.req || context);

    // ══════════════════════════════════════════════════════════════════════════
    // CHAT ACTION — Data Store → RAG → structured response
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'chat') {
      const { message, language = 'en', history = [], user: reqUser = {} } = body;
      if (!message) return res.status(400).json({ error: 'message required' });

      const intent = detectIntent(message);
      console.log('INTENT:', intent, '| MSG:', message.slice(0, 60));

      // 1. Query Data Store for context
      let dbContext = '';
      let rowCount  = 0;
      try {
        const fetched = await fetchRelevantData(app, intent, message);
        dbContext = fetched.context;
        rowCount  = fetched.rowCount;
        console.log('DB_ROWS:', rowCount, '| CTX_LEN:', dbContext.length);
      } catch (e) {
        console.error('DB_FETCH_FAILED:', e.message);
      }

      // 2. Async audit log (non-blocking)
      writeAuditLog(app, reqUser?.id || 'anonymous', 'CHAT_QUERY', 'chat', message, 'web').catch(() => {});

      // 3. Build RAG query with real DB data
      let ragQuery = SYSTEM_INTRO + '\n\n';
      if (dbContext) ragQuery += 'LIVE DATABASE DATA:\n' + dbContext.slice(0, 2000) + '\n\n';
      if (language === 'kn') ragQuery += 'Respond in Kannada (ಕನ್ನಡ).\n';
      ragQuery += `Question: ${message}`;
      console.log('RAG_QUERY_LEN:', ragQuery.length);

      // 4. Get OAuth token & call RAG
      const token = await getFreshToken(app);
      const ragResult = await httpsPost(
        'api.catalyst.zoho.in',
        `/quickml/v1/project/${PROJECT_ID}/rag/answer`,
        {
          'Content-Type':  'application/json',
          'Authorization': `Zoho-oauthtoken ${token}`,
          'CATALYST-ORG':  CATALYST_ORG,
        },
        { query: ragQuery, documents: [DOC_ID] }
      );

      console.log('RAG_STATUS:', ragResult.status);
      if (ragResult.status !== 'success') throw new Error('RAG failed: ' + JSON.stringify(ragResult));

      const reply = ragResult.response || ragResult.answer || 'No answer returned.';

      return res.status(200).json({
        reply,
        intent,
        highlights:  extractHighlights(reply),
        suggestions: getSuggestions(intent),
        action:      getAction(intent),
        alert:       getAlert(reply),
        sources:     dbContext
          ? [`Data Store (${rowCount} records)`, 'Karnataka FIR Knowledge Base']
          : ['Karnataka FIR Knowledge Base'],
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ANALYTICS ACTION — aggregate FIRs + Accused for charts
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'analytics') {
      const [firRows, accusedRows] = await Promise.all([
        q(app, `SELECT crime_type, district, status, date_filed, victim_count FROM ${T.FIRS} LIMIT 500`),
        q(app, `SELECT accused_id, name, risk_score, primary_crime, is_repeat_offender, gender, age, economic_status FROM ${T.ACCUSED} LIMIT 500`),
      ]);

      const firs    = firRows.map(r => flat(r, T.FIRS));
      const accused = accusedRows.map(r => flat(r, T.ACCUSED));

      const typeCounts   = {};
      const distCounts   = {};
      const distTopCrime = {};
      const statusCounts = {};
      const monthCounts  = {};

      firs.forEach(f => {
        const cat  = f.crime_type || 'Other';
        const dist = f.district   || 'Unknown';
        const st   = f.status     || 'Unknown';
        typeCounts[cat]      = (typeCounts[cat]      || 0) + 1;
        distCounts[dist]     = (distCounts[dist]     || 0) + 1;
        statusCounts[st]     = (statusCounts[st]     || 0) + 1;
        if (!distTopCrime[dist]) distTopCrime[dist] = {};
        distTopCrime[dist][cat] = (distTopCrime[dist][cat] || 0) + 1;
        if (f.date_filed) {
          try {
            const mon = new Date(f.date_filed).toLocaleString('en', { month: 'short' });
            monthCounts[mon] = (monthCounts[mon] || 0) + 1;
          } catch {}
        }
      });

      // Socio-demographic from Accused table
      const ageGroups   = { '18–25': 0, '26–35': 0, '36–45': 0, '46+': 0 };
      let   maleCount   = 0;
      let   femaleCount = 0;
      accused.forEach(a => {
        const age = Number(a.age);
        if (age >= 18 && age <= 25) ageGroups['18–25']++;
        else if (age >= 26 && age <= 35) ageGroups['26–35']++;
        else if (age >= 36 && age <= 45) ageGroups['36–45']++;
        else if (age > 45) ageGroups['46+']++;
        const g = (a.gender || '').toLowerCase();
        if (g === 'male')   maleCount++;
        else if (g === 'female') femaleCount++;
      });
      const totalGender = maleCount + femaleCount || 1;

      const months      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const sortedTypes = Object.entries(typeCounts).sort((a,b) => b[1]-a[1]).slice(0, 10);
      const statusColors= {'Open':'#f97316','Under Investigation':'#3b82f6','Charge Sheet Filed':'#8b5cf6','Closed':'#22c55e','Pending Trial':'#eab308'};

      const repeatCount     = accused.filter(a => Number(a.is_repeat_offender) === 1).length;
      const totalVictims    = firs.reduce((s, f) => s + (Number(f.victim_count) || 0), 0);

      return res.status(200).json({
        crimeTypes: { labels: sortedTypes.map(([k]) => k), data: sortedTypes.map(([,v]) => v) },
        timeline:   { labels: months, data: months.map(m => monthCounts[m] || 0) },
        districts:  Object.entries(distCounts).sort((a,b) => b[1]-a[1]).map(([name, cases]) => ({
          name, cases,
          top: Object.entries(distTopCrime[name] || {}).sort((a,b) => b[1]-a[1])[0]?.[0] || 'N/A',
          pct: Math.round((cases / (firs.length || 1)) * 100),
        })),
        status: Object.entries(statusCounts).map(([label, value]) => ({
          label, value, color: statusColors[label] || '#64748b'
        })),
        socio: [
          { label:'Age 18–25', value: Math.round((ageGroups['18–25']/(accused.length||1))*100), color:'#ef4444' },
          { label:'Age 26–35', value: Math.round((ageGroups['26–35']/(accused.length||1))*100), color:'#f97316' },
          { label:'Age 36–45', value: Math.round((ageGroups['36–45']/(accused.length||1))*100), color:'#eab308' },
          { label:'Age 46+',   value: Math.round((ageGroups['46+']  /(accused.length||1))*100), color:'#22c55e' },
        ],
        gender: {
          male:   Math.round((maleCount   / totalGender) * 100),
          female: Math.round((femaleCount / totalGender) * 100),
        },
        stats: {
          total_firs:     firs.length,
          total_accused:  accused.length,
          repeat_offenders: repeatCount,
          total_victims:  totalVictims,
          unsolved:       (statusCounts['Open'] || 0) + (statusCounts['Under Investigation'] || 0),
        },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // NETWORKS ACTION
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'networks') {
      const [accusedRows, relRows, finRows] = await Promise.all([
        q(app, `SELECT accused_id, name, risk_score, primary_crime, district, is_repeat_offender FROM ${T.ACCUSED} LIMIT 100`),
        q(app, `SELECT rel_id, from_id, from_type, to_id, to_type, rel_type, strength, fir_ref FROM ${T.REL} LIMIT 200`),
        q(app, `SELECT account_number, bank, linked_accused_id, flagged, suspicious_txn_count, total_suspicious_amount, notes FROM ${T.FIN} WHERE flagged = 1 LIMIT 30`),
      ]);

      const accused = accusedRows.map(r => flat(r, T.ACCUSED));
      const rels    = relRows.map(r => flat(r, T.REL));
      const fin     = finRows.map(r => flat(r, T.FIN));

      return res.status(200).json({
        nodes: accused.map(a => ({
          id:      a.accused_id,
          name:    a.name,
          group:   Number(a.risk_score) >= 80 ? 'High Risk' : Number(a.risk_score) >= 60 ? 'Medium Risk' : 'Low Risk',
          risk:    Number(a.risk_score),
          crime:   a.primary_crime,
          district:a.district,
          repeat:  Number(a.is_repeat_offender) === 1,
        })),
        links: rels.map(r => ({
          source:   r.from_id,
          target:   r.to_id,
          type:     r.rel_type,
          strength: r.strength,
          fir_ref:  r.fir_ref,
        })),
        financial: fin.map(f => ({
          account: f.account_number,
          bank:    f.bank,
          accused: f.linked_accused_id,
          txns:    Number(f.suspicious_txn_count)    || 0,
          amount:  Number(f.total_suspicious_amount) || 0,
          notes:   f.notes,
        })),
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // PROFILER ACTION
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'profiler') {
      const search    = escStr(body.search || '');
      const accusedRows = search
        ? await q(app, `SELECT * FROM ${T.ACCUSED} WHERE name LIKE '%${search}%' OR accused_id LIKE '%${search}%' OR district LIKE '%${search}%' LIMIT 50`)
        : await q(app, `SELECT * FROM ${T.ACCUSED} ORDER BY risk_score DESC LIMIT 100`);

      const accused = accusedRows.map(r => flat(r, T.ACCUSED));

      // Fetch FIR_Accused links and FIRs in one batch for top 20 accused
      const top20   = accused.slice(0, 20);
      const firAccRows = await q(app, `SELECT fir_id, accused_id, role_in_crime, arrest_status FROM ${T.FIR_ACC} LIMIT 500`);
      const firAccMap  = {};
      firAccRows.forEach(r => {
        const fa = flat(r, T.FIR_ACC);
        if (!firAccMap[fa.accused_id]) firAccMap[fa.accused_id] = [];
        firAccMap[fa.accused_id].push(fa);
      });

      // Get all FIR ids referenced by these accused
      const allFirIds = [...new Set(firAccRows.map(r => flat(r, T.FIR_ACC).fir_id).filter(Boolean))];
      let   firMap    = {};
      if (allFirIds.length > 0) {
        const firRows = await q(app, `SELECT fir_id, fir_number, crime_type, status, date_filed, district FROM ${T.FIRS} LIMIT 500`);
        firRows.forEach(r => {
          const f = flat(r, T.FIRS);
          firMap[f.fir_id] = f;
        });
      }

      const profiles = top20.map(a => {
        const links  = firAccMap[a.accused_id] || [];
        const myFirs = links.map(fa => firMap[fa.fir_id]).filter(Boolean);
        return {
          ...a,
          risk_score:         Number(a.risk_score)         || 0,
          is_repeat_offender: Number(a.is_repeat_offender) || 0,
          fir_count:          myFirs.length,
          firs:               myFirs.slice(0, 5).map(f => ({
            number: f.fir_number,
            crime:  f.crime_type,
            status: f.status,
            date:   f.date_filed,
          })),
        };
      });

      return res.status(200).json({ profiles });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // FORECAST ACTION — district-level hotspot data from real FIRs
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'forecast') {
      const firRows  = await q(app, `SELECT district, crime_type, status, lat, lng FROM ${T.FIRS} LIMIT 500`);
      const firs     = firRows.map(r => flat(r, T.FIRS));

      // District coordinate fallback
      const distCoords = {
        'Bengaluru Urban':  { lat: 12.9716, lng: 77.5946 },
        'Mysuru':           { lat: 12.2958, lng: 76.6394 },
        'Belagavi':         { lat: 15.8497, lng: 74.4977 },
        'Kalaburagi':       { lat: 17.3297, lng: 76.8343 },
        'Hubballi-Dharwad': { lat: 15.3647, lng: 75.1240 },
        'Vijayapura':       { lat: 16.8302, lng: 75.7100 },
        'Ballari':          { lat: 15.1394, lng: 76.9214 },
        'Shivamogga':       { lat: 13.9299, lng: 75.5681 },
        'Mangaluru':        { lat: 12.8698, lng: 74.8426 },
        'Tumakuru':         { lat: 13.3379, lng: 77.1017 },
        'Bengaluru Rural':  { lat: 13.1,    lng: 77.4    },
        'Dakshina Kannada': { lat: 12.8698, lng: 75.0    },
      };

      const byDist = {};
      firs.forEach(f => {
        const d = f.district || 'Unknown';
        if (!byDist[d]) byDist[d] = { count: 0, crimes: {}, lat: null, lng: null };
        byDist[d].count++;
        const c = f.crime_type || 'Other';
        byDist[d].crimes[c] = (byDist[d].crimes[c] || 0) + 1;
        // Use actual lat/lng if present
        if (f.lat && !byDist[d].lat) { byDist[d].lat = Number(f.lat); byDist[d].lng = Number(f.lng); }
      });

      const maxCases = Math.max(...Object.values(byDist).map(v => v.count), 1);
      const hotspots = Object.entries(byDist)
        .filter(([d]) => distCoords[d] || true)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([name, v], i) => {
          const coords = distCoords[name] || { lat: 14.5, lng: 76.0 };
          const score  = Math.round((v.count / maxCases) * 100);
          const risk   = score >= 80 ? 'CRITICAL' : score >= 60 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
          const topCrimes = Object.entries(v.crimes).sort((a,b) => b[1]-a[1]).slice(0,2).map(([c]) => c);
          return {
            id:        i + 1,
            name:      name,
            district:  name,
            lat:       v.lat || coords.lat,
            lng:       v.lng || coords.lng,
            risk,
            score,
            crimes:    topCrimes,
            trend:     `+${Math.round(score * 0.2)}%`,
            predicted: Math.round(v.count * 0.15),
          };
        });

      return res.status(200).json({ hotspots });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DASHBOARD ACTION — live stats
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'dashboard') {
      const [firRows, accusedRows, victimRows] = await Promise.all([
        q(app, `SELECT status, crime_type, district FROM ${T.FIRS} LIMIT 1000`),
        q(app, `SELECT accused_id, is_repeat_offender FROM ${T.ACCUSED} LIMIT 1000`),
        q(app, `SELECT victim_id FROM ${T.VICTIMS} LIMIT 1000`),
      ]);

      const firs    = firRows.map(r => flat(r, T.FIRS));
      const accused = accusedRows.map(r => flat(r, T.ACCUSED));

      const openCases      = firs.filter(f => f.status === 'Open' || f.status === 'Under Investigation').length;
      const repeatOffenders = accused.filter(a => Number(a.is_repeat_offender) === 1).length;
      const chargesheeted  = firs.filter(f => f.status === 'Charge Sheet Filed').length;

      return res.status(200).json({
        stats: {
          total_firs:       firs.length,
          open_cases:       openCases,
          repeat_offenders: repeatOffenders,
          chargesheeted,
          total_accused:    accused.length,
          total_victims:    victimRows.length,
        },
      });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CASES ACTION — filter FIRs
    // ══════════════════════════════════════════════════════════════════════════
    if (action === 'cases') {
      const { district, status, crime_type, limit = 50 } = body;
      const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
      let zcqlStr   = `SELECT * FROM ${T.FIRS}`;
      const conds   = [];
      if (district)   conds.push(`district = '${escStr(district)}'`);
      if (status)     conds.push(`status = '${escStr(status)}'`);
      if (crime_type) conds.push(`crime_type = '${escStr(crime_type)}'`);
      if (conds.length) zcqlStr += ` WHERE ${conds.join(' AND ')}`;
      zcqlStr += ` LIMIT ${safeLimit}`;
      const firs = await q(app, zcqlStr);
      return res.status(200).json({ cases: firs.map(r => flat(r, T.FIRS)) });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DEFAULT — role + permissions check
    // ══════════════════════════════════════════════════════════════════════════
    let role = 'investigator';
    try {
      const cu = await app.userManagement().getCurrentUser();
      if (cu) {
        const uid   = escStr(cu.user_id || cu.userId);
        const email = escStr(cu.email_id || cu.emailId || '');
        let profileRows = await q(app,
          `SELECT role FROM ${T.USERS} WHERE user_id = '${uid}' LIMIT 1`
        );
        if (!profileRows.length) {
          profileRows = await q(app,
            `SELECT role FROM ${T.USERS} WHERE email = '${email}' LIMIT 1`
          );
        }
        if (profileRows.length) {
          role = flat(profileRows[0], T.USERS).role || 'investigator';
        }
      }
    } catch (e) {
      console.log('Role lookup failed, using default:', e.message);
    }

    return res.status(200).json({
      authorized:  true,
      role,
      permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.investigator,
    });

  } catch (err) {
    console.error('AUTH_ROLE_ERROR:', err.message, err.stack?.slice(0, 300));
    return res.status(500).json({
      reply:       'Intelligence database temporarily unavailable. Please retry.',
      error:       err.message,
      intent:      'general',
      highlights:  [],
      suggestions: ['Show repeat offenders', 'Crime stats by district', 'List extortion cases'],
      action:      { label: 'Try again', query: 'Show top repeat offenders in Karnataka' },
      alert:       null,
      sources:     [],
    });
  }
};