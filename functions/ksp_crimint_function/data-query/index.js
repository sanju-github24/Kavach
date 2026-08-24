/**
 * data-query — KAVACH Data Store v7.0 (official ERD schema)
 *
 * Queries the Police FIR System ERD (backend/schema.sql, Section 1) plus the
 * application extension tables (Section 2: UserProfiles, AuditLogs,
 * Relationships, FinancialAccounts). Response JSON shapes are kept identical
 * to v5.0/v6.0 (the flat 8-table schema) so the frontend pages built against
 * those contracts (Analytics, Network, Profiler, Forecast, Sociological,
 * Financial, DashboardHome) did not need to change — only the SQL/joins
 * feeding them did.
 *
 * MODELLING NOTE: the ERD has no risk_score, is_repeat_offender, or
 * education/economic_status columns on Accused — those are derived here
 * (see _lib/dataAccess.js) from case gravity + a same-name repeat-case count,
 * which is an approximation given the ERD has no cross-case person identity.
 */
const catalyst = require('zcatalyst-sdk-node');
const { escStr } = require('../_lib/sanitize');
const { flat, flatAll, loadLookups, qAll, denormalizeCase, computeAccusedProfiles, ageBand, loadIntelCases } = require('../_lib/dataAccess');
const { canSeeIdentities, maskRecords, maskPerson: maskPersonName } = require('../_lib/privacy');
const { classifyObject, linkCases } = require('../_lib/evidence');
const { extractMO, timeBandOf, groupMOPatterns, monthlySeries, holtWinters, detectAnomalies, buildLiveAlerts, computeSpotlights } = require('../_lib/intel');

// ─────────────────────────────────────────────────────────────────────────────
// ZCQL HELPER
// ─────────────────────────────────────────────────────────────────────────────
async function q(app, query, timeoutMs = 8000) {
  console.log('ZCQL:', query.slice(0, 100));
  try {
    const rows = await Promise.race([
      app.zcql().executeZCQLQuery(query),
      new Promise((_, rej) => setTimeout(() => rej(new Error('ZCQL_TIMEOUT')), timeoutMs)),
    ]) || [];
    console.log('ROWS:', rows.length);
    return rows;
  } catch (e) {
    console.error('ZCQL_ERR:', e.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FALLBACK DATA — unchanged from v6.0, returned when DB is unreachable
// ─────────────────────────────────────────────────────────────────────────────
// Returned ONLY if the live Data Store is unreachable. Deliberately EMPTY —
// never fabricated/hardcoded/random numbers — so the UI shows an honest
// "no data" state instead of fake figures. Every real value comes from the
// Data Store via the computed actions below.
function fallback(action) {
  const empty = {
    analytics:    { crimeTypes:{labels:[],data:[]}, districts:[], status:[], timeline:{labels:[],data:[]}, socio:[], gender:{male:0,female:0}, heatmap:{crimes:[],statuses:[],data:[]}, calendar:[], scatter:[], radar:{indicators:[],series:[]}, stats:{} },
    networks:     { nodes:[], links:[], financial:[] },
    profiler:     { profiles:[] },
    forecast:     { hotspots:[] },
    dashboard:    { stats:{} },
    sociological: { ageBands:[], crimes:[], ageCrimeHeatmap:[], religionCrime:[], casteDistribution:[], occupationDistribution:[], districtDensity:[], correlations:{}, gender:{}, totalAccused:0 },
    financial:    { nodes:[], edges:[], sankey:[], stats:{} },
  };
  return empty[action] || {};
}

// ─────────────────────────────────────────────────────────────────────────────
// QUICKML PREDICTION
// The deployed risk pipeline is reached over REST rather than through the SDK,
// which does not send the CATALYST-ORG / Environment headers the endpoint
// requires. Token flow mirrors the QuickML RAG calls in chat-query.
// ─────────────────────────────────────────────────────────────────────────────
const QML_PROJECT_ID = '47756000000013047';
const QML_ORG        = '60073493322';
let _qmlTok = null, _qmlExp = 0;

function httpsPostJson(hostname, path, headers, payload, ms = 15000) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const req = https.request({ hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ _raw: data, _status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(ms, () => { req.destroy(new Error('quickml timeout')); });
    req.write(body); req.end();
  });
}

async function qmlToken() {
  if (_qmlTok && Date.now() < _qmlExp - 60000) return _qmlTok;
  const p = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    scope: 'QuickML.deployment.READ',
  });
  const r = await httpsPostJson('accounts.zoho.in', '/oauth/v2/token',
    { 'Content-Type': 'application/x-www-form-urlencoded' }, p.toString());
  if (!r.access_token) throw new Error('QuickML token failed: ' + JSON.stringify(r).slice(0, 200));
  _qmlTok = r.access_token;
  _qmlExp = Date.now() + ((r.expires_in || 3600) * 1000);
  return _qmlTok;
}

async function quickmlPredict(endpointKey, data) {
  const token = await qmlToken();
  return httpsPostJson('api.catalyst.zoho.in',
    `/quickml/v1/project/${QML_PROJECT_ID}/endpoints/predict?explainModel=true`,
    {
      'Content-Type': 'application/json',
      'Authorization': `Zoho-oauthtoken ${token}`,
      'X-QUICKML-ENDPOINT-KEY': endpointKey,
      'CATALYST-ORG': QML_ORG,
      'Environment': 'Development',
    },
    { data });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (context, basicIO) => {
  basicIO.response.set('Access-Control-Allow-Origin',  '*');
  basicIO.response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (basicIO.request.method === 'OPTIONS') return basicIO.response.status(200).send('');

  const body   = typeof basicIO.request.body === 'string' ? JSON.parse(basicIO.request.body) : basicIO.request.body;
  const action = body?.action;
  // Identities are visible by default — masking them silently by role made the
  // product look broken rather than careful. Protection is now an explicit,
  // operator-controlled mode: pass maskPii:true (see _lib/privacy.js) to reduce
  // personal identifiers to initials, e.g. when briefing or screen-sharing.
  const viewerRole = String(body?.role || body?.user?.role || '').toLowerCase();
  const showIds = body?.maskPii !== true;
  if (!action) return basicIO.response.status(400).json({ error: 'action required' });

  let app = null;
  try { app = catalyst.initialize(context.req || context); console.log('SDK: OK'); }
  catch (e) { console.error('SDK_FAIL:', e.message); }

  if (!app) { console.warn('SDK unavailable — fallback for', action); return basicIO.response.status(200).json(fallback(action)); }

  const parseJ = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

  // ── CHAT & BRIEFING HISTORY — no lookups needed, handled before the main
  // try block so a Data Store hiccup elsewhere can't affect these. ──────────
  try {
    if (action === 'chat_sessions') {
      const userId = escStr(body.userId || '');
      if (!userId) return basicIO.response.status(200).json({ sessions: [] });
      const rows = await q(app, `SELECT session_id, title, message_count, created_at, updated_at FROM ChatSessions WHERE user_id = '${userId}' ORDER BY updated_at DESC LIMIT 100`);
      return basicIO.response.status(200).json({ sessions: flatAll(rows, 'ChatSessions') });
    }

    if (action === 'chat_session_messages') {
      const sessionId = escStr(body.sessionId || '');
      if (!sessionId) return basicIO.response.status(200).json({ messages: [] });
      const rows = await qAll(app, q, `SELECT message_id, sender, text, intent, confidence, reasoning, highlights, suggestions, action, alert, evidence, created_at FROM ChatMessages WHERE session_id = '${sessionId}' ORDER BY created_at ASC`);
      const messages = flatAll(rows, 'ChatMessages').map(m => ({
        sender: m.sender, text: m.text, intent: m.intent, confidence: m.confidence,
        reasoning: parseJ(m.reasoning, []), highlights: parseJ(m.highlights, []),
        suggestions: parseJ(m.suggestions, []), action: parseJ(m.action, null),
        alert: m.alert || null, evidence: parseJ(m.evidence, []),
        timestamp: new Date(m.created_at).getTime() || Date.now(),
      }));
      return basicIO.response.status(200).json({ messages });
    }

    if (action === 'chat_session_delete') {
      const sessionId = escStr(body.sessionId || '');
      if (!sessionId) return basicIO.response.status(400).json({ error: 'sessionId required' });
      await q(app, `DELETE FROM ChatMessages WHERE session_id = '${sessionId}'`);
      await q(app, `DELETE FROM ChatSessions WHERE session_id = '${sessionId}'`);
      return basicIO.response.status(200).json({ deleted: true });
    }

    if (action === 'briefings_list') {
      const userId = escStr(body.userId || '');
      if (!userId) return basicIO.response.status(200).json({ briefings: [] });
      const rows = await q(app, `SELECT briefing_id, scope, generated_by, confidence, created_at FROM Briefings WHERE user_id = '${userId}' ORDER BY created_at DESC LIMIT 50`);
      return basicIO.response.status(200).json({ briefings: flatAll(rows, 'Briefings') });
    }

    if (action === 'briefing_get') {
      const briefingId = escStr(body.briefingId || '');
      if (!briefingId) return basicIO.response.status(200).json({ error: 'briefingId required' });
      const rows = await q(app, `SELECT briefing_id, scope, generated_by, confidence, briefing_text, stats, created_at FROM Briefings WHERE briefing_id = '${briefingId}'`);
      if (!rows.length) return basicIO.response.status(200).json({ error: 'Briefing not found — it may have been deleted.' });
      const b = flat(rows[0], 'Briefings');
      const meta = parseJ(b.stats, {});
      return basicIO.response.status(200).json({
        briefingId: b.briefing_id, briefing: b.briefing_text, scope: b.scope,
        generatedBy: b.generated_by, confidence: b.confidence, generatedAt: b.created_at,
        stats: meta.stats || {}, anomalies: meta.anomalies || [], topMO: meta.topMO || [],
        topOffenders: meta.topOffenders || [], forecast: meta.forecast || null,
      });
    }

    if (action === 'briefing_delete') {
      const briefingId = escStr(body.briefingId || '');
      if (!briefingId) return basicIO.response.status(400).json({ error: 'briefingId required' });
      await q(app, `DELETE FROM Briefings WHERE briefing_id = '${briefingId}'`);
      return basicIO.response.status(200).json({ deleted: true });
    }

    // ── ACCUSED PHOTOS — no real mugshots in this dataset, so the UI shows
    // a default poster silhouette and lets an officer attach one manually.
    //
    // PRIMARY storage is Catalyst Stratus (S3-style object storage — the
    // Catalyst-native service for blobs). The image is stored as a real
    // binary object and served to the browser via a short-lived pre-signed
    // GET URL. A legacy chunked-Data-Store path is kept ONLY as an automatic
    // fallback so the feature keeps working if the Stratus bucket hasn't been
    // provisioned yet, and so photos uploaded before this change still load.
    const PHOTO_CHUNK_SIZE = 8000;
    const STRATUS_BUCKET   = process.env.STRATUS_BUCKET || 'kavachmedia';
    const PHOTO_PREFIX     = 'accused-photos/';
    const photoKey  = (id) => PHOTO_PREFIX + id;
    // Stratus bucket operations (list/put/presign) require ADMIN scope — the
    // default user-scoped app throws "user needs to be in session". A separate
    // admin-scoped SDK instance is used only for object storage.
    let _adminApp = null;
    const adminApp = () => (_adminApp ||= catalyst.initialize(context.req || context, { scope: 'admin' }));
    const photoBucket = () => adminApp().stratus().bucket(STRATUS_BUCKET);

    if (action === 'accused_photos_bulk') {
      const ids = (Array.isArray(body.accusedIds) ? body.accusedIds : []).slice(0, 300).map(escStr).filter(Boolean);
      if (!ids.length) return basicIO.response.status(200).json({ photos: {} });
      const photos = {};

      // 1) Stratus (primary): one list call to learn which accused actually
      //    have an object, then a pre-signed GET URL for each hit only.
      try {
        const idSet = new Set(ids);
        const listed = await photoBucket().listPagedObjects({ prefix: PHOTO_PREFIX, maxKeys: '1000' });
        const hits = (listed?.contents || [])
          .map(o => String(o.key || o.key_name || '').slice(PHOTO_PREFIX.length))
          .filter(id => idSet.has(id));
        await Promise.all(hits.map(async id => {
          try {
            const res = await photoBucket().generatePreSignedUrl(photoKey(id), 'GET', { expiryIn: '3600' });
            if (res?.signature) photos[id] = res.signature;
          } catch (_) { /* skip this one */ }
        }));
      } catch (e) { console.log('STRATUS_LIST_SKIP:', e.message); }

      // 2) Legacy chunked Data Store fallback for any ids Stratus didn't cover.
      const missing = ids.filter(id => !photos[id]);
      if (missing.length) {
        try {
          const inList = missing.map(id => `'${id}'`).join(',');
          const rows = await qAll(app, q, `SELECT accused_id, chunk_index, chunk_data FROM AccusedPhotoChunks WHERE accused_id IN (${inList}) ORDER BY accused_id, chunk_index`);
          const byAccused = {};
          flatAll(rows, 'AccusedPhotoChunks').forEach(r => {
            (byAccused[r.accused_id] ??= [])[Number(r.chunk_index)] = r.chunk_data || '';
          });
          Object.entries(byAccused).forEach(([id, chunks]) => { photos[id] = chunks.join(''); });
        } catch (_) { /* neither store available */ }
      }
      return basicIO.response.status(200).json({ photos });
    }

    if (action === 'accused_photo_set') {
      const accusedId = escStr(body.accusedId || '');
      const userId = escStr(body.userId || 'unknown');
      // The base64 alphabet + the fixed "data:image/...;base64," prefix
      // contain no SQL-dangerous characters, so we validate the whole value
      // against this pattern and decode it rather than running it through the
      // generic stripper (which would remove the required ';' and corrupt it).
      const photoData = String(body.photoData || '');
      const match = photoData.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!accusedId || !photoData) return basicIO.response.status(400).json({ error: 'accusedId and photoData required' });
      if (!match || photoData.length > 150000) return basicIO.response.status(400).json({ error: 'Invalid image data — please try uploading again.' });
      const mime   = 'image/' + (match[1] === 'jpg' ? 'jpeg' : match[1]);
      const buffer = Buffer.from(match[2], 'base64');

      // Primary: store the real binary object in Stratus.
      try {
        await photoBucket().putObject(photoKey(accusedId), buffer, { contentType: mime });
        // Drop any stale legacy chunks so the two stores can't disagree.
        try { await app.zcql().executeZCQLQuery(`DELETE FROM AccusedPhotoChunks WHERE accused_id = '${accusedId}'`); } catch (_) {}
        let url = null;
        try { const r = await photoBucket().generatePreSignedUrl(photoKey(accusedId), 'GET', { expiryIn: '3600' }); url = r?.signature || null; } catch (_) {}
        return basicIO.response.status(200).json({ saved: true, storage: 'stratus', url });
      } catch (e) {
        console.error('STRATUS_PUT_ERR:', e.message);
        // Fallback: legacy chunked Data Store (works if the bucket isn't ready).
        try {
          await app.zcql().executeZCQLQuery(`DELETE FROM AccusedPhotoChunks WHERE accused_id = '${accusedId}'`);
          const chunks = [];
          for (let i = 0; i < photoData.length; i += PHOTO_CHUNK_SIZE) chunks.push(photoData.slice(i, i + PHOTO_CHUNK_SIZE));
          for (let i = 0; i < chunks.length; i++) {
            await app.zcql().executeZCQLQuery(
              `INSERT INTO AccusedPhotoChunks (chunk_id,accused_id,chunk_index,chunk_data,uploaded_by) VALUES ('${accusedId}-${i}','${accusedId}',${i},'${chunks[i]}','${userId}')`
            );
          }
          return basicIO.response.status(200).json({ saved: true, storage: 'datastore', chunkCount: chunks.length });
        } catch (e2) {
          console.error('PHOTO_SAVE_ERR:', e2.message);
          return basicIO.response.status(200).json({ error: 'Could not save photo — provision the Stratus bucket "' + STRATUS_BUCKET + '" (or create the AccusedPhotoChunks table).' });
        }
      }
    }

    if (action === 'accused_photo_delete') {
      const accusedId = escStr(body.accusedId || '');
      if (!accusedId) return basicIO.response.status(400).json({ error: 'accusedId required' });
      let deleted = false;
      // Remove from both stores so a fallback copy can't linger.
      try { await photoBucket().deleteObject(photoKey(accusedId)); deleted = true; } catch (e) { console.log('STRATUS_DEL_SKIP:', e.message); }
      try { await app.zcql().executeZCQLQuery(`DELETE FROM AccusedPhotoChunks WHERE accused_id = '${accusedId}'`); deleted = true; } catch (_) {}
      return basicIO.response.status(200).json({ deleted });
    }

    // ── ZIA VISION — Catalyst Zia image intelligence. Three features, each of
    // which ends in analysable data rather than a standalone tool:
    //   ocr_intake        paper FIR   -> structured case fields + entities
    //   face_match        probe photo -> ranked matches in the accused gallery
    //   evidence_analyze  scene photo -> tagged objects (new analytic dimension)
    const _fsV = require('fs'), _osV = require('os'), _pathV = require('path');
    // NOTE: the file EXTENSION matters — form-data derives the upload filename
    // from the stream path, and Zia rejects unrecognised types. Always write
    // with a real image extension taken from the data-URI mime.
    const visionTmp = (b64, tag) => {
      const raw = String(b64 || '');
      const m = raw.match(/^data:image\/([a-zA-Z+]+);base64,/);
      const ext = ((m && m[1]) || 'png').toLowerCase().replace('jpeg', 'jpg');
      const clean = raw.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
      if (!clean) return null;
      const p = _pathV.join(_osV.tmpdir(), `kv_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${['png','jpg','webp','bmp'].includes(ext) ? ext : 'png'}`);
      _fsV.writeFileSync(p, Buffer.from(clean, 'base64'));
      return p;
    };
    const rmTmp = (p) => { try { p && _fsV.unlinkSync(p); } catch (_) {} };
    // Pull a 0-100 similarity out of whatever shape Zia returns for a face pair.
    const faceScore = (d) => {
      if (!d || typeof d !== 'object') return null;
      for (const k of ['confidence', 'similarity', 'match_confidence', 'score']) {
        const v = Number(d[k]);
        if (Number.isFinite(v)) return v > 1 ? v : v * 100;
      }
      return null;
    };
    // Bounded-concurrency map so a large gallery doesn't fire N parallel calls.
    const pool = async (items, n, fn) => {
      const out = []; let i = 0;
      await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (i < items.length) { const idx = i++; try { out[idx] = await fn(items[idx]); } catch (e) { out[idx] = { error: e.message }; } }
      }));
      return out;
    };

    if (action === 'ocr_intake') {
      const tmp = visionTmp(body.imageB64, 'ocr');
      if (!tmp) return basicIO.response.status(400).json({ error: 'imageB64 required' });
      try {
        const zia = adminApp().zia();
        const ocr = await zia.extractOpticalCharacters(_fsV.createReadStream(tmp));
        const text = String(ocr?.text || '').trim();
        if (!text) return basicIO.response.status(200).json({ error: 'no_text_found' });

        // Structured field extraction, validated against both a simple
        // "Label: value" FIR and a real NCRB form. Real forms pack several
        // labels onto ONE line ("District: X   P.S.: Y   Year: 2018") and carry
        // bilingual brackets ("District (जिला):"), so each value is captured
        // lazily and stopped at the next known label or a column gap.
        const LBL = "(?:District|P\\.?\\s?S\\.?|Police\\s*Station|Year|FIR\\s*No|Date\\s*and\\s*Time|Date|Acts?|Sections?|Day|Address|Nationality|Father|Name|Complainant|Informant|Place|Direction|Beat|Type|Offence|Offense|Property|Stolen|Accused|UID|Passport|Occurrence)";
        const STOP = `(?=\\s{2,}|\\s*${LBL}\\b\\s*[\\(:.]|$)`;
        // OCR frequently emits runs of separators ("FIR No.:0019", "P.S:RAIBOGA"),
        // so the label/value divider is a run rather than a single character.
        const SEP = "[\\s:.\\-]*";
        // valueClass must be ONE quantifier-free character class — the pattern
        // appends its own quantifier.
        const rx  = (label, vc = "[^\\n]") => new RegExp(`${label}\\s*(?:\\([^)]*\\))?${SEP}(${vc}+?)${STOP}`, 'i');
        // A whitespace-free token needs no stop-lookahead: it ends at the space.
        const tok = (label, vc) => new RegExp(`${label}\\s*(?:\\([^)]*\\))?${SEP}(${vc}+)`, 'i');
        const grab = (re) => {
          const m = text.match(re);
          return m ? m[1].trim().replace(/\s+/g, ' ').replace(/^[:.\-]+/, '').replace(/[.,;:]+$/, '') : '';
        };
        const NAME = "[A-Za-z0-9 .,'\\-]";
        const fields = {
          fir_number:  grab(tok("FIR\\s*No", "[A-Za-z0-9/\\-]")),
          year:        grab(rx("Year", "[0-9]")),
          district:    grab(rx("District", NAME)),
          station:     grab(rx("(?:P\\.?\\s?S\\.?|Police\\s*Station)", NAME)),
          date_filed:  grab(new RegExp(`Date\\s*(?:and\\s*Time\\s*)?of\\s*FIR${SEP}([0-9]{1,2}[/\\-][0-9]{1,2}[/\\-][0-9]{2,4}(?:\\s+[0-9]{1,2}:[0-9]{2})?)`, 'i')) ||
                       grab(new RegExp(`Date${SEP}([0-9]{1,2}\\s+[A-Za-z]{3,9}\\s+[0-9]{4}|[0-9]{1,2}[/\\-][0-9]{1,2}[/\\-][0-9]{2,4})`, 'i')),
          occurrence:  grab(tok("Date\\s*From", "[0-9/\\-.]")),
          acts:        grab(rx("Acts?", NAME)),
          sections:    grab(rx("Sections?", "[0-9A-Za-z,\\- ]")),
          offence:     grab(rx("(?<!of\\s)(?:Offence|Offense|Crime\\s*Type)")),
          complainant: grab(rx("(?:Complainant\\s*/?\\s*Informant[\\s:.]*(?:\\([^)]*\\))?\\s*(?:\\(?[a-z]\\)?)?\\s*Name|Complainant|Informant)", NAME)),
          address:     grab(rx("Present\\s*Address")) || grab(rx("Address")),
          property:    grab(rx("(?:Property|Stolen|Articles)")),
        };

        // Zia NER on the same text so people/places/dates are tagged even when
        // the document doesn't follow the standard FIR label layout.
        let entities = [];
        try {
          const ner = await adminApp().zia().getNERPrediction([text]);
          entities = ner?.entities?.[0]?.ner?.general_entities || [];
        } catch (e) { console.log('OCR_NER_SKIP:', e.message); }

        return basicIO.response.status(200).json({
          text, confidence: ocr?.confidence ?? null, fields, entities,
          extractedCount: Object.values(fields).filter(Boolean).length,
          fieldCount: Object.keys(fields).length,
        });
      } catch (e) {
        console.error('OCR_ERR:', e.message);
        return basicIO.response.status(200).json({ error: 'ocr_unavailable', detail: e.message });
      } finally { rmTmp(tmp); }
    }

    if (action === 'evidence_analyze') {
      const tmp = visionTmp(body.imageB64, 'obj');
      if (!tmp) return basicIO.response.status(400).json({ error: 'imageB64 required' });
      try {
        const res = await adminApp().zia().detectObject(_fsV.createReadStream(tmp));
        const objects = (res?.objects || []).map(o => ({
          name: String(o.object_type || o.name || o.label || '').toLowerCase(),
          confidence: Number(o.confidence ?? o.score ?? 0),
        })).filter(o => o.name);

        // ── Turn tags into intelligence ──────────────────────────────────────
        // A label on its own tells an officer nothing they cannot see. Each
        // detected object is cross-referenced against the case corpus (crime
        // type + MO narrative) so the answer becomes "this evidence type
        // appears in N past cases, concentrated in these districts" — a lead,
        // and a new dimension the analytics can slice on.
        let corpus = [];
        try {
          const lookups = await loadLookups(app, q);
          corpus = await loadIntelCases(app, q, lookups);
        } catch (e) { console.log('EVIDENCE_CORPUS_SKIP:', e.message); }

        const linked = objects.map(o => {
          const cls = classifyObject(o.name);
          if (!cls || !cls.probative) {
            return { ...o, probative: false, caseCount: 0, topDistricts: [], topCrimes: [], sampleCases: [] };
          }
          const { hits, via } = linkCases(cls, corpus);
          const byDistrict = {}, byCrime = {};
          hits.forEach(h => {
            byDistrict[h.district]   = (byDistrict[h.district] || 0) + 1;
            byCrime[h.crime_type]    = (byCrime[h.crime_type] || 0) + 1;
          });
          const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([name, count]) => ({ name, count }));
          return {
            ...o,
            probative: true,
            evidenceClass: cls.label,
            matchedVia: via,
            caseCount: hits.length,
            topDistricts: top(byDistrict),
            topCrimes: top(byCrime),
            sampleCases: hits.slice(0, 4).map(h => ({
              fir_number: h.fir_number, crime: h.crime_type, district: h.district, date: h.date_filed,
            })),
          };
        });

        return basicIO.response.status(200).json({
          objects: linked, count: linked.length, corpusSize: corpus.length,
        });
      } catch (e) {
        console.error('OBJ_ERR:', e.message);
        return basicIO.response.status(200).json({ error: 'object_detection_unavailable', detail: e.message });
      } finally { rmTmp(tmp); }
    }

    if (action === 'face_match') {
      const probe = visionTmp(body.imageB64, 'probe');
      if (!probe) return basicIO.response.status(400).json({ error: 'imageB64 required' });
      const limit = Math.min(Number(body.limit) || 40, 100);
      const tmps = [];
      try {
        const zia = adminApp().zia();

        // Confirm the probe actually contains a face before comparing against
        // the whole gallery — otherwise every comparison fails identically and
        // the officer gets no useful reason why.
        try {
          const fa = await zia.analyseFace(_fsV.createReadStream(probe));
          const faces = fa?.faces ?? fa?.face_details ?? fa;
          const n = Array.isArray(faces) ? faces.length : (faces && typeof faces === 'object' ? 1 : 0);
          if (!n) return basicIO.response.status(200).json({ matches: [], comparedCount: 0, note: 'no_face_in_probe' });
        } catch (e) { console.log('FACE_PROBE_SKIP:', e.message); }

        // ── Build the gallery ────────────────────────────────────────────────
        // Photos live in Stratus when a real session is available and in the
        // chunked Data Store otherwise (the same fallback the upload path
        // uses), so the gallery is assembled from whichever store has them.
        const gallery = []; // { id, path }
        let gallerySource = null;
        try {
          const listed = await photoBucket().listPagedObjects({ prefix: PHOTO_PREFIX, maxKeys: '500' });
          const keys = (listed?.contents || [])
            .map(o => String(o.key || o.key_name || ''))
            .filter(k => k.startsWith(PHOTO_PREFIX) && k.length > PHOTO_PREFIX.length)
            .slice(0, limit);
          for (const key of keys) {
            try {
              const signed = await photoBucket().generatePreSignedUrl(key, 'GET', { expiryIn: '600' });
              if (!signed?.signature) continue;
              const resp = await fetch(signed.signature);
              if (!resp.ok) continue;
              const pth = _pathV.join(_osV.tmpdir(), `kv_gal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
              _fsV.writeFileSync(pth, Buffer.from(await resp.arrayBuffer()));
              tmps.push(pth);
              gallery.push({ id: key.slice(PHOTO_PREFIX.length), path: pth });
              gallerySource = 'stratus';
            } catch (_) { /* skip this photo */ }
          }
        } catch (e) { console.log('STRATUS_GALLERY_SKIP:', e.message); }

        if (!gallery.length) {
          try {
            const idRows = await qAll(app, q, 'SELECT accused_id FROM AccusedPhotoChunks');
            const ids = [...new Set(flatAll(idRows, 'AccusedPhotoChunks').map(r => String(r.accused_id)).filter(Boolean))].slice(0, limit);
            if (ids.length) {
              const inList = ids.map(x => `'${escStr(x)}'`).join(',');
              const rows = await qAll(app, q, `SELECT accused_id, chunk_index, chunk_data FROM AccusedPhotoChunks WHERE accused_id IN (${inList}) ORDER BY accused_id, chunk_index`);
              const byAcc = {};
              flatAll(rows, 'AccusedPhotoChunks').forEach(r => {
                (byAcc[r.accused_id] ??= [])[Number(r.chunk_index)] = r.chunk_data || '';
              });
              for (const [id, chunks] of Object.entries(byAcc)) {
                const pth = visionTmp(chunks.join(''), `gal_${id}`);
                if (pth) { tmps.push(pth); gallery.push({ id, path: pth }); gallerySource = 'datastore'; }
              }
            }
          } catch (e) { console.log('DS_GALLERY_SKIP:', e.message); }
        }

        if (!gallery.length) {
          return basicIO.response.status(200).json({ matches: [], comparedCount: 0, note: 'no_gallery_photos' });
        }

        const results = await pool(gallery, 4, async (g) => {
          const cmp = await zia.compareFace(_fsV.createReadStream(probe), _fsV.createReadStream(g.path));
          return { accused_id: g.id, confidence: faceScore(cmp), raw: cmp?.message || null };
        });

        const matches = results
          .filter(r => r && Number.isFinite(r.confidence))
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 10);

        let enrichError = null;
        // ── Enrich the hits with the full offender dossier ──────────────────
        // A ranked similarity score on its own is not actionable; an officer
        // needs to know WHO matched. Each hit is joined to the same profile
        // record the Criminal Profiler shows: identity, district, primary
        // crime, deterministic risk score, repeat history and linked FIRs.
        if (matches.length) {
          try {
            // This action runs before the shared lookups are loaded further
            // down the handler, so load them here rather than capturing an
            // undefined binding.
            const lookups = await loadLookups(app, q);
            const cases = await loadIntelCases(app, q, lookups);
            const firByCaseId = {}; const gravityByCaseId = {};
            cases.forEach(c => { firByCaseId[c.fir_id] = c; gravityByCaseId[c.fir_id] = c.gravity; });
            const accusedRows = await qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused');
            const allAccused = flatAll(accusedRows, 'Accused');
            const profiles = computeAccusedProfiles(allAccused, firByCaseId, gravityByCaseId);

            const byId = {};
            profiles.forEach(pr => { byId[pr.accused_id] = pr; });
            // Every FIR this person appears in, for the dossier timeline.
            const casesByAccusedId = {};
            allAccused.forEach(a => {
              const id = `ACC-${a.AccusedMasterID}`;
              const fir = firByCaseId[a.CaseMasterID];
              if (fir) (casesByAccusedId[id] ??= []).push({
                fir_number: fir.fir_number, crime: fir.crime_type,
                district: fir.district, status: fir.status, date: fir.date_filed,
              });
            });

            matches.forEach(m => {
              const pr = byId[m.accused_id];
              if (!pr) return;
              const firs = casesByAccusedId[m.accused_id] || [];
              Object.assign(m, {
                name:               showIds ? pr.name : maskPersonName(pr.name),
                age:                pr.age,
                gender:             pr.gender,
                district:           pr.district,
                primary_crime:      pr.primary_crime,
                risk_score:         pr.risk_score,
                is_repeat_offender: pr.is_repeat_offender,
                repeat_case_count:  pr.repeat_case_count,
                status:             pr.status,
                fir_number:         pr.fir_number,
                fir_count:          firs.length,
                firs:               firs.slice(0, 6),
              });
            });
          } catch (e) { console.error('FACE_ENRICH_FAIL:', e.message); enrichError = e.message; }
        }

        return basicIO.response.status(200).json({
          matches,
          comparedCount: gallery.length,
          gallerySource, enrichError,
          noFace: !matches.length,
        });
      } catch (e) {
        console.error('FACE_ERR:', e.message);
        return basicIO.response.status(200).json({ error: 'face_match_unavailable', detail: e.message });
      } finally { rmTmp(probe); tmps.forEach(rmTmp); }
    }

    // ── PDF RENDER — server-side report generation via Catalyst SmartBrowz
    // (the Catalyst-native headless-browser service). The frontend sends fully
    // branded HTML and gets back a print-quality PDF, rendered by a real
    // Chromium so CSS/'→'/Kannada glyphs all render correctly (the client-side
    // jsPDF path can't embed Unicode fonts). Returns { error:'smartbrowz_...' }
    // on any failure so the frontend can gracefully fall back to jsPDF.
    if (action === 'pdf_render') {
      const html = String(body.html || '');
      if (!html) return basicIO.response.status(400).json({ error: 'html required' });
      try {
        const stream = await app.smartbrowz().convertToPdf(html, {
          pdf_options: { format: 'A4', print_background: true },
        });
        const chunks = [];
        for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
        const pdfBase64 = Buffer.concat(chunks).toString('base64');
        if (!pdfBase64) throw new Error('empty pdf');
        return basicIO.response.status(200).json({ pdfBase64 });
      } catch (e) {
        console.error('SMARTBROWZ_ERR:', e.message);
        return basicIO.response.status(200).json({ error: 'smartbrowz_unavailable' });
      }
    }

    // ── SPOTLIGHTS — the single most important insight per module page, for
    // the proactive "KAVACH Spotlight" callouts + nav attention badges. One
    // call powers every page; the frontend polls it and diffs the metrics
    // against its last snapshot to show what changed.
    if (action === 'spotlights') {
      try {
        const lookups = await loadLookups(app, q);
        const [cases, accusedRows, caseRows, accRows] = await Promise.all([
          loadIntelCases(app, q, lookups),
          qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
          qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster'),
          q(app, 'SELECT account_id, flagged, total_suspicious_amount FROM FinancialAccounts LIMIT 200').catch(() => []),
        ]);
        const firByCaseId = {}, gravityByCaseId = {};
        flatAll(caseRows, 'CaseMaster').forEach(c => {
          firByCaseId[c.CaseMasterID] = denormalizeCase(c, lookups);
          gravityByCaseId[c.CaseMasterID] = lookups.gravityMap[c.GravityOffenceID];
        });
        const profiles  = computeAccusedProfiles(flatAll(accusedRows, 'Accused'), firByCaseId, gravityByCaseId);
        const moGroups  = groupMOPatterns(cases);
        const anomalies = detectAnomalies(cases);
        const accounts  = flatAll(accRows, 'FinancialAccounts');
        const modules   = computeSpotlights({ cases, profiles, moGroups, anomalies, accounts });
        return basicIO.response.status(200).json({ modules, generatedAt: new Date().toISOString() });
      } catch (e) {
        console.error('SPOTLIGHTS_ERR:', e.message);
        return basicIO.response.status(200).json({ modules: {}, error: 'spotlights_failed' });
      }
    }

    // ── AUTOML TRAINING DATA — builds the CSV used to train the Catalyst Zia
    // AutoML risk-classification model. One row per accused: structured
    // features → a deterministic risk_label (Low/Medium/High) the model learns
    // to predict. The label is rule-derived (repeat history + offence gravity)
    // with NO randomness so it's genuinely learnable; crime-type carries the
    // gravity signal so the model can generalise from the features alone.
    if (action === 'automl_training_csv') {
      try {
        const lookups = await loadLookups(app, q);
        const [accusedRows, caseRows] = await Promise.all([
          qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
          qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster'),
        ]);
        const firByCaseId = {}, gravityByCaseId = {};
        flatAll(caseRows, 'CaseMaster').forEach(c => {
          firByCaseId[c.CaseMasterID] = denormalizeCase(c, lookups);
          gravityByCaseId[c.CaseMasterID] = lookups.gravityMap[c.GravityOffenceID];
        });
        const profiles = computeAccusedProfiles(flatAll(accusedRows, 'Accused'), firByCaseId, gravityByCaseId);
        const labelFor = (p, heinous) => {
          const score = 30 + (Math.max(1, p.repeat_case_count) - 1) * 15 + (heinous ? 20 : 0);
          return score >= 65 ? 'High' : score >= 45 ? 'Medium' : 'Low';
        };
        const clean = (v) => String(v ?? '').replace(/[",\n]/g, ' ').trim();
        const header = ['age', 'gender', 'district', 'primary_crime', 'repeat_case_count', 'is_repeat_offender', 'risk_label'];
        const lines = [header.join(',')];
        const dist = {};
        profiles.forEach(p => {
          const heinous = gravityByCaseId[p.case_id] === 'Heinous';
          const label = labelFor(p, heinous);
          dist[label] = (dist[label] || 0) + 1;
          lines.push([clean(p.age), clean(p.gender), clean(p.district), clean(p.primary_crime), Math.max(1, p.repeat_case_count), p.is_repeat_offender ? 1 : 0, label].join(','));
        });
        return basicIO.response.status(200).json({ csv: lines.join('\n'), rows: profiles.length, distribution: dist });
      } catch (e) {
        console.error('AUTOML_CSV_ERR:', e.message);
        return basicIO.response.status(200).json({ error: 'Could not build training data.' });
      }
    }

    // ── RISK PREDICTION — Catalyst Zia AutoML. Calls the trained risk model
    // (POST /ml/automl/model/{id}) with an accused's structured features and
    // returns the predicted class + per-class confidence. Requires the model
    // to be trained in the Zia console and its id set in ZIA_AUTOML_MODEL_ID;
    // returns { error:'model_not_configured' } until then so the UI can show a
    // setup hint and fall back to the heuristic score.
    if (action === 'predict_risk') {
      // Risk prediction is served by a QuickML pipeline (Datasets -> Pipeline ->
      // Model -> Endpoint), which is a different API from the older Zia AutoML
      // model route: it is called with the endpoint KEY, not a model id.
      const ENDPOINT_KEY = process.env.QUICKML_ENDPOINT_KEY;
      if (!ENDPOINT_KEY) return basicIO.response.status(200).json({ error: 'model_not_configured' });
      const f = body.features || {};
      // The pipeline was trained on these six columns; numerics stay numeric so
      // the model sees the same types it was trained on.
      const features = {
        age:                Number(f.age) || 0,
        gender:             String(f.gender ?? 'Other'),
        district:           String(f.district ?? 'Unknown'),
        primary_crime:      String(f.primary_crime ?? 'Unknown'),
        repeat_case_count:  Number(f.repeat_case_count) || 1,
        is_repeat_offender: Number(f.is_repeat_offender) || 0,
      };
      try {
        // The SDK's quickML().predict() omits the CATALYST-ORG / Environment
        // headers this endpoint requires (ORGID_HEADER_UNAVAILABLE), so call
        // the REST endpoint directly using the same OAuth flow the RAG calls
        // already use elsewhere in this project.
        const res = await quickmlPredict(ENDPOINT_KEY, features);
        // { result: ["High"], likelihood_score: [0.98], explanation: "..." }
        const label = Array.isArray(res?.result) ? res.result[0] : (res?.result ?? null);
        const score = Array.isArray(res?.likelihood_score) ? res.likelihood_score[0] : (res?.likelihood_score ?? null);
        return basicIO.response.status(200).json({
          prediction: {
            label,
            confidence: score == null ? null : (Number(score) > 1 ? Number(score) : Number(score) * 100),
            explanation: res?.explanation ?? null,
          },
          raw: res,
        });
      } catch (e) {
        console.error('QUICKML_PREDICT_ERR:', e.message);
        return basicIO.response.status(200).json({ error: 'automl_unavailable', detail: e.message });
      }
    }

    if (action === 'text_analysis') {
      const docs = (Array.isArray(body.documents) ? body.documents : [])
        .map(d => String(d || '').trim()).filter(Boolean).slice(0, 20);
      if (!docs.length) return basicIO.response.status(400).json({ error: 'documents required' });
      try {
        const zia = app.zia();
        const [keywords, entities, sentiment] = await Promise.all([
          zia.getKeywordExtraction(docs).catch(e => { console.log('ZIA_KW:', e.message); return null; }),
          zia.getNERPrediction(docs).catch(e => { console.log('ZIA_NER:', e.message); return null; }),
          zia.getSentimentAnalysis(docs).catch(e => { console.log('ZIA_SENT:', e.message); return null; }),
        ]);
        if (!keywords && !entities && !sentiment) throw new Error('all Zia calls failed');
        return basicIO.response.status(200).json({ keywords, entities, sentiment });
      } catch (e) {
        console.error('ZIA_ERR:', e.message);
        return basicIO.response.status(200).json({ error: 'zia_unavailable' });
      }
    }
  } catch (err) {
    console.error('HISTORY_ACTION_ERR:', action, err.message);
    return basicIO.response.status(200).json({ error: 'History lookup failed.' });
  }

  try {
    const lookups = await loadLookups(app, q);

    // ── ANALYTICS ────────────────────────────────────────────────────────────
    if (action === 'analytics') {
      const [caseRows, accusedRows, victimRows] = await Promise.all([
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster'),
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
        qAll(app, q, 'SELECT VictimMasterID, CaseMasterID FROM Victim'),
      ]);
      const cases   = flatAll(caseRows, 'CaseMaster');
      const accused = flatAll(accusedRows, 'Accused');
      if (!cases.length) return basicIO.response.status(200).json(fallback(action));

      const firByCaseId = {}; const gravityByCaseId = {};
      cases.forEach(c => {
        firByCaseId[c.CaseMasterID] = denormalizeCase(c, lookups);
        gravityByCaseId[c.CaseMasterID] = lookups.gravityMap[c.GravityOffenceID];
      });
      const allFirs = Object.values(firByCaseId);

      // ── Interactive filtering ────────────────────────────────────────────
      // Every chart below is computed from `firs`, so filtering here makes the
      // whole page cross-filter from a single source of truth. Options come
      // from the UNFILTERED set so the controls never lose their choices.
      const filterOptions = {
        districts:  [...new Set(allFirs.map(f => f.district).filter(Boolean))].sort(),
        crimeTypes: [...new Set(allFirs.map(f => f.crime_type).filter(Boolean))].sort(),
        statuses:   [...new Set(allFirs.map(f => f.status).filter(Boolean))].sort(),
        years:      [...new Set(allFirs.map(f => String(f.date_filed || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort(),
      };
      const F = (body.filters && typeof body.filters === 'object') ? body.filters : {};
      const appliedFilters = {
        district:  F.district  || '',
        crimeType: F.crimeType || '',
        status:    F.status    || '',
        year:      F.year ? String(F.year) : '',
      };
      const firs = allFirs.filter(f =>
        (!appliedFilters.district  || f.district   === appliedFilters.district) &&
        (!appliedFilters.crimeType || f.crime_type === appliedFilters.crimeType) &&
        (!appliedFilters.status    || f.status     === appliedFilters.status) &&
        (!appliedFilters.year      || String(f.date_filed || '').slice(0, 4) === appliedFilters.year)
      );
      const filteredCaseIds = new Set(firs.map(f => String(f.fir_id)));

      // Nothing matched — return an empty-but-valid payload so the page keeps
      // its filter controls instead of erroring out.
      if (!firs.length) {
        return basicIO.response.status(200).json({
          crimeTypes: { labels: [], data: [] }, timeline: { labels: [], data: [] },
          districts: [], status: [], socio: [], gender: { male: 0, female: 0 },
          heatmap: { crimes: [], statuses: [], data: [] }, calendar: [], scatter: [],
          radar: { indicators: [], series: [] },
          stats: { total_firs: 0, total_accused: 0, repeat_offenders: 0, total_victims: 0, unsolved: 0 },
          filterOptions, appliedFilters, empty: true,
        });
      }
      const victimCountByCase = {};
      flatAll(victimRows, 'Victim').forEach(v => { victimCountByCase[v.CaseMasterID] = (victimCountByCase[v.CaseMasterID]||0)+1; });

      const typeCounts = {}, distCounts = {}, distTop = {}, statusCounts = {}, monthCounts = {};
      firs.forEach(f => {
        typeCounts[f.crime_type] = (typeCounts[f.crime_type]||0)+1;
        distCounts[f.district]   = (distCounts[f.district]||0)+1;
        statusCounts[f.status]   = (statusCounts[f.status]||0)+1;
        if (!distTop[f.district]) distTop[f.district] = {};
        distTop[f.district][f.crime_type] = (distTop[f.district][f.crime_type]||0)+1;
        if (f.date_filed) { try { const mon = new Date(f.date_filed).toLocaleString('en',{month:'short'}); monthCounts[mon]=(monthCounts[mon]||0)+1; } catch {} }
      });

      const profiles = computeAccusedProfiles(accused.filter(a => filteredCaseIds.has(String(a.CaseMasterID))), firByCaseId, gravityByCaseId);
      const ageGroups = { '18–25':0,'26–35':0,'36–45':0,'46+':0 };
      let maleCount=0, femaleCount=0;
      profiles.forEach(a => {
        const band = ageBand(a.age); if (ageGroups[band]!=null) ageGroups[band]++;
        if (a.gender==='Male') maleCount++; else if (a.gender==='Female') femaleCount++;
      });

      const totalG = maleCount+femaleCount || 1;
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const sortedTypes = Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
      const statusColors = { 'Under Investigation':'#3b82f6','Charge Sheeted':'#8b5cf6','Convicted':'#22c55e','Acquitted':'#64748b','Closed - FR':'#22c55e','Pending Trial':'#eab308' };
      const repeatCount = profiles.filter(a=>a.is_repeat_offender===1).length;

      const topTypeNames = sortedTypes.slice(0,8).map(([k])=>k);
      const statusNames  = Object.keys(statusCounts);
      const heatmap = [];
      topTypeNames.forEach((crime,ci) => statusNames.forEach((status,si) => {
        heatmap.push([si, ci, firs.filter(f=>f.crime_type===crime && f.status===status).length]);
      }));

      const dateCounts = {};
      firs.forEach(f => { if (f.date_filed) { const d=String(f.date_filed).slice(0,10); dateCounts[d]=(dateCounts[d]||0)+1; } });

      const scatter = profiles.slice(0,300).map(a => [a.age||0, a.risk_score, a.is_repeat_offender]);

      const topDistricts = Object.entries(distCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([d])=>d);
      const maxCases = Math.max(...Object.values(distCounts),1);
      const radar = {
        indicators: [{name:'Case Volume',max:100},{name:'Victims',max:100},{name:'Unsolved %',max:100},{name:'Repeat Offenders',max:100},{name:'Avg Risk',max:100}],
        series: topDistricts.map(d => {
          const distFirs = firs.filter(f=>f.district===d);
          const victims = distFirs.reduce((s,f)=>s+(victimCountByCase[f.fir_id]||0),0);
          const unsolvedPct = Math.round((distFirs.filter(f=>f.status==='Under Investigation'||f.status==='Pending Trial').length/(distFirs.length||1))*100);
          const distAccused = profiles.filter(a=>a.district===d);
          const repeatPct = Math.round((distAccused.filter(a=>a.is_repeat_offender===1).length/(distAccused.length||1))*100);
          const avgRisk = Math.round(distAccused.reduce((s,a)=>s+a.risk_score,0)/(distAccused.length||1))||0;
          const maxV = Math.max(...topDistricts.map(dd => firs.filter(f=>f.district===dd).reduce((s,f)=>s+(victimCountByCase[f.fir_id]||0),0)),1);
          return { name:d, value:[Math.round((distCounts[d]/maxCases)*100), Math.round((victims/maxV)*100), unsolvedPct, repeatPct, avgRisk] };
        }),
      };

      return basicIO.response.status(200).json({
        crimeTypes: { labels: sortedTypes.map(([k])=>k), data: sortedTypes.map(([,v])=>v) },
        timeline: { labels: months, data: months.map(m=>monthCounts[m]||0) },
        districts: Object.entries(distCounts).sort((a,b)=>b[1]-a[1]).map(([name,cases])=>({
          name, cases, top: Object.entries(distTop[name]||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]||'N/A', pct: Math.round((cases/firs.length)*100),
        })),
        status: Object.entries(statusCounts).map(([label,value])=>({ label, value, color: statusColors[label]||'#64748b' })),
        socio: [
          { label:'Age 18–25', value:Math.round((ageGroups['18–25']/(profiles.length||1))*100), color:'#ef4444' },
          { label:'Age 26–35', value:Math.round((ageGroups['26–35']/(profiles.length||1))*100), color:'#f97316' },
          { label:'Age 36–45', value:Math.round((ageGroups['36–45']/(profiles.length||1))*100), color:'#eab308' },
          { label:'Age 46+',   value:Math.round((ageGroups['46+']/(profiles.length||1))*100),   color:'#22c55e' },
        ],
        gender: { male: Math.round((maleCount/totalG)*100), female: Math.round((femaleCount/totalG)*100) },
        heatmap: { crimes: topTypeNames, statuses: statusNames, data: heatmap },
        calendar: Object.entries(dateCounts).map(([date,count])=>[date,count]),
        scatter, radar,
        stats: {
          total_firs: firs.length, total_accused: profiles.length, repeat_offenders: repeatCount,
          total_victims: firs.reduce((n, f) => n + (victimCountByCase[f.fir_id] || 0), 0),
          unsolved: (statusCounts['Under Investigation']||0)+(statusCounts['Pending Trial']||0),
        },
        filterOptions, appliedFilters,
      });
    }

    // ── NETWORKS ─────────────────────────────────────────────────────────────
    if (action === 'networks') {
      const [caseRows, accusedRows, relRows, finRows] = await Promise.all([
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID, GravityOffenceID FROM CaseMaster'),
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
        q(app, 'SELECT rel_id, from_id, from_type, to_id, to_type, rel_type, strength, CaseMasterID FROM Relationships LIMIT 300'),
        q(app, 'SELECT account_number, bank, linked_accused_id, suspicious_txn_count, total_suspicious_amount, notes FROM FinancialAccounts WHERE flagged = true LIMIT 30'),
      ]);
      const cases   = flatAll(caseRows, 'CaseMaster');
      const accused = flatAll(accusedRows, 'Accused');
      const rels    = flatAll(relRows, 'Relationships');
      const fin     = flatAll(finRows, 'FinancialAccounts');
      if (!accused.length) return basicIO.response.status(200).json(fallback(action));

      const firByCaseId = {}; const gravityByCaseId = {};
      cases.forEach(c => { firByCaseId[c.CaseMasterID] = denormalizeCase(c, lookups); gravityByCaseId[c.CaseMasterID] = lookups.gravityMap[c.GravityOffenceID]; });
      const profiles = computeAccusedProfiles(accused, firByCaseId, gravityByCaseId);
      const profileById = {}; profiles.forEach(p => { profileById[p.accused_id] = p; });

      return basicIO.response.status(200).json({
        nodes: profiles.map(a => ({
          id: a.accused_id, name: a.name,
          group: a.risk_score>=80?'High Risk':a.risk_score>=60?'Medium Risk':'Low Risk',
          risk: a.risk_score, crime: a.primary_crime, district: a.district, repeat: a.is_repeat_offender===1,
        })),
        links: rels.map(r => ({ source:`ACC-${r.from_id}`, target:`ACC-${r.to_id}`, type:r.rel_type, strength:r.strength })),
        financial: fin.map(f => ({
          account: showIds ? f.account_number : '****' + String(f.account_number || '').slice(-4),
          bank: f.bank, accused: `ACC-${f.linked_accused_id}`,
          txns: Number(f.suspicious_txn_count)||0, amount: Number(f.total_suspicious_amount)||0, notes: f.notes,
        })),
        piiMasked: !showIds,
      });
    }

    // ── PROFILER ─────────────────────────────────────────────────────────────
    if (action === 'profiler') {
      const search = escStr(body.search || '');
      const [accusedRows, caseRows, moRows] = await Promise.all([
        search
          ? q(app, `SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused WHERE AccusedName LIKE '%${search}%' LIMIT 50`)
          : qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster'),
        qAll(app, q, 'SELECT CaseMasterID, BriefFacts FROM Inv_OccuranceTime'),
      ]);
      const accused = flatAll(accusedRows, 'Accused');
      const cases   = flatAll(caseRows, 'CaseMaster');
      if (!accused.length) return basicIO.response.status(200).json(fallback(action));

      const moByCaseId = {};
      flatAll(moRows, 'Inv_OccuranceTime').forEach(o => { const mo = extractMO(o.BriefFacts); if (mo) moByCaseId[o.CaseMasterID] = mo; });

      const firByCaseId = {}; const gravityByCaseId = {};
      cases.forEach(c => { firByCaseId[c.CaseMasterID] = denormalizeCase(c, lookups); gravityByCaseId[c.CaseMasterID] = lookups.gravityMap[c.GravityOffenceID]; });
      const profiles = computeAccusedProfiles(accused, firByCaseId, gravityByCaseId)
        .map(p => ({ ...p, modus_operandi: moByCaseId[p.case_id] || null }));

      // Group by name to build multi-case fir history per (approximate) person
      const byName = {};
      profiles.forEach(p => { (byName[p.name] ??= []).push(p); });

      const result = Object.values(byName).slice(0,100).sort((a,b)=>b[0].risk_score-a[0].risk_score).map(group => {
        const primary = group.sort((a,b)=>b.risk_score-a.risk_score)[0];
        return {
          ...primary,
          fir_count: group.length,
          firs: group.slice(0,5).map(g => ({ number:g.fir_number, crime:g.primary_crime, status:g.status, date: firByCaseId[g.case_id]?.date_filed })),
        };
      });

      return basicIO.response.status(200).json({
        profiles: showIds ? result : maskRecords(result, 'analyst', { person: ['name'] }),
        piiMasked: !showIds,
      });
    }

    // ── FORECAST ─────────────────────────────────────────────────────────────
    // Spatiotemporal forecasting: district hotspots + hour-of-day peak windows,
    // a Holt-Winters model over the monthly case series, z-score anomalies, and
    // live early-warning alerts — all computed from CaseMaster/Inv_OccuranceTime.
    if (action === 'forecast') {
      const cases = await loadIntelCases(app, q, lookups);
      if (!cases.length) return basicIO.response.status(200).json(fallback(action));

      const byDist = {};
      cases.forEach(fir => {
        const d = fir.district;
        if (!byDist[d]) byDist[d] = { count:0, crimes:{}, bands:{}, lat:null, lng:null };
        byDist[d].count++;
        byDist[d].crimes[fir.crime_type] = (byDist[d].crimes[fir.crime_type]||0)+1;
        byDist[d].bands[timeBandOf(fir.hour)] = (byDist[d].bands[timeBandOf(fir.hour)]||0)+1;
        if (fir.lat && !byDist[d].lat) { byDist[d].lat = fir.lat; byDist[d].lng = fir.lng; }
      });

      const maxCases = Math.max(...Object.values(byDist).map(v=>v.count),1);
      const hotspots = Object.entries(byDist).sort((a,b)=>b[1].count-a[1].count).map(([name,v],i) => {
        const score = Math.round((v.count/maxCases)*100);
        const risk  = score>=80?'CRITICAL':score>=60?'HIGH':score>=40?'MEDIUM':'LOW';
        const topC  = Object.entries(v.crimes).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([c])=>c);
        const bands = Object.entries(v.bands).filter(([b])=>b!=='Unknown').sort((a,b)=>b[1]-a[1]);
        return {
          id:i+1, name, district:name, lat:v.lat||14.5, lng:v.lng||76.0, risk, score, crimes:topC,
          trend:`+${Math.round(score*0.2)}%`, predicted:Math.round(v.count*0.15),
          peakBand: bands[0]?.[0] || 'Unknown',
          timeBands: bands.map(([band,count])=>({ band, count })),
        };
      });

      // Day-of-week × hour incident matrix (spatiotemporal layer)
      const hourMatrix = [];
      const dowHour = {};
      cases.forEach(c => { if (c.hour!=null && c.dow!=null) { const k=`${c.dow}-${c.hour}`; dowHour[k]=(dowHour[k]||0)+1; } });
      for (let d=0; d<7; d++) for (let h=0; h<24; h++) hourMatrix.push([h, d, dowHour[`${d}-${h}`]||0]);

      // Holt-Winters forecast over the state-wide monthly series
      const series = monthlySeries(cases.map(c=>c.date_filed).filter(Boolean));
      const hw = holtWinters(series.values, 12, 6);
      const lastLabel = series.labels[series.labels.length-1];
      const futureLabels = [];
      if (lastLabel) {
        const [y,m] = lastLabel.split('-').map(Number);
        const cur = new Date(y, m-1, 1);
        for (let i=0;i<hw.forecast.length;i++) { cur.setMonth(cur.getMonth()+1); futureLabels.push(`${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`); }
      }

      const anomalies = detectAnomalies(cases);
      const moGroups  = groupMOPatterns(cases);
      const alerts    = buildLiveAlerts({ cases, moGroups, anomalies });

      return basicIO.response.status(200).json({
        hotspots, hourMatrix, anomalies: anomalies.slice(0,8), alerts,
        forecastSeries: {
          labels: series.labels, actual: series.values,
          futureLabels, forecast: hw.forecast, fitted: hw.fitted,
          model: { method: hw.method, params: hw.params || null, mape: hw.mape },
        },
      });
    }

    // ── LIVE ALERTS (dashboard early-warning feed) ───────────────────────────
    if (action === 'alerts') {
      const cases = await loadIntelCases(app, q, lookups);
      if (!cases.length) return basicIO.response.status(200).json({ alerts: [] });
      const [accusedRows, accRows] = await Promise.all([
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
        q(app, 'SELECT account_id, flagged, total_suspicious_amount FROM FinancialAccounts LIMIT 200'),
      ]);
      const firByCaseId = {}; const gravityByCaseId = {};
      cases.forEach(c => { firByCaseId[c.fir_id] = c; gravityByCaseId[c.fir_id] = c.gravity; });
      const profiles = computeAccusedProfiles(flatAll(accusedRows,'Accused'), firByCaseId, gravityByCaseId);
      const accounts = flatAll(accRows, 'FinancialAccounts');
      const moGroups  = groupMOPatterns(cases);
      const anomalies = detectAnomalies(cases);
      return basicIO.response.status(200).json({ alerts: buildLiveAlerts({ cases, profiles, accounts, moGroups, anomalies }) });
    }

    // ── MODUS OPERANDI PATTERNS ──────────────────────────────────────────────
    // Recurring-MO discovery: clusters cases sharing an identical MO narrative
    // and reports where/when each pattern operates.
    // ── SENTINEL SCAN — the 24/7 watch. Recomputes the live alert set on a
    // schedule (Catalyst Cron) rather than only when an officer opens the app,
    // and can deliver a priority digest by email. The scan is useful on its
    // own, so a mail misconfiguration never fails it.
    if (action === 'sentinel_scan') {
      const cases = await loadIntelCases(app, q, lookups);
      if (!cases.length) return basicIO.response.status(200).json({ alerts: [], priorityCount: 0, criticalCount: 0 });
      const [accusedRows, accRows] = await Promise.all([
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
        q(app, 'SELECT account_id, flagged, total_suspicious_amount FROM FinancialAccounts LIMIT 200'),
      ]);
      const firByCaseId = {}; const gravityByCaseId = {};
      cases.forEach(c => { firByCaseId[c.fir_id] = c; gravityByCaseId[c.fir_id] = c.gravity; });
      const profiles  = computeAccusedProfiles(flatAll(accusedRows, 'Accused'), firByCaseId, gravityByCaseId);
      const accounts  = flatAll(accRows, 'FinancialAccounts');
      const moGroups  = groupMOPatterns(cases);
      const anomalies = detectAnomalies(cases);
      const alerts    = buildLiveAlerts({ cases, profiles, accounts, moGroups, anomalies });
      const priority  = alerts.filter(a => a.severity === 'CRITICAL' || a.severity === 'HIGH');
      const generatedAt = new Date().toISOString();

      let emailed = false, emailError = null;
      const to = String(body.to || '').trim();
      if (body.notify && to) {
        try {
          const esc = (t) => String(t || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
          const rows = priority.slice(0, 10).map(a =>
            `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-weight:700;color:${a.severity === 'CRITICAL' ? '#c0392b' : '#b26a00'}">${esc(a.severity)}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(a.type)}</td>` +
            `<td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(a.msg)}</td></tr>`).join('');
          await app.email().sendMail({
            from_email: String(body.from || to),
            to_email: to,
            subject: `KAVACH Sentinel - ${priority.length} priority alert(s)`,
            content: `<div style="font-family:Arial,sans-serif;color:#1a1a1f">
              <h2 style="margin:0 0 4px">KAVACH Sentinel digest</h2>
              <p style="color:#666;font-size:13px;margin:0 0 14px">${priority.length} priority alert(s) as of ${new Date(generatedAt).toLocaleString('en-IN')} — Karnataka State Police</p>
              <table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table></div>`,
            html_mode: true,
          });
          emailed = true;
        } catch (e) { emailError = e.message; console.error('SENTINEL_MAIL:', e.message); }
      }

      return basicIO.response.status(200).json({
        generatedAt,
        totalAlerts:   alerts.length,
        priorityCount: priority.length,
        criticalCount: priority.filter(a => a.severity === 'CRITICAL').length,
        alerts:        priority.slice(0, 10),
        anomalies:     anomalies.slice(0, 5),
        emailed, emailError,
      });
    }

    if (action === 'mo_patterns') {
      const cases = await loadIntelCases(app, q, lookups);
      if (!cases.length) return basicIO.response.status(200).json({ patterns: [] });
      const patterns = groupMOPatterns(cases);
      return basicIO.response.status(200).json({
        patterns,
        totalWithMO: cases.filter(c=>c.mo).length,
        totalCases: cases.length,
      });
    }

    // ── CASE INSIGHT (similar past cases + investigation timeline) ──────────
    if (action === 'case_insight') {
      const query = escStr(String(body.query || '').trim());
      const cases = await loadIntelCases(app, q, lookups);
      if (!cases.length) return basicIO.response.status(200).json({ error: 'No case data available' });

      // Match by FIR/crime number fragment or CaseMasterID
      const needle = query.toLowerCase();
      const target = needle
        ? cases.find(c => String(c.fir_number||'').toLowerCase().includes(needle) || String(c.fir_id)===needle || String(c.case_no||'').toLowerCase().includes(needle))
        : null;
      if (!target) {
        return basicIO.response.status(200).json({
          notFound: true,
          suggestions: cases.slice(0, 8).map(c => ({ fir_number: c.fir_number, district: c.district, crime: c.crime_type })),
        });
      }

      const caseId = target.fir_id;
      const [accusedRows, arrestRows, csRows, victimRows] = await Promise.all([
        q(app, `SELECT AccusedMasterID, AccusedName, AgeYear, GenderID FROM Accused WHERE CaseMasterID = ${Number(caseId)}`),
        q(app, `SELECT ArrestSurrenderID, ArrestSurrenderDate, AccusedMasterID FROM ArrestSurrender WHERE CaseMasterID = ${Number(caseId)}`),
        q(app, `SELECT CSID, csdate, cstype FROM ChargesheetDetails WHERE CaseMasterID = ${Number(caseId)}`),
        q(app, `SELECT VictimMasterID, VictimName, AgeYear, GenderID FROM Victim WHERE CaseMasterID = ${Number(caseId)}`),
      ]);
      const accused = flatAll(accusedRows, 'Accused');
      const arrests = flatAll(arrestRows, 'ArrestSurrender');
      const sheets  = flatAll(csRows, 'ChargesheetDetails');
      const victims = flatAll(victimRows, 'Victim');

      // Investigation timeline from real dated events
      const accusedById = {}; accused.forEach(a => { accusedById[a.AccusedMasterID] = a.AccusedName; });
      const timeline = [
        { date: target.date_filed, event: 'FIR Registered', detail: `${target.crime_type} registered at ${target.station}, ${target.district}` },
        ...arrests.filter(a=>a.ArrestSurrenderDate).map(a => ({
          date: a.ArrestSurrenderDate, event: 'Arrest / Surrender',
          detail: `${accusedById[a.AccusedMasterID] || 'Accused ACC-'+a.AccusedMasterID} taken into custody`,
        })),
        ...sheets.filter(s=>s.csdate).map(s => ({
          date: s.csdate,
          event: s.cstype==='A' ? 'Chargesheet Filed' : s.cstype==='B' ? 'Closed — False Case' : 'Closed — Undetected',
          detail: s.cstype==='A' ? 'Final report submitted to court' : 'Investigation concluded',
        })),
      ].filter(t=>t.date).sort((a,b)=>new Date(a.date)-new Date(b.date));

      // Similar past cases — weighted feature match, with per-match reasons so
      // the ranking stays explainable.
      const accusedNames = new Set(accused.map(a=>a.AccusedName));
      const similar = cases.filter(c => c.fir_id !== caseId).map(c => {
        let score = 0; const reasons = [];
        if (c.crime_type === target.crime_type) { score += 35; reasons.push(`Same crime type (${target.crime_type})`); }
        if (c.mo && c.mo === target.mo)          { score += 30; reasons.push('Identical modus operandi'); }
        if (c.district === target.district)      { score += 15; reasons.push(`Same district (${target.district})`); }
        if (timeBandOf(c.hour) === timeBandOf(target.hour) && target.hour != null) { score += 10; reasons.push(`Same time window (${timeBandOf(target.hour)})`); }
        if (c.gravity === target.gravity && target.gravity) { score += 10; reasons.push('Same offence gravity'); }
        return { score, reasons, fir_number: c.fir_number, fir_id: c.fir_id, district: c.district, crime: c.crime_type, status: c.status, date: c.date_filed, mo: c.mo };
      }).filter(s => s.score >= 45).sort((a,b)=>b.score-a.score).slice(0, 8);

      return basicIO.response.status(200).json({
        case: {
          fir_number: target.fir_number, fir_id: caseId, district: target.district, station: target.station,
          crime: target.crime_type, crime_head: target.crime_head, status: target.status,
          date_filed: target.date_filed, mo: target.mo, gravity: target.gravity,
          narrative: target.narrative || '',
          time_window: timeBandOf(target.hour),
          accused: accused.map(a => ({ id: `ACC-${a.AccusedMasterID}`, name: a.AccusedName, age: a.AgeYear })),
          victims: victims.map(v => ({ name: v.VictimName, age: v.AgeYear })),
        },
        timeline, similar,
      });
    }

    // ── SOCIOLOGICAL ANALYTICS ───────────────────────────────────────────────
    // Adapted to the ERD: socio-economic demographics (occupation/religion/
    // caste) are captured on ComplainantDetails, not Accused — the ERD has no
    // education/economic-status fields for accused persons at all. This
    // module therefore analyses victim/complainant demographics against
    // crime patterns, which is what the source data actually supports.
    if (action === 'sociological') {
      const [caseRows, complRows] = await Promise.all([
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID FROM CaseMaster'),
        qAll(app, q, 'SELECT ComplainantID, CaseMasterID, AgeYear, OccupationID, ReligionID, CasteID, GenderID FROM ComplainantDetails'),
      ]);
      const [occRows, relRows, casteRows] = await Promise.all([
        q(app, 'SELECT OccupationID, OccupationName FROM OccupationMaster'),
        q(app, 'SELECT ReligionID, ReligionName FROM ReligionMaster'),
        q(app, 'SELECT caste_master_id, caste_master_name FROM CasteMaster'),
      ]);
      const cases  = flatAll(caseRows, 'CaseMaster');
      const compl  = flatAll(complRows, 'ComplainantDetails');
      if (!compl.length) return basicIO.response.status(200).json(fallback(action));

      const occMap = {}; flatAll(occRows,'OccupationMaster').forEach(o=>occMap[o.OccupationID]=o.OccupationName);
      const relMap = {}; flatAll(relRows,'ReligionMaster').forEach(r=>relMap[r.ReligionID]=r.ReligionName);
      const casteMap = {}; flatAll(casteRows,'CasteMaster').forEach(c=>casteMap[c.caste_master_id]=c.caste_master_name);

      const firByCaseId = {}; cases.forEach(c => { firByCaseId[c.CaseMasterID] = denormalizeCase(c, lookups); });

      const AGE_BANDS = ['18–25','26–35','36–45','46+'];
      const topCrimes = Object.entries(
        compl.reduce((m,c) => { const crime = firByCaseId[c.CaseMasterID]?.crime_type || 'Other'; m[crime]=(m[crime]||0)+1; return m; }, {})
      ).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([c])=>c);

      const ageCrimeHeatmap = [];
      topCrimes.forEach((crime,ci) => AGE_BANDS.forEach((band,bi) => {
        const count = compl.filter(c => firByCaseId[c.CaseMasterID]?.crime_type===crime && ageBand(c.AgeYear)===band).length;
        ageCrimeHeatmap.push([bi, ci, count]);
      }));

      const religionCrime = Object.entries(relMap).map(([id,name]) => {
        const group = compl.filter(c => String(c.ReligionID)===String(id));
        return { label:name, count:group.length };
      }).filter(r=>r.count>0);

      const casteDistribution = Object.entries(casteMap).map(([id,name]) => ({
        label:name, count: compl.filter(c=>String(c.CasteID)===String(id)).length,
      })).filter(c=>c.count>0);

      const occupationDistribution = Object.entries(occMap).map(([id,name]) => ({
        label:name, count: compl.filter(c=>String(c.OccupationID)===String(id)).length,
      })).filter(o=>o.count>0).sort((a,b)=>b.count-a.count).slice(0,10);

      const districtDensity = Object.entries(
        compl.reduce((m,c) => { const d=firByCaseId[c.CaseMasterID]?.district||'Unknown'; m[d]=(m[d]||0)+1; return m; }, {})
      ).sort((a,b)=>b[1]-a[1]).map(([district,count])=>({district,count}));

      const pearson = (xs,ys) => { const n=xs.length; if(!n) return 0; const mx=xs.reduce((a,b)=>a+b,0)/n, my=ys.reduce((a,b)=>a+b,0)/n; let num=0,dx=0,dy=0; for(let i=0;i<n;i++){num+=(xs[i]-mx)*(ys[i]-my);dx+=(xs[i]-mx)**2;dy+=(ys[i]-my)**2;} const denom=Math.sqrt(dx*dy); return denom?Math.round((num/denom)*100)/100:0; };
      const ages = compl.map(c=>Number(c.AgeYear)||0);
      const genderNum = compl.map(c=>Number(c.GenderID)===2?1:0);
      const correlations = { age_vs_female_complainant: pearson(ages, genderNum) };

      const genderCounts = compl.reduce((m,c) => { const g=Number(c.GenderID)===1?'Male':Number(c.GenderID)===2?'Female':'Other'; m[g]=(m[g]||0)+1; return m; }, {});

      return basicIO.response.status(200).json({
        ageBands: AGE_BANDS, crimes: topCrimes, ageCrimeHeatmap,
        religionCrime, casteDistribution, occupationDistribution, districtDensity,
        correlations, gender: genderCounts, totalAccused: compl.length,
        note: 'Demographics reflect complainants/victims (per ERD ComplainantDetails) — the source schema records no socio-economic fields for accused persons.',
      });
    }

    // ── FINANCIAL CRIME ANALYSIS ─────────────────────────────────────────────
    if (action === 'financial') {
      const [accRows, accusedRows] = await Promise.all([
        q(app, 'SELECT account_id, account_number, bank, linked_accused_id, flagged, suspicious_txn_count, total_suspicious_amount, notes FROM FinancialAccounts LIMIT 200'),
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
      ]);
      const accounts = flatAll(accRows, 'FinancialAccounts');
      const accused  = flatAll(accusedRows, 'Accused');
      if (!accounts.length) return basicIO.response.status(200).json(fallback(action));

      const caseRows = await qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, GravityOffenceID FROM CaseMaster');
      const cases = flatAll(caseRows, 'CaseMaster');
      const firByCaseId = {}; const gravityByCaseId = {};
      cases.forEach(c => { firByCaseId[c.CaseMasterID] = denormalizeCase(c, lookups); gravityByCaseId[c.CaseMasterID] = lookups.gravityMap[c.GravityOffenceID]; });
      const profiles = computeAccusedProfiles(accused, firByCaseId, gravityByCaseId);
      const profileById = {}; profiles.forEach(p => { profileById[p.accused_id] = p; });

      const nodes = []; const nodeIds = new Set();
      accounts.forEach(acc => {
        const accId = `FA-${acc.account_id}`;
        if (!nodeIds.has(accId)) { nodes.push({ id:accId, type:'account', label:acc.account_number, bank:acc.bank, flagged:Number(acc.flagged)===1, amount:Number(acc.total_suspicious_amount)||0 }); nodeIds.add(accId); }
        const linkedId = `ACC-${acc.linked_accused_id}`;
        const linked = profileById[linkedId];
        if (linked && !nodeIds.has(linkedId)) { nodes.push({ id:linkedId, type:'accused', label:linked.name, district:linked.district, risk:linked.risk_score }); nodeIds.add(linkedId); }
      });

      const edges = accounts.filter(acc => profileById[`ACC-${acc.linked_accused_id}`]).map(acc => ({
        source:`ACC-${acc.linked_accused_id}`, target:`FA-${acc.account_id}`,
        label:`₹${Number(acc.total_suspicious_amount||0).toLocaleString('en-IN')}`,
        amount:Number(acc.total_suspicious_amount)||0, txns:Number(acc.suspicious_txn_count)||0, flagged:Number(acc.flagged)===1,
      }));

      const bankFlow = {};
      accounts.forEach(acc => {
        const linked = profileById[`ACC-${acc.linked_accused_id}`];
        const dist = linked?.district || 'Unknown';
        const key = `${acc.bank}→${dist}`;
        bankFlow[key] = (bankFlow[key]||0) + (Number(acc.total_suspicious_amount)||0);
      });
      const sankey = Object.entries(bankFlow).map(([k,v]) => { const [source,target]=k.split('→'); return {source,target,value:v}; }).filter(f=>f.value>0);

      const flaggedTotal = accounts.filter(a=>Number(a.flagged)===1).reduce((s,a)=>s+(Number(a.total_suspicious_amount)||0),0);

      return basicIO.response.status(200).json({
        nodes: showIds ? nodes : maskRecords(nodes, 'analyst', { person: ['label'] }),
        edges, sankey,
        piiMasked: !showIds,
        stats: {
          total_accounts: accounts.length, flagged_accounts: accounts.filter(a=>Number(a.flagged)===1).length,
          total_suspicious_amount: flaggedTotal,
          total_suspicious_txns: accounts.reduce((s,a)=>s+(Number(a.suspicious_txn_count)||0),0),
        },
      });
    }

    // ── DASHBOARD ─────────────────────────────────────────────────────────────
    if (action === 'dashboard') {
      const [caseRows, accusedCountRows, victimCountRows] = await Promise.all([
        qAll(app, q, 'SELECT CaseMasterID, CaseStatusID FROM CaseMaster'),
        qAll(app, q, 'SELECT AccusedMasterID, AccusedName FROM Accused'),
        qAll(app, q, 'SELECT VictimMasterID FROM Victim'),
      ]);
      const cases = flatAll(caseRows, 'CaseMaster');
      const accused = flatAll(accusedCountRows, 'Accused');
      const nameCount = {}; accused.forEach(a => { nameCount[a.AccusedName]=(nameCount[a.AccusedName]||0)+1; });
      const repeatOffenders = accused.filter(a => nameCount[a.AccusedName] > 1).length;

      const statusName = (id) => lookups.statusMap[id];
      return basicIO.response.status(200).json({
        stats: {
          total_firs: cases.length,
          open_cases: cases.filter(c => ['Under Investigation','Pending Trial'].includes(statusName(c.CaseStatusID))).length,
          repeat_offenders: repeatOffenders,
          chargesheeted: cases.filter(c => statusName(c.CaseStatusID)==='Charge Sheeted').length,
          total_accused: accused.length,
          total_victims: victimCountRows.length,
        },
      });
    }

    return basicIO.response.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('DATA_QUERY_ERR:', err.message);
    return basicIO.response.status(200).json(fallback(action));
  }
};
