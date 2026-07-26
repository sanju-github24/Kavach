/**
 * chat-query — KAVACH Intelligence Engine v8.0 (official ERD schema)
 *
 * Queries the Police FIR System ERD (backend/schema.sql) via Catalyst
 * QuickML RAG. See _lib/dataAccess.js for how CaseMaster/Accused rows are
 * denormalized into FIR/offender-shaped context the LLM can reason over.
 */

const https    = require('https');
const catalyst = require('zcatalyst-sdk-node');
const { escStr, escId, escLongText } = require('../_lib/sanitize');
const { flat, flatAll, loadLookups, qAll, denormalizeCase, computeAccusedProfiles, loadIntelCases } = require('../_lib/dataAccess');
const { extractMO, timeBandOf, groupMOPatterns, monthlySeries, holtWinters, detectAnomalies, buildLiveAlerts } = require('../_lib/intel');

const PROJECT_ID   = '47756000000013047';
const CATALYST_ORG = '60073493322';
const DOC_ID       = '3868000000003019';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_INTRO = `You are KAVACH, the AI intelligence assistant for Karnataka State Police.
Answer like a senior crime analyst briefing a senior officer — precise, human, actionable.

RULES:
1. Lead with a one-sentence answer summary.
2. Use readable prose or bullet points — never raw database rows or pipe-separated values.
3. Bold (**) critical values: names, FIR/case numbers, accused IDs, risk scores, districts.
4. Always cite evidence: case number, accused ID, district, risk score, arrest status.
5. End with one concrete recommendation the officer can act on immediately.
6. Never invent data — use only what appears in LIVE DATA section below.
7. For counts: give totals, percentages, rank top items.
8. For person/list/comparison queries: keep the prose SHORT — 2-3 sentences of narrative context (who, why it matters, what to do about it). Do NOT enumerate every field one by one in sentence form ("his age is X, his district is Y, his risk score is Z...") — a detailed table with every field renders automatically beneath your answer, so the prose only needs to add the narrative the table can't: context, comparison, and a recommendation.
9. For network queries: explain connections in plain language.
10. If data is empty or missing, say so clearly and suggest a better query.
11. VISUALIZATION — whenever your answer compares items, ranks them, counts by category, or profiles one subject across many fields, append EXACTLY ONE machine-readable block at the very END of your reply so a real chart or table renders for the officer. Use this precise format — a fenced block tagged kavach containing one JSON object, and nothing else shaped like it anywhere else in your reply:
\`\`\`kavach
{"viz":"bar","title":"Cases by district","data":[{"label":"Bengaluru Urban","value":112},{"label":"Mysuru","value":61}]}
\`\`\`
 - "viz" is exactly one of: "table", "bar", "pie", "line", "radar".
 - For "table": include "columns":["Col A","Col B",...] and "rows":[["cell","cell"],...] — one array per row, cells in the same order as columns.
 - For bar/pie/line/radar: include "data":[{"label":"...","value":<number>}], one entry per item, values as raw numbers (no % sign, no commas).
 - Honor an explicit request: "as a pie chart" → "pie"; "in a table" → "table"; "bar graph" → "bar". If the officer doesn't specify, use "table" for side-by-side comparisons and multi-field profiles, and "bar" for rankings or counts-by-category.
 - Fill it ONLY from the LIVE DATA with real numbers. Cover every relevant item the data supports (e.g. "compare all districts" → one row/bar per district, not just two).
 - If there is genuinely nothing to visualize (a single yes/no fact, a definition, an empty result), OMIT the block entirely — never emit an empty or placeholder one.
12. The kavach block is the ONLY structured output. Your prose must NOT also restate those numbers as a markdown pipe table ( | A | B | ), an ASCII table, a mermaid diagram, or any other code fence. Write your short narrative first, then the block on its own at the end. Officers never see the raw block — it becomes a real chart/table — so do not refer to it as "the block"; if you mention it, say "shown below" naturally.

EXAMPLE — Person query:
"**Ravi Kumar (ACC-1042)** is a 33-year-old male linked to a case in **Ballari**, rated **high risk (79/100)** based on offence gravity and case history. He is flagged as a repeat offender across 4 recorded cases involving narcotics and robbery. He is currently **absconding** per the arrest/surrender record.
→ Recommend: Issue lookout notice and coordinate with the district IO for network mapping."

EXAMPLE — Stats query:
"Karnataka currently has **500 cases** on record. The heaviest caseload is in **Bengaluru Urban (112)**, **Mysuru (61)**, and **Belagavi (54)**. The dominant crime is **Theft (18%)**, followed by Robbery (14%). Overall charge-sheet rate is **62%**.
→ Recommend: Redeploy resources to Bengaluru Urban and Mysuru divisions immediately."

EXAMPLE — Comparison query ("compare ACC-12 and ACC-45"):
"**Suresh Kumar (ACC-12)** is a 34-year-old repeat offender in **Bengaluru Urban**, linked to robbery across 3 cases, rated **89/100**. **Imran Khan (ACC-45)** is a 41-year-old first-time offender in **Mysuru**, linked to fraud in 1 case, rated **52/100**.
→ **ACC-12 is the greater concern** — nearly double the risk score and an active repeat pattern; prioritize surveillance there first.
\`\`\`kavach
{"viz":"table","title":"Accused comparison","columns":["Name","ID","District","Risk","Cases"],"rows":[["Suresh Kumar","ACC-12","Bengaluru Urban","89/100",3],["Imran Khan","ACC-45","Mysuru","52/100",1]]}
\`\`\`"

EXAMPLE — District comparison, bar chart requested ("compare cases of Bengaluru and Mysore in a bar chart"):
"**Bengaluru Urban** has **112 cases** on record, led by robbery; **Mysuru** has **61**, led by fraud. Bengaluru Urban carries nearly double the caseload.
→ **Prioritize resource allocation to Bengaluru Urban.** Shown below.
\`\`\`kavach
{"viz":"bar","title":"Cases by district","data":[{"label":"Bengaluru Urban","value":112},{"label":"Mysuru","value":61}]}
\`\`\`"

EXAMPLE — All-districts breakdown ("compare all districts cases from karnataka"):
"**Dakshina Kannada** leads with **61 cases**, followed by **Ballari (58)** and **Tumakuru (54)**; **Kalaburagi** has the worst open-case rate at **94%**.
→ **Kalaburagi needs immediate intervention** on its backlog. Shown below.
\`\`\`kavach
{"viz":"bar","title":"Cases by district","data":[{"label":"Dakshina Kannada","value":61},{"label":"Ballari","value":58},{"label":"Tumakuru","value":54},{"label":"Hassan","value":51},{"label":"Kalaburagi","value":48}]}
\`\`\`"`;

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN (correct scope for the QuickML RAG endpoint)
// ─────────────────────────────────────────────────────────────────────────────
let _tok = null, _tokExp = 0;
async function getToken() {
  if (_tok && Date.now() < _tokExp - 60000) return _tok;
  const p = new URLSearchParams({
    grant_type:'client_credentials',
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    scope:'QuickML.rag.READ',
  });
  const r = await httpsPost('accounts.zoho.in','/oauth/v2/token',
    {'Content-Type':'application/x-www-form-urlencoded'},p.toString());
  if (!r.access_token) throw new Error('Token failed: '+JSON.stringify(r));
  _tok = r.access_token;
  _tokExp = Date.now() + (r.expires_in||3600)*1000;
  return _tok;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTPS HELPER
// ─────────────────────────────────────────────────────────────────────────────
function httpsPost(hostname,path,headers,payload,ms=15000){
  return new Promise((resolve,reject)=>{
    const body=typeof payload==='string'?payload:JSON.stringify(payload);
    const req=https.request(
      {hostname,path,method:'POST',headers:{...headers,'Content-Length':Buffer.byteLength(body)},timeout:ms},
      res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve(JSON.parse(d))}catch{resolve({response:d})}})}
    );
    req.on('timeout',()=>{req.destroy();reject(new Error('Timeout'))});
    req.on('error',reject);
    req.write(body);req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ZCQL HELPER
// ─────────────────────────────────────────────────────────────────────────────
async function q(app,query,ms=8000){
  try{
    console.log('ZCQL:',query.slice(0,100));
    const rows=await Promise.race([
      app.zcql().executeZCQLQuery(query),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('ZCQL_TIMEOUT')),ms))
    ])||[];
    console.log('ROWS:',rows.length);
    return rows;
  }catch(e){console.error('ZCQL_ERR:',e.message);return [];}
}

// ─────────────────────────────────────────────────────────────────────────────
// ROMANIZED KANNADA (KANGLISH) NORMALIZATION
// Officers often type Kannada words in English letters — "Bengaluru alli
// eshtu kesu ide?" ("how many cases are there in Bengaluru?"). Translating
// the known tokens to English up-front lets the existing intent detection,
// entity extraction, and data fetching understand the query unchanged.
// ─────────────────────────────────────────────────────────────────────────────
const KANGLISH_MAP = [
  // question words
  [/\b(eshtu|estu|yeshtu|yestu)\b/gi,            'how many'],
  [/\b(yaru|yaaru)\b/gi,                          'who'],
  [/\b(elli|yelli)\b/gi,                          'where'],
  [/\b(yava|yaava)\b/gi,                          'which'],
  [/\b(yavaga|yaavaga)\b/gi,                      'when'],
  [/\b(yake|yaake)\b/gi,                          'why'],
  // verbs / requests
  [/\b(torisu|thorisu|torsi|thorsi)\b/gi,         'show'],
  [/\b(heli|helu|helri)\b/gi,                     'tell me'],
  [/\b(kodu|kodi)\b/gi,                           'give'],
  [/\b(huduku|hudukri)\b/gi,                      'find'],
  [/\b(nodu|nodi)\b/gi,                           'see'],
  [/\b(ide|idhe|ideya|idya|iddava|idava)\b/gi,    'are there'],
  [/\b(agide|aagide)\b/gi,                        'has happened'],
  [/\b(beku|beeku)\b/gi,                          'needed'],
  // crime / case vocabulary
  [/\b(prakarana|prakaranagalu|kesu|kesugalu)\b/gi, 'cases'],
  [/\b(aparadha|apradha)\b/gi,                    'crime'],
  [/\b(aparadhi|aparaadhi|aparadhigalu)\b/gi,     'offender'],
  [/\b(kalla|kallaru|kallanu)\b/gi,               'thief'],
  [/\b(kalatana|kalathana|kalthana|kaltana)\b/gi, 'theft'],
  [/\b(darode|dorade)\b/gi,                       'robbery'],
  [/\b(kole|kolegalu)\b/gi,                       'murder'],
  [/\b(vanchane|mosa)\b/gi,                       'fraud'],
  [/\b(halle|haleya)\b/gi,                        'assault'],
  [/\b(apaharana)\b/gi,                           'kidnapping'],
  [/\b(bandhana|bandisu|bandisiddare)\b/gi,       'arrest'],
  [/\b(santrasta|santrastaru)\b/gi,               'victim'],
  [/\b(doshi|aropiga?lu|aropi)\b/gi,              'accused'],
  [/\b(jille|jilleyalli|jillegalu)\b/gi,          'district'],
  [/\b(thana|thane|police thane)\b/gi,            'police station'],
  [/\b(jaala|jala)\b/gi,                          'network'],
  [/\b(hana|duddu)\b/gi,                          'money'],
  [/\b(khate|khategalu)\b/gi,                     'accounts'],
  // qualifiers
  [/\b(punaha|matte matte)\b/gi,                  'repeat'],
  [/\b(adhika|jasti|hecchu|heccu)\b/gi,           'most'],
  [/\b(apaya|apayakari)\b/gi,                     'high risk'],
  [/\b(hosa|hosadu)\b/gi,                         'new'],
  [/\b(baki|bakiyagiruva)\b/gi,                   'pending'],
  [/\b(mundina|bhavishya)\b/gi,                   'forecast'],
  [/\b(vishleshane|vishlesane)\b/gi,              'analysis'],
  [/\b(mahiti|maahiti)\b/gi,                      'details'],
  // connectors (kept last — short, common words)
  [/\b(alli|nalli|olage)\b/gi,                    'in'],
  [/\b(mattu|hagu|haagu)\b/gi,                    'and'],
  [/\b(bagge|kurithu|kuritu)\b/gi,                'about'],
  [/\b(ella|yella|ellavannu)\b/gi,                'all'],
];

function normalizeKanglish(msg){
  let out = msg, detected = false;
  for (const [re, en] of KANGLISH_MAP) {
    const next = out.replace(re, en);
    if (next !== out) detected = true;
    out = next;
  }
  return { text: out, detected };
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENT DETECTION
// ─────────────────────────────────────────────────────────────────────────────
function detectIntent(msg){
  const m=msg.toLowerCase();
  const hasCompareWord = /\b(compare|comparison|versus|vs\.?|between)\b/i.test(m);
  // Two-or-more distinct districts named in one query ("compare cases of
  // Bengaluru and Mysore", "bengaluru and belgavi cases", "blr vs mysuru")
  // — naming two districts in one breath is inherently comparative, so we
  // don't require an explicit "compare" word (officers rarely type it). The
  // per-district comparison view is a strict superset of single-district
  // info anyway. Checked ahead of accused_comparison since "compare accused
  // of Bengaluru and Mysuru" is really a district-scoped comparison.
  if (extractDistricts(msg).length >= 2)                                    return 'district_comparison';
  // Two-or-more accused named/ID'd in one query ("ACC-12 and ACC-45",
  // "compare X and Y", "X vs Y crime report") — checked next since it
  // otherwise falls into the single-accused offender_profile branch below.
  const accIdCount = (msg.match(/\bACC-\d+\b/gi)||[]).length;
  const hasAccusedContext = /accused|offender|suspect|criminal|crime report/i.test(m);
  if (accIdCount >= 2 || (hasCompareWord && hasAccusedContext))              return 'accused_comparison';
  if(/audit|access log|who access|who view|system log|log activit/.test(m))            return 'audit_query';
  if(/officer|badge|kgid|employee|active officer|list officer|investigating officer/.test(m)) return 'user_profile';
  if(/victim|complainant|who was attacked|who was hurt|injured|affected/.test(m))      return 'victim_lookup';
  if(/modus operandi|\bmo\b|recurring method|same method|similar method|crime method|how.*operate|operating pattern/.test(m)) return 'mo_analysis';
  if(/network|gang|link between|connect|associat|money trail|financial|flagged account|suspicious.*account|transaction/.test(m)) return 'network_analysis';
  if(/forecast|predict|hotspot|risk area|danger zone|where will|likely/.test(m))       return 'forecast';
  if(/(repeat|habitual|serial).*offend|offend.*(repeat|habitual|serial)/.test(m))      return 'repeat_offenders';
  if(/accused.*in.*case|who.*in.*case|linked.*accused|case.*accused/.test(m))          return 'fir_accused_link';
  if(/\bacc-\d+\b|accused|offender|suspect|criminal profile|profile of/i.test(m))      return 'offender_profile';
  if(/\bfir\b|\bcase\b|case number|crime no|open case|filed case|how many case|show.*case|pending case|active case|pending investigat|active investigat|ongoing investigat|list.*investigat|charge.?sheet/.test(m)) return 'fir_lookup';
  if(/statistic|breakdown|analysis|summary|overview|how many|total|trend|pattern|all district|across karnataka/.test(m)) return 'pattern_analysis';
  return 'general';
}

// Recognises an officer explicitly naming a chart type ("as a bar chart",
// "pie chart of this", "plot it") so the requested type — not just a
// default — is what actually renders. Returns null when nothing was asked
// for explicitly, letting the caller fall back to intent-based defaults.
function detectChartType(msg){
  const m = msg.toLowerCase();
  if(/\b(pie|donut|doughnut)\b/.test(m))      return 'pie';
  if(/\bradar\b/.test(m))                     return 'radar';
  if(/\bline\b/.test(m))                      return 'line';
  if(/\btable\b/.test(m))                     return 'table';
  if(/\bbar\b/.test(m))                       return 'bar';
  if(/\b(chart|graph|plot|visuali[sz]e|visuali[sz]ation)\b/.test(m)) return 'bar';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────
const CRIME_TYPE_WORDS = /\b(theft|burglary|robbery|vehicle theft|chain snatching|assault|murder|kidnapping|domestic violence|pocso|fraud|financial fraud|smuggling|ndps|narcotics|cyber crime)\b/i;
// Every colloquial / legacy / commonly-misspelled district name an officer
// might actually type, mapped to a canonical substring that appears in the
// real DB district value (downstream filters use .includes()). This is what
// lets "gulbarga", "belgavi", "bellary", "hubli", "blr", "mysore" etc.
// resolve instead of the district being silently missed — the #1 cause of a
// query falling back to a generic answer. Keep values as safe substrings so
// e.g. 'bengaluru' matches both "Bengaluru Urban" and "Bengaluru Rural".
const DISTRICT_ALIASES = {
  'bengaluru urban':'bengaluru urban', 'bangalore urban':'bengaluru urban',
  'bengaluru rural':'bengaluru rural',  'bangalore rural':'bengaluru rural',
  'bengaluru':'bengaluru', 'bangalore':'bengaluru', 'bengalore':'bengaluru',
  'banglore':'bengaluru', 'bangaluru':'bengaluru', 'blr':'bengaluru',
  'mysuru':'mysuru', 'mysore':'mysuru', 'maisuru':'mysuru',
  'belagavi':'belagavi', 'belgaum':'belagavi', 'belgavi':'belagavi', 'belagaum':'belagavi',
  'kalaburagi':'kalaburagi', 'gulbarga':'kalaburagi', 'kalaburgi':'kalaburagi', 'kalburgi':'kalaburagi',
  'dakshina kannada':'dakshina kannada', 'south kanara':'dakshina kannada', 'd k':'dakshina kannada',
  'mangaluru':'mangaluru', 'mangalore':'mangaluru', 'mangalru':'mangaluru',
  'hubballi-dharwad':'dharwad', 'hubballi':'dharwad', 'hubli':'dharwad', 'dharwad':'dharwad', 'dharwar':'dharwad',
  'ballari':'ballari', 'bellary':'ballari', 'ballary':'ballari',
  'shivamogga':'shivamogga', 'shimoga':'shivamogga', 'shivmogga':'shivamogga',
  'vijayapura':'vijayapura', 'bijapur':'vijayapura', 'vijayapur':'vijayapura',
  'tumakuru':'tumakuru', 'tumkur':'tumakuru', 'tumakur':'tumakuru',
  'hassan':'hassan', 'hasan':'hassan',
};
// Built from the alias keys, longest-first so multi-word names ("bengaluru
// urban") win over their prefixes ("bengaluru") — keeps the two variants
// distinct when both are typed.
const DISTRICT_WORDS = new RegExp(
  '\\b(' + Object.keys(DISTRICT_ALIASES)
    .sort((a,b)=>b.length-a.length)
    .map(k=>k.replace(/[-\s]/g, s => s === '-' ? '\\-' : '\\s+'))
    .join('|') + ')\\b', 'i'
);

// All distinct districts named in one message, canonicalized to real names
// — powers district_comparison ("compare Bengaluru and Mysore").
function extractDistricts(text){
  const re = new RegExp(DISTRICT_WORDS.source, 'gi');
  const found = new Set();
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
    found.add(DISTRICT_ALIASES[raw] || raw);
  }
  return [...found];
}

function extractRaw(text){
  const accIdMatches = [...text.matchAll(/\bACC-(\d+)\b/gi)];
  const compareMatch = text.match(/([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){0,2})\s+(?:vs\.?|versus|and)\s+([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){0,2})/);
  return {
    caseId     :(text.match(/\bcase\s*(?:no\.?|number|#)?\s*(\d{1,10})\b/i)||[])[1],
    accusedId  :(accIdMatches[0]||[])[1],
    accusedIds :accIdMatches.length ? [...new Set(accIdMatches.map(m=>m[1]))] : null,
    // Both canonicalized (mysore/bangalore resolve to mysuru/bengaluru) so
    // downstream .includes() district filters match real DB names.
    district   :extractDistricts(text)[0],
    districts  :extractDistricts(text).length ? extractDistricts(text) : null,
    crimeType  :(text.match(CRIME_TYPE_WORDS)||[])[1],
    personName :(text.match(/(?:about|of|for|profile of|who is|show me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i)||[])[1],
    compareNames:compareMatch ? [compareMatch[1].trim(), compareMatch[2].trim()] : null,
  };
}

// Extracts entities from the current message, falling back to the officer's
// own recent messages for anything missing — so a follow-up like "what about
// his financial accounts?" or "show cases there too" carries over the
// accused/district from a few turns ago instead of coming up empty.
function extractEntities(msg, priorUserMessages = []){
  const e = extractRaw(msg);
  let followUpUsed = false;
  Object.keys(e).forEach(key => {
    if (e[key] != null) return;
    for (let i = priorUserMessages.length - 1; i >= 0; i--) {
      const found = extractRaw(priorUserMessages[i])[key];
      if (found != null) { e[key] = found; followUpUsed = true; break; }
    }
  });
  // accusedIds/compareNames are arrays — escape each element individually
  // rather than running escStr on the whole array (which would stringify
  // and corrupt it).
  Object.keys(e).forEach(k => {
    if (e[k] == null || k === 'followUpUsed') return;
    e[k] = Array.isArray(e[k]) ? e[k].map(v => escStr(v)) : escStr(e[k]);
  });
  e.followUpUsed = followUpUsed;
  return e;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
function fmtAccusedProfile(a){
  const lines=[
    `• **${a.name}** (${a.accused_id}) | Age: ${a.age||'N/A'} | Gender: ${a.gender||'N/A'} | District: **${a.district}**`,
    `  Risk: **${a.risk_score}/100** | Repeat: ${a.is_repeat_offender===1?'**Yes**':'No'} (${a.repeat_case_count} case(s) on record) | Crime: **${a.primary_crime||'N/A'}**`,
  ];
  if(a.fir_number) lines.push(`  Linked case: ${a.fir_number} | Status: ${a.status||'N/A'}`);
  return lines.join('\n');
}

function fmtFIR(f){
  const lines=[
    `• **${f.fir_number}** (Case #${f.fir_id}) | District: **${f.district}** | Station: ${f.station||'N/A'}`,
    `  Crime: **${f.crime_type}** (${f.crime_head}) | Status: **${f.status}** | Filed: ${f.date_filed}`,
  ];
  return lines.join('\n');
}

function fmtVictim(v){
  return `• **${v.VictimName}** | Age: ${v.AgeYear} | Gender: ${v.GenderID} | Case #${v.CaseMasterID}`;
}

function fmtOfficer(e){
  return `• **${e.FirstName}** | KGID: ${e.KGID} | Rank: ${e.rankName||'N/A'} | Designation: ${e.designationName||'N/A'} | District: ${e.districtName||'N/A'}`;
}

function fmtFinancial(x){
  return `• Account: **${x.account_number}** | Bank: ${x.bank} | Accused: **ACC-${x.linked_accused_id}**\n  Txns: ${x.suspicious_txn_count} | Total: **₹${Number(x.total_suspicious_amount||0).toLocaleString('en-IN')}** | Notes: ${(x.notes||'N/A').slice(0,80)}`;
}

function fmtRel(x){
  return `• **ACC-${x.from_id}** —[**${x.rel_type}**]→ **ACC-${x.to_id}** | Strength: ${x.strength}`;
}

function fmtAudit(a){
  return `• [${a.CREATEDTIME||a.created_at}] User: **${a.user_id}** | Action: ${a.action} | On: ${a.resource_type} (${a.resource_id})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE DATA — a clean, guaranteed-correct table built directly from the
// structured rows fetchData already assembled (not by asking the model to
// format one, which is unreliable — see chartData for the same reasoning).
// Long walls of prose are hard to scan; a table with the same facts reads in
// seconds. Renders alongside a chart when one was explicitly requested, or
// alone otherwise. Returns null for intents where a table isn't a good fit
// (aggregate summaries, network graphs — those already have dedicated views).
// ─────────────────────────────────────────────────────────────────────────────
function buildTableData(intent, rows){
  if(!rows || !rows.length) return null;

  if(intent==='accused_comparison' || intent==='repeat_offenders' || (intent==='offender_profile' && rows.length>1)){
    return { columns:['Name','ID','Age','District','Risk','Crime','Cases','Repeat'],
      rows: rows.map(p=>[p.name,p.accused_id,p.age??'—',p.district,`${p.risk_score}/100`,p.primary_crime||'—',p.repeat_case_count||1,p.is_repeat_offender===1?'Yes':'No']) };
  }
  if(intent==='offender_profile' && rows.length===1){
    const p=rows[0];
    return { columns:['Field','Value'], rows:[
      ['Name',p.name],['Accused ID',p.accused_id],['Age',p.age??'—'],['Gender',p.gender||'—'],
      ['District',p.district],['Risk Score',`${p.risk_score}/100`],['Primary Crime',p.primary_crime||'—'],
      ['Repeat Offender',p.is_repeat_offender===1?'Yes':'No'],['Linked Case',p.fir_number||'—'],['Status',p.status||'—'],
    ]};
  }
  if(intent==='district_comparison'){
    return { columns:['District','Cases','Accused','Open','Top Crime'],
      rows: rows.map(s=>[s.label,s.caseCount,s.accusedCount,s.openCount,s.topCrime]) };
  }
  if(intent==='fir_lookup'){
    return { columns:['FIR Number','District','Crime','Status','Filed'],
      rows: rows.slice(0,12).map(f=>[f.fir_number,f.district,f.crime_type,f.status,f.date_filed?String(f.date_filed).slice(0,10):'—']) };
  }
  if(intent==='fir_accused_link'){
    return { columns:['Name','Accused ID','Age','Gender'],
      rows: rows.slice(0,12).map(a=>[a.AccusedName,`ACC-${a.AccusedMasterID}`,a.AgeYear??'—',a.GenderID||'—']) };
  }
  if(intent==='victim_lookup'){
    return { columns:['Name','Age','Gender','Case'],
      rows: rows.slice(0,12).map(v=>[v.VictimName,v.AgeYear??'—',v.GenderID||'—',v.CaseMasterID]) };
  }
  if(intent==='user_profile'){
    return { columns:['Name','KGID','Rank','Designation','District'],
      rows: rows.slice(0,12).map(e=>[e.FirstName,e.KGID,e.rankName||'—',e.designationName||'—',e.districtName||'—']) };
  }
  if(intent==='mo_analysis'){
    return { columns:['MO Pattern','Cases','Top District','Peak Window'],
      rows: rows.slice(0,8).map(p=>[p.mo,p.count,p.topDistricts?.[0]?.name||'—',p.peakBand||'—']) };
  }
  if(intent==='audit_query'){
    return { columns:['Time','User','Action','Resource'],
      rows: rows.slice(0,12).map(r=>{ const a=flat(r,'AuditLogs'); return [a.CREATEDTIME||a.created_at||'—',a.user_id,a.action,`${a.resource_type} (${a.resource_id})`]; }) };
  }
  // pattern_analysis rows are the full denormalized case list — aggregate them
  // into a district breakdown so the single most common query class ("crime
  // summary", "breakdown", "how many cases") also gets a scannable table, not
  // just prose. Skipped if the rows don't look like cases (defensive).
  if(intent==='pattern_analysis' && rows[0]?.district && rows[0]?.crime_type){
    const byDist={};
    rows.forEach(f=>{
      const d=f.district||'Unknown';
      if(!byDist[d]) byDist[d]={total:0,open:0,types:{}};
      byDist[d].total++;
      byDist[d].types[f.crime_type]=(byDist[d].types[f.crime_type]||0)+1;
      if(f.status!=='Closed - FR') byDist[d].open++;
    });
    const top=Object.entries(byDist).sort((a,b)=>b[1].total-a[1].total).slice(0,10);
    if(top.length<2) return null;
    return { columns:['District','Cases','Open','% Open','Top Crime'],
      rows: top.map(([d,v])=>{ const t=Object.entries(v.types).sort((a,b)=>b[1]-a[1])[0]; return [d,v.total,v.open,`${Math.round(v.open/v.total*100)}%`,t?.[0]||'—']; }) };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL-EMITTED VISUALIZATION — the general path. Rather than hard-coding a
// chart/table for every possible query, the model itself decides when one
// helps and emits a ```kavach {…}``` JSON block (see SYSTEM_INTRO rule 11),
// filled from the live data it was given. This handles the long tail of
// queries our deterministic intent-router doesn't specifically cover ("top 5
// crimes by month", "compare all districts", any ad-hoc comparison). We parse
// it defensively — any malformed block is simply stripped and ignored, so a
// bad block never breaks the answer — and strip it from the prose either way
// so the officer only ever sees the rendered chart/table, never raw JSON.
// ─────────────────────────────────────────────────────────────────────────────
function parseModelViz(reply){
  const out = { chartType:null, chartData:null, tableData:null, cleanReply:reply||'' };
  if(!reply) return out;
  // Match a fenced block tagged kavach (or a stray ```json {…"viz"…}) anywhere
  // in the reply. Non-greedy to the first closing fence.
  const m = reply.match(/```(?:kavach|json)?\s*(\{[\s\S]*?"viz"[\s\S]*?\})\s*```/i);
  if(!m) return out;
  out.cleanReply = reply.replace(m[0], '').replace(/\n{3,}/g,'\n\n').trim();
  try{
    const v = JSON.parse(m[1]);
    const type = String(v.viz||'').toLowerCase();
    if(type==='table' && Array.isArray(v.columns) && Array.isArray(v.rows) && v.rows.length){
      out.tableData = {
        columns: v.columns.map(c=>String(c)),
        rows: v.rows.map(r=>Array.isArray(r)?r.map(c=>c==null?'—':c):[r]),
      };
      out.chartType = 'table';
    } else if(['bar','pie','line','radar'].includes(type) && Array.isArray(v.data)){
      const data = v.data
        .filter(d=>d && d.label!=null && d.value!=null && !isNaN(Number(d.value)))
        .map(d=>({ label:String(d.label), value:Number(d.value) }));
      if(data.length>=2){ out.chartData=data; out.chartType=type; }
    }
  }catch(_){ /* malformed block: already stripped from cleanReply, leave nulls */ }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIA TEXT ANALYTICS — Catalyst Zia keyword + named-entity extraction over the
// recurring modus-operandi narratives, so a "how do they operate?" answer is
// enriched with the actual methods, locations, orgs and amounts Zia recognises
// in the officers' free-text — structured intelligence the MO grouping alone
// doesn't surface. Runs in parallel with the RAG reply (adds no latency) and
// returns null on any failure so it never blocks or breaks the answer.
// ─────────────────────────────────────────────────────────────────────────────
async function runZiaAnalysis(app, docs){
  try{
    const combined = docs.map(String).filter(Boolean).slice(0,20).join('. ');
    if(combined.trim().length < 15) return null;
    const zia = app.zia();
    const [keywords, entities] = await Promise.all([
      zia.getKeywordExtraction([combined]).catch(e=>{ console.log('ZIA_KW:',e.message); return null; }),
      zia.getNERPrediction([combined]).catch(e=>{ console.log('ZIA_NER:',e.message); return null; }),
    ]);
    if(!keywords && !entities) return null;
    return { keywords, entities, sentiment:null };
  }catch(e){ console.error('ZIA_CHAT_ERR:', e.message); return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHER — routes by intent, joins against the ERD via lookups
// ─────────────────────────────────────────────────────────────────────────────
async function fetchData(app,intent,message,lookups,priorUserMessages=[]){
  const e=extractEntities(message,priorUserMessages);
  let rows=[],ctx='',hasMore=false,narratives=[];
  try{

    if(intent==='audit_query'){
      const all=await q(app,`SELECT log_id,user_id,action,resource_type,resource_id,query_text,CREATEDTIME FROM AuditLogs ${e.accusedId?`WHERE user_id LIKE '%${e.accusedId}%'`:''} ORDER BY CREATEDTIME DESC`);
      rows=all.slice(0,15); hasMore=all.length>rows.length;
      ctx=`AUDIT LOGS (${rows.length}):\n`+rows.map(r=>fmtAudit(flat(r,'AuditLogs'))).join('\n');
    }

    else if(intent==='user_profile'){
      const [empRows, rankRows, desigRows] = await Promise.all([
        q(app, e.district ? `SELECT EmployeeID, FirstName, KGID, RankID, DesignationID, UnitID, DistrictID FROM Employee LIMIT 200` : `SELECT EmployeeID, FirstName, KGID, RankID, DesignationID, UnitID, DistrictID FROM Employee LIMIT 15`),
        q(app, 'SELECT RankID, RankName FROM Rank'),
        q(app, 'SELECT DesignationID, DesignationName FROM Designation'),
      ]);
      const rankMap={}; flatAll(rankRows,'Rank').forEach(r=>rankMap[r.RankID]=r.RankName);
      const desigMap={}; flatAll(desigRows,'Designation').forEach(d=>desigMap[d.DesignationID]=d.DesignationName);
      let emps = flatAll(empRows,'Employee').map(x=>({...x, rankName:rankMap[x.RankID], designationName:desigMap[x.DesignationID], districtName:lookups.districtMap[x.DistrictID]}));
      if (e.district) emps = emps.filter(x => (x.districtName||'').toLowerCase().includes(e.district.toLowerCase()));
      rows = emps.slice(0,15); hasMore = emps.length>rows.length;
      ctx=`OFFICER PROFILES (${rows.length}):\n`+rows.map(fmtOfficer).join('\n');
    }

    else if(intent==='fir_accused_link'){
      let caseId = e.caseId;
      if (!caseId && e.accusedId) {
        const accRow = (await q(app, `SELECT CaseMasterID FROM Accused WHERE AccusedMasterID = ${Number(e.accusedId)}`))[0];
        caseId = accRow ? flat(accRow,'Accused').CaseMasterID : null;
      }
      if (caseId) {
        const [accRows, caseRow] = await Promise.all([
          q(app, `SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused WHERE CaseMasterID = ${Number(caseId)}`),
          q(app, `SELECT CaseMasterID, PoliceStationID, CrimeMinorHeadID, CrimeMajorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster WHERE CaseMasterID = ${Number(caseId)}`),
        ]);
        const accused = flatAll(accRows,'Accused');
        rows = accused;
        ctx=`ACCUSED IN CASE #${caseId} (${accused.length}):\n`+accused.map(a=>`• **${a.AccusedName}** (ACC-${a.AccusedMasterID}) | Age: ${a.AgeYear} | Gender: ${a.GenderID}`).join('\n');
        if (caseRow.length) ctx+='\n\nCASE DETAILS:\n'+fmtFIR(denormalizeCase(flat(caseRow[0],'CaseMaster'), lookups));
      } else {
        ctx = 'No matching case found for that reference.';
      }
    }

    else if(intent==='victim_lookup'){
      let victimRows;
      if (e.district) {
        const caseRows = await qAll(app, q, 'SELECT CaseMasterID, PoliceStationID FROM CaseMaster');
        const caseIds = flatAll(caseRows,'CaseMaster').filter(c => (lookups.unitMap[c.PoliceStationID]?.district||'').toLowerCase().includes(e.district.toLowerCase())).map(c=>c.CaseMasterID);
        victimRows = (await qAll(app, q, `SELECT VictimMasterID, CaseMasterID, VictimName, AgeYear, GenderID FROM Victim`))
          .map(r=>flat(r,'Victim')).filter(v=>caseIds.includes(v.CaseMasterID));
      } else if (e.caseId) {
        victimRows = flatAll(await q(app, `SELECT VictimMasterID, CaseMasterID, VictimName, AgeYear, GenderID FROM Victim WHERE CaseMasterID = ${Number(e.caseId)}`), 'Victim');
      } else {
        victimRows = flatAll(await q(app, 'SELECT VictimMasterID, CaseMasterID, VictimName, AgeYear, GenderID FROM Victim LIMIT 15'), 'Victim');
      }
      rows = victimRows.slice(0,15); hasMore = victimRows.length>rows.length;
      ctx=`VICTIMS (${rows.length}):\n`+rows.map(fmtVictim).join('\n');
    }

    else if(intent==='district_comparison'){
      // Two or more districts named in a "compare"-style query ("compare
      // cases of Bengaluru and Mysore") — per-district stats plus each
      // district's top accused, side by side rather than one district filter.
      const [caseRows, accusedRows] = await Promise.all([
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster'),
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
      ]);
      const cases = flatAll(caseRows,'CaseMaster').map(c => denormalizeCase(c, lookups, { gravity: lookups.gravityMap[c.GravityOffenceID] }));
      const firByCaseId={}; const gravityByCaseId={};
      cases.forEach(c=>{ firByCaseId[c.fir_id]=c; gravityByCaseId[c.fir_id]=c.gravity; });
      const profiles = computeAccusedProfiles(flatAll(accusedRows,'Accused'), firByCaseId, gravityByCaseId);

      const requested = e.districts || [];
      const sections = requested.map(reqD => {
        const distCases = cases.filter(f => f.district.toLowerCase().includes(reqD));
        const distProfiles = profiles.filter(p => p.district.toLowerCase().includes(reqD));
        const crimeCounts = {};
        distCases.forEach(f => { crimeCounts[f.crime_type] = (crimeCounts[f.crime_type]||0)+1; });
        const topCrime = Object.entries(crimeCounts).sort((a,b)=>b[1]-a[1])[0];
        const topAccused = [...distProfiles].sort((a,b)=>b.risk_score-a.risk_score).slice(0,3);
        const openCount = distCases.filter(f => f.status==='Under Investigation' || f.status==='Pending Trial').length;
        const label = reqD.replace(/\b\w/g, ch => ch.toUpperCase());
        return { label, caseCount: distCases.length, accusedCount: distProfiles.length, topCrime: topCrime?.[0]||'N/A', openCount, topAccused };
      });

      rows = sections;
      ctx = sections.length >= 2
        ? `DISTRICT COMPARISON (${sections.length}):\n` + sections.map(s =>
            `• **${s.label}**: **${s.caseCount} cases** | ${s.accusedCount} accused | ${s.openCount} open | top crime: ${s.topCrime}\n` +
            (s.topAccused.length ? `  Top accused: ${s.topAccused.map(a=>`${a.name} (${a.accused_id}, risk ${a.risk_score})`).join(', ')}` : '  No accused on record')
          ).join('\n')
        : `Could not identify two distinct districts to compare from that query.`;
    }

    else if(intent==='accused_comparison'){
      // Two or more accused named/ID'd in one query ("compare ACC-12 and
      // ACC-45", "Ravi Kumar vs Imran Khan crime report") — a side-by-side
      // profile lookup rather than a single-accused filter.
      const [accusedRows, caseRows] = await Promise.all([
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster'),
      ]);
      const cases = flatAll(caseRows,'CaseMaster');
      const firByCaseId={}; const gravityByCaseId={};
      cases.forEach(c=>{ firByCaseId[c.CaseMasterID]=denormalizeCase(c,lookups); gravityByCaseId[c.CaseMasterID]=lookups.gravityMap[c.GravityOffenceID]; });
      const profiles = computeAccusedProfiles(flatAll(accusedRows,'Accused'), firByCaseId, gravityByCaseId);

      let selected = [];
      if (e.accusedIds?.length) {
        selected = e.accusedIds.map(id => profiles.find(p=>p.accused_id===`ACC-${id}`)).filter(Boolean);
      }
      if (selected.length < 2 && e.compareNames?.length) {
        selected = e.compareNames
          .map(n => profiles.find(p=>p.name.toLowerCase().includes(n.toLowerCase())))
          .filter(Boolean);
      }
      rows = selected;
      ctx = selected.length >= 2
        ? `ACCUSED COMPARISON (${selected.length}):\n` + selected.map(fmtAccusedProfile).join('\n')
        : `Could not identify two distinct accused to compare — only found ${selected.length} match(es) for that query. Ask for two specific ACC-IDs or names.`;
    }

    else if(intent==='repeat_offenders' || intent==='offender_profile'){
      const [accusedRows, caseRows] = await Promise.all([
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster'),
      ]);
      const cases = flatAll(caseRows,'CaseMaster');
      const firByCaseId={}; const gravityByCaseId={};
      cases.forEach(c=>{ firByCaseId[c.CaseMasterID]=denormalizeCase(c,lookups); gravityByCaseId[c.CaseMasterID]=lookups.gravityMap[c.GravityOffenceID]; });
      let profiles = computeAccusedProfiles(flatAll(accusedRows,'Accused'), firByCaseId, gravityByCaseId);

      if (intent==='repeat_offenders') {
        profiles = profiles.filter(p=>p.is_repeat_offender===1);
        if (e.district) profiles = profiles.filter(p=>p.district.toLowerCase().includes(e.district.toLowerCase()));
        profiles = profiles.sort((a,b)=>b.risk_score-a.risk_score);
        const shown = profiles.slice(0,10); hasMore = profiles.length>shown.length; profiles = shown;
        ctx=`REPEAT OFFENDERS (${profiles.length}, by risk):\n`+profiles.map(fmtAccusedProfile).join('\n');
      } else {
        if (e.accusedId)       profiles = profiles.filter(p=>p.accused_id===`ACC-${e.accusedId}`);
        else if (e.personName) profiles = profiles.filter(p=>p.name.toLowerCase().includes(e.personName.toLowerCase()));
        else if (e.district)   profiles = profiles.filter(p=>p.district.toLowerCase().includes(e.district.toLowerCase())).sort((a,b)=>b.risk_score-a.risk_score);
        else if (e.crimeType)  profiles = profiles.filter(p=>p.primary_crime.toLowerCase().includes(e.crimeType.toLowerCase())).sort((a,b)=>b.risk_score-a.risk_score);
        else                   profiles = profiles.sort((a,b)=>b.risk_score-a.risk_score);
        const shown = profiles.slice(0,8); hasMore = profiles.length>shown.length; profiles = shown;
        ctx=`ACCUSED PROFILES (${profiles.length}):\n`+profiles.map(fmtAccusedProfile).join('\n');
      }
      rows = profiles;
    }

    else if(intent==='fir_lookup'){
      const caseRows = await qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CrimeMajorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster');
      let firs = flatAll(caseRows,'CaseMaster').map(c => denormalizeCase(c, lookups));

      if (e.caseId) {
        firs = firs.filter(f => f.fir_id === String(e.caseId));
        ctx = firs.length ? `CASE DETAILS:\n${fmtFIR(firs[0])}` : 'No case found with that number.';
      } else if (e.district && e.crimeType) {
        const matched = firs.filter(f => f.district.toLowerCase().includes(e.district.toLowerCase()) && f.crime_type.toLowerCase().includes(e.crimeType.toLowerCase()));
        firs = matched.slice(0,12); hasMore = matched.length>firs.length;
        ctx = `Cases — ${e.district}, ${e.crimeType} (${firs.length}):\n`+firs.map(fmtFIR).join('\n');
      } else if (e.district) {
        const matched = firs.filter(f => f.district.toLowerCase().includes(e.district.toLowerCase()));
        firs = matched.slice(0,12); hasMore = matched.length>firs.length;
        ctx = `Cases in ${e.district} (${firs.length}):\n`+firs.map(fmtFIR).join('\n');
      } else if (e.crimeType) {
        const matched = firs.filter(f => f.crime_type.toLowerCase().includes(e.crimeType.toLowerCase()));
        firs = matched.slice(0,12); hasMore = matched.length>firs.length;
        ctx = `${e.crimeType} cases (${firs.length}):\n`+firs.map(fmtFIR).join('\n');
      } else {
        const lowerMsg = message.toLowerCase();
        const status = /pending/.test(lowerMsg) ? 'Pending Trial'
          : /closed|disposed/.test(lowerMsg) ? 'Closed - FR'
          : /charge.?sheet/.test(lowerMsg) ? 'Charge Sheeted'
          : 'Under Investigation';
        const matched = firs.filter(f => f.status === status);
        firs = matched.slice(0,12); hasMore = matched.length>firs.length;
        ctx = `Cases with status "${status}" (${firs.length}):\n`+firs.map(fmtFIR).join('\n');
      }
      rows = firs;
    }

    else if(intent==='mo_analysis'){
      // Recurring modus operandi — parsed from Inv_OccuranceTime.BriefFacts
      // ("… MO: <description>.") and clustered on identical narratives.
      const [caseRows, occRows] = await Promise.all([
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMajorHeadID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate FROM CaseMaster'),
        qAll(app, q, 'SELECT CaseMasterID, IncidentFromDate, BriefFacts FROM Inv_OccuranceTime'),
      ]);
      const occByCase={}; flatAll(occRows,'Inv_OccuranceTime').forEach(o=>{occByCase[o.CaseMasterID]=o;});
      let cases = flatAll(caseRows,'CaseMaster').map(c=>{
        const occ=occByCase[c.CaseMasterID]||{};
        const inc=occ.IncidentFromDate?new Date(occ.IncidentFromDate):null;
        return denormalizeCase(c,lookups,{ mo:extractMO(occ.BriefFacts), hour:inc&&!Number.isNaN(inc.getTime())?inc.getHours():null });
      });
      if (e.district)  cases = cases.filter(c=>c.district.toLowerCase().includes(e.district.toLowerCase()));
      if (e.crimeType) cases = cases.filter(c=>c.crime_type.toLowerCase().includes(e.crimeType.toLowerCase()));
      const allPatterns = groupMOPatterns(cases);
      const patterns = allPatterns.slice(0,8); hasMore = allPatterns.length>patterns.length;
      rows = patterns;
      // Distinct MO narratives for Zia Text Analytics enrichment (entities +
      // key methods across the recurring modus operandi).
      narratives = [...new Set(patterns.map(p=>p.mo).filter(Boolean))];
      ctx = `RECURRING MODUS OPERANDI PATTERNS (${patterns.length} distinct, from ${cases.filter(c=>c.mo).length} cases with recorded MO):\n` +
        patterns.map(p =>
          `• **${p.mo}** — **${p.count} cases**\n  Concentrated in: ${p.topDistricts.map(d=>`${d.name} (${d.count})`).join(', ')} | Crimes: ${p.topCrimes.map(c=>c.name).join(', ')} | Peak window: **${p.peakBand}**\n  Sample cases: ${p.sampleCases.slice(0,3).map(s=>s.fir_number).join(', ')}`
        ).join('\n');
    }

    else if(intent==='network_analysis'){
      const [relRows,finRows] = await Promise.all([
        q(app,'SELECT rel_id, from_id, from_type, to_id, to_type, rel_type, strength FROM Relationships LIMIT 50'),
        q(app,'SELECT account_number, bank, linked_accused_id, suspicious_txn_count, total_suspicious_amount, notes FROM FinancialAccounts WHERE flagged = true LIMIT 20'),
      ]);
      const rels = flatAll(relRows,'Relationships');
      const fin  = flatAll(finRows,'FinancialAccounts');
      ctx=`CRIMINAL NETWORK (${Math.min(rels.length,15)} links):\n`+rels.slice(0,15).map(fmtRel).join('\n');
      if (fin.length) ctx+=`\n\nFLAGGED ACCOUNTS (${Math.min(fin.length,8)}):\n`+fin.slice(0,8).map(fmtFinancial).join('\n');
      rows=[...rels,...fin];
      hasMore = rels.length>15 || fin.length>8;
      if (e.accusedId) {
        const acc = await q(app, `SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused WHERE AccusedMasterID = ${Number(e.accusedId)}`);
        if (acc.length) ctx += `\n\nACCUSED:\n• ${flat(acc[0],'Accused').AccusedName}`;
      }
    }

    else {
      // pattern_analysis / forecast / general — full cross-table summary
      const [caseRows, accusedRows] = await Promise.all([
        qAll(app, q, 'SELECT CaseMasterID, CrimeNo, PoliceStationID, CrimeMinorHeadID, CaseStatusID FROM CaseMaster'),
        qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName FROM Accused'),
      ]);
      const cases = flatAll(caseRows,'CaseMaster').map(c => denormalizeCase(c, lookups));
      const accused = flatAll(accusedRows,'Accused');

      const byDist={};
      cases.forEach(f=>{
        if(!byDist[f.district]) byDist[f.district]={total:0,open:0,types:{}};
        byDist[f.district].total++;
        byDist[f.district].types[f.crime_type]=(byDist[f.district].types[f.crime_type]||0)+1;
        if(f.status!=='Closed - FR') byDist[f.district].open++;
      });
      const distSum=Object.entries(byDist).sort((a,b)=>b[1].total-a[1].total).slice(0,8)
        .map(([d,v])=>{ const top=Object.entries(v.types).sort((a,b)=>b[1]-a[1])[0]; return `  ${d}: ${v.total} cases, ${v.open} open (${Math.round(v.open/v.total*100)}%) — top: ${top?.[0]||'N/A'}`; }).join('\n');

      const byCrime={};
      cases.forEach(f=>{byCrime[f.crime_type]=(byCrime[f.crime_type]||0)+1;});
      const crimeSum=Object.entries(byCrime).sort((a,b)=>b[1]-a[1]).slice(0,6)
        .map(([t,c])=>`  ${t}: ${c} (${Math.round(c/cases.length*100)}%)`).join('\n');

      const chargesheeted = cases.filter(f=>f.status==='Charge Sheeted').length;
      const rate = cases.length ? Math.round(chargesheeted/cases.length*100) : 0;

      const nameCount={}; accused.forEach(a=>{nameCount[a.AccusedName]=(nameCount[a.AccusedName]||0)+1;});
      const repeatList=[...new Set(accused.filter(a=>nameCount[a.AccusedName]>1).map(a=>a.AccusedName))].slice(0,6)
        .map(n=>`  **${n}** — ${nameCount[n]} case(s) on record`).join('\n');

      ctx=[
        `SYSTEM SUMMARY — ${cases.length} cases | Charge-sheet rate: ${chargesheeted}/${cases.length} (${rate}%)`,
        `\nDISTRICT BREAKDOWN:\n${distSum}`,
        `\nCRIME BREAKDOWN:\n${crimeSum}`,
        `\nLIKELY REPEAT OFFENDERS (by name match):\n${repeatList||'  None found'}`,
      ].join('\n');
      rows=cases;
    }
  }catch(err){console.error('FETCH_ERR:',err.message);}
  return {context:ctx,rowCount:rows.length,hasMore,rows,narratives};
}

// ─────────────────────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function extractHighlights(reply,intent){
  const nums=[...reply.matchAll(/\*\*([\d,]+(?:\/\d+)?)\*\*/g)].slice(0,3);
  const names=[...reply.matchAll(/\*\*([A-Za-z][\w\s\-]{2,22})\*\*/g)].slice(0,3);
  const colors=['cyan','red','amber','green','blue'];
  const badge={
    audit_query     :{value:'🔍',label:'Audit Trail',     color:'blue'},
    user_profile    :{value:'👤',label:'Officers',         color:'blue'},
    fir_accused_link:{value:'🔗',label:'Case–Accused',     color:'cyan'},
    network_analysis:{value:'🕸',label:'Criminal Network', color:'red'},
    mo_analysis     :{value:'🧩',label:'MO Patterns',      color:'amber'},
    victim_lookup   :{value:'🧍',label:'Victims',          color:'amber'},
    repeat_offenders:{value:'⚠',label:'Repeat Offenders', color:'red'},
    offender_profile:{value:'🧾',label:'Offender Profile', color:'red'},
    accused_comparison:{value:'⚖',label:'Accused Comparison', color:'red'},
    district_comparison:{value:'⚖',label:'District Comparison', color:'blue'},
    fir_lookup      :{value:'📁',label:'Case Records',     color:'cyan'},
    forecast        :{value:'📡',label:'Forecast',         color:'green'},
    pattern_analysis:{value:'📊',label:'Statistics',       color:'green'},
    general         :{value:'🔎',label:'Intelligence',     color:'cyan'},
  };
  const base=nums.map((m,i)=>({value:m[1],label:names[i]?.[1]||['Cases','Accused','Districts'][i]||'Count',color:colors[i%colors.length]}));
  return badge[intent]?[badge[intent],...base]:base;
}

function getSuggestions(intent){
  const map={
    audit_query     :['Show all audit entries from today','Which user accessed most records?','Show case-related access logs'],
    user_profile    :['List all officers in Bengaluru','Show all inspector-rank officers','Officers at Koramangala PS'],
    fir_accused_link:['Show all accused in this case','List co-accused for a specific case'],
    fir_lookup      :['Show all murder cases','Cases filed in Mysuru last month','List all pending trial cases'],
    offender_profile:['Show repeat offenders in this district','Who are their known associates?'],
    accused_comparison:['Compare ACC-12 and ACC-45 as a bar chart','Which of these two has more cases on record?'],
    district_comparison:['Compare cases of Bengaluru and Mysuru in a bar chart','Which district has more repeat offenders?'],
    repeat_offenders:['Who is the highest risk repeat offender?','Which district has most repeat offenders?'],
    network_analysis:['Show all flagged financial accounts','Which accused share financial accounts?'],
    mo_analysis     :['Which MO is most common in Bengaluru?','Show recurring robbery methods','Which cases share the same modus operandi?'],
    pattern_analysis:['Which district has most unsolved cases?','What is the charge-sheet rate by district?'],
    forecast        :['Which districts are current hotspots?','Where are highest risk open cases?'],
    victim_lookup   :['How many victims are from Bengaluru?','Show victims linked to a case'],
    general         :['Give full crime summary for Karnataka','Top 5 highest risk offenders','Show all murder cases'],
  };
  return map[intent]||map.general;
}

function getAction(intent){
  const map={
    audit_query     :{label:'View complete audit trail',     query:'Show all audit log entries with user actions and timestamps'},
    user_profile    :{label:'List all officers',              query:'List every officer with district, rank, and designation'},
    fir_accused_link:{label:'Show all accused in this case',  query:'List every accused linked to this case'},
    fir_lookup      :{label:'Show all active cases',          query:'List all cases currently under investigation across Karnataka'},
    offender_profile:{label:'Full profile and network',       query:'Complete profile with case links and associates'},
    accused_comparison:{label:'Show full network for both',   query:'Show the criminal network connections for both accused'},
    district_comparison:{label:'Show full pattern analysis',  query:'Give me a complete crime pattern analysis across all districts'},
    repeat_offenders:{label:'Profile top risk offender',      query:'Full profile of highest risk repeat offender'},
    network_analysis:{label:'Trace full money trail',         query:'Show all flagged financial accounts and suspicious transaction patterns'},
    mo_analysis     :{label:'Cross-case MO investigation',    query:'List all cases sharing the most common modus operandi with districts and time windows'},
    pattern_analysis:{label:'Show unsolved high-risk cases',  query:'List all unsolved murder cases by district'},
    forecast        :{label:'View active hotspot districts',  query:'Which districts have most open cases and highest combined risk scores?'},
    victim_lookup   :{label:'Link victims to case',           query:'Show victim details for recent cases'},
    general         :{label:'Run full intelligence briefing', query:'Complete crime intelligence summary across all districts and all crime types'},
  };
  return map[intent]||map.general;
}

// Human-sounding explanation for the "why this answer" panel — replaces a
// clinical log-line format ("Intent classified as...") with the kind of
// first-person explanation a colleague would actually give out loud.
const INTENT_SPOKEN = {
  audit_query:'you asked about audit activity', user_profile:'you asked about officers',
  victim_lookup:'you asked about victims', network_analysis:'you asked about connections between people or accounts',
  forecast:'you asked about hotspots or predictions', repeat_offenders:'you asked about repeat offenders',
  fir_accused_link:'you asked who’s linked to a case', offender_profile:'you asked about a specific person or offender profile',
  accused_comparison:'you asked me to compare two or more accused side by side',
  district_comparison:'you asked me to compare two or more districts side by side',
  fir_lookup:'you asked about cases or FIRs', mo_analysis:'you asked about recurring crime patterns (MO)',
  pattern_analysis:'you asked for statistics or a trend breakdown', general:'your question',
};

function humanReasoning({ intent, rowCount, hasMore, dbContext, ragFailed, kanglishDetected, effMessage, followUpUsed }) {
  const sentences = [];

  if (kanglishDetected) {
    sentences.push(`You typed that partly in Kannada using English letters, so I read it as "${effMessage.slice(0,100)}" and answered from there.`);
  }
  if (followUpUsed) {
    sentences.push(`Since you didn't repeat the district/person/case from your last message, I carried that over — this reads as a continuation of what we were just talking about.`);
  }

  sentences.push(`I understood ${INTENT_SPOKEN[intent] || 'your question'}, so I went straight to the matching records instead of giving a generic overview.`);

  if (dbContext) {
    sentences.push(rowCount === 1
      ? `I found exactly one matching record in the live Data Store and based the answer on that.`
      : `I pulled ${rowCount} matching record${rowCount===1?'':'s'} from the live Data Store${hasMore ? ' — there are more than what I listed, so I kept it to the most relevant ones' : ''}.`);
  } else {
    sentences.push(`I didn't find matching live records for this, so I'm answering from general knowledge rather than a specific case file — treat it as background, not confirmed data.`);
  }

  sentences.push(ragFailed
    ? `The AI writing step timed out this round, so what you're seeing is the raw data itself rather than a summarized answer — still accurate, just less polished.`
    : `I only used what's in that retrieved data to write the answer — I didn't add or guess anything beyond it.`);

  return sentences;
}

function getAlert(reply){
  const r=reply.toLowerCase();
  if(/unsolved.*murder|murder.*open|open.*murder/.test(r))       return {level:'critical',msg:'Unsolved murder detected — escalate to senior IO immediately'};
  // Extreme-risk = an ACTUAL risk score of 85+ out of 100 in the answer. We
  // parse the numerator of every "NN/100" rather than matching "risk … 100"
  // loosely — the old pattern fired on the "/100" denominator of even a low
  // score (e.g. "low risk (30/100)"), producing false critical alerts.
  const riskScores=[...r.matchAll(/(\d{1,3})\s*\/\s*100\b/g)].map(m=>Number(m[1]));
  if(riskScores.some(n=>n>=85))                                 return {level:'critical',msg:'Extreme risk offender — recommend immediate surveillance'};
  if(/gang|organised crime|organized crime/.test(r))            return {level:'high',msg:'Organised crime network detected — coordinate with Special Branch'};
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHAT HISTORY PERSISTENCE
// Every conversation is stored server-side (ChatSessions/ChatMessages) rather
// than only in the browser, so it survives across devices — same model as
// consumer AI assistants. JSON-bearing fields (reasoning/highlights/etc.) are
// escaped with escJson (preserves the double quotes JSON needs; escStr would
// strip them and corrupt the structure).
// ─────────────────────────────────────────────────────────────────────────────
function escJson(value) {
  const s = JSON.stringify(value ?? null);
  return s.replace(/\\/g, '').replace(/'/g, '’').replace(/;/g, ',');
}

const INTENT_TITLE_LABEL = {
  audit_query:'Audit Trail', user_profile:'Officer Directory', victim_lookup:'Victim Lookup',
  network_analysis:'Network Analysis', forecast:'Forecast', repeat_offenders:'Repeat Offenders',
  fir_accused_link:'Case–Accused Link', offender_profile:'Offender Profile', fir_lookup:'Case Records',
  mo_analysis:'MO Patterns', pattern_analysis:'Pattern Analysis', general:'New Conversation',
};

// Deterministic title used only if the RAG rephrase call fails — still not
// a copy of the raw question, built instead from what was actually resolved.
function fallbackTitle(intent, entities) {
  const parts = [INTENT_TITLE_LABEL[intent] || 'Conversation'];
  if (entities.district) parts.push(entities.district);
  else if (entities.crimeType) parts.push(entities.crimeType);
  else if (entities.accusedId) parts.push(`ACC-${entities.accusedId}`);
  else if (entities.personName) parts.push(entities.personName);
  return parts.join(' — ');
}

// Creates/updates the ChatSessions row and inserts both sides of the turn
// into ChatMessages. Best-effort: chat still works even if persistence fails
// (e.g. tables not yet provisioned), it just won't show up in history.
async function persistChatTurn(app, { sessionId, isNewSession, userId, title, userText, aiMsg }) {
  if (!app || !userId) return;
  try {
    if (isNewSession) {
      await app.zcql().executeZCQLQuery(
        `INSERT INTO ChatSessions (session_id,user_id,title,message_count) VALUES ('${sessionId}','${escStr(userId)}','${escStr(title)}',2)`
      );
    } else {
      await app.zcql().executeZCQLQuery(
        `UPDATE ChatSessions SET updated_at = CURRENT_TIMESTAMP(), message_count = message_count + 2 WHERE session_id = '${sessionId}'`
      );
    }
    const base = Date.now();
    await app.zcql().executeZCQLQuery(
      `INSERT INTO ChatMessages (message_id,session_id,sender,text) VALUES ('MSG-${base}-u','${sessionId}','user','${escLongText(userText, 4000)}')`
    );
    await app.zcql().executeZCQLQuery(
      `INSERT INTO ChatMessages (message_id,session_id,sender,text,intent,confidence,reasoning,highlights,suggestions,action,alert,evidence) VALUES ` +
      `('MSG-${base}-a','${sessionId}','ai','${escLongText(aiMsg.text, 6000)}','${escId(aiMsg.intent)}',${Number(aiMsg.confidence)||0},` +
      `'${escJson(aiMsg.reasoning)}','${escJson(aiMsg.highlights)}','${escJson(aiMsg.suggestions)}','${escJson(aiMsg.action)}','${escStr(aiMsg.alert||'')}','${escJson(aiMsg.evidence)}')`
    );
  } catch (e) { console.error('CHAT_PERSIST_FAIL:', e.message); }
}

// Rephrases the officer's first question into a short chat title via the
// same RAG engine — never returns the question verbatim.
async function generateSessionTitle(token, question) {
  try {
    const ragResult = await httpsPost(
      'api.catalyst.zoho.in', `/quickml/v1/project/${PROJECT_ID}/rag/answer`,
      {'Content-Type':'application/json','Authorization':`Zoho-oauthtoken ${token}`,'CATALYST-ORG':CATALYST_ORG},
      { query: `Rephrase the following police officer's question into a short chat conversation title — 3 to 6 words, title case, no quotes, no trailing punctuation, describing the topic rather than repeating the wording. Reply with ONLY the title text and nothing else.\n\nQuestion: "${question}"`, documents: [DOC_ID] },
      12000
    );
    let title = (ragResult.response || ragResult.answer || '').trim();
    title = title.split('\n')[0].replace(/^["'\`]+|["'\`]+$/g, '').replace(/[.!]+$/, '').trim();
    if (title && title.length <= 80 && title.toLowerCase() !== question.toLowerCase().trim()) return title;
  } catch (e) { console.error('TITLE_RAG_FAIL:', e.message); }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI INTELLIGENCE BRIEFING
// One-click narrative report that stitches together everything already
// computed elsewhere (live alerts, anomalies, recurring MO, forecast, top
// repeat offenders) into a single readable document — grounded in real
// numbers, with a deterministic fallback if the RAG call is unavailable so
// the feature always produces a usable briefing.
// ─────────────────────────────────────────────────────────────────────────────
const BRIEFING_SYSTEM = `You are KAVACH, writing a formal intelligence briefing for a senior Karnataka Police officer.
Structure the briefing with these exact markdown section headers, in this order:
## Situation Overview
## Emerging Threats & Anomalies
## Repeat Offender Watch
## Recurring Modus Operandi
## Recommended Actions

RULES:
1. Use only the facts in the BRIEFING FACTS block below — never invent a number, name, district, or FIR/accused ID.
2. Bold (**) every FIR number, accused ID, district name, and figure.
3. Each section: 2-4 tight sentences or bullet points — no filler, no repetition across sections.
4. "Recommended Actions" must be concrete and specific to the facts above (name the district/offender/MO involved), not generic advice.
5. Write like a briefing document, not a chat answer — no greeting, no "I found that...".`;

async function gatherBriefingData(app, lookups, scopeDistrict) {
  let cases = await loadIntelCases(app, q, lookups);
  if (scopeDistrict && scopeDistrict !== 'Statewide') {
    cases = cases.filter(c => c.district.toLowerCase() === scopeDistrict.toLowerCase());
  }
  const [accusedRows, accRows] = await Promise.all([
    qAll(app, q, 'SELECT AccusedMasterID, CaseMasterID, AccusedName, AgeYear, GenderID FROM Accused'),
    q(app, 'SELECT account_id, flagged, total_suspicious_amount, suspicious_txn_count FROM FinancialAccounts LIMIT 200'),
  ]);
  const caseIds = new Set(cases.map(c => c.fir_id));
  const firByCaseId = {}; const gravityByCaseId = {};
  cases.forEach(c => { firByCaseId[c.fir_id] = c; gravityByCaseId[c.fir_id] = c.gravity; });
  let profiles = computeAccusedProfiles(flatAll(accusedRows, 'Accused'), firByCaseId, gravityByCaseId)
    .filter(p => caseIds.has(String(p.case_id)));
  const accounts = flatAll(accRows, 'FinancialAccounts');
  const moGroups  = groupMOPatterns(cases);
  const anomalies = detectAnomalies(cases);
  const alerts    = buildLiveAlerts({ cases, profiles, accounts, moGroups, anomalies });
  const series    = monthlySeries(cases.map(c => c.date_filed).filter(Boolean));
  const hw        = holtWinters(series.values, 12, 3);

  const distCounts = {}; const crimeCounts = {}; let open = 0, chargesheeted = 0;
  cases.forEach(c => {
    distCounts[c.district] = (distCounts[c.district] || 0) + 1;
    crimeCounts[c.crime_type] = (crimeCounts[c.crime_type] || 0) + 1;
    if (c.status === 'Under Investigation' || c.status === 'Pending Trial') open++;
    if (c.status === 'Charge Sheeted') chargesheeted++;
  });
  const topDistricts = Object.entries(distCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topCrimes     = Object.entries(crimeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topOffenders  = profiles.filter(p => p.is_repeat_offender === 1).sort((a, b) => b.risk_score - a.risk_score).slice(0, 5);
  const flaggedAccounts = accounts.filter(a => Number(a.flagged) === 1 || a.flagged === true);

  return {
    cases, profiles, accounts, moGroups: moGroups.slice(0, 5), anomalies: anomalies.slice(0, 5),
    alerts, series, hw, topDistricts, topCrimes, topOffenders, flaggedAccounts,
    stats: {
      totalCases: cases.length, open, chargesheeted,
      chargesheetRate: cases.length ? Math.round((chargesheeted / cases.length) * 100) : 0,
      totalAccused: profiles.length,
      repeatOffenders: profiles.filter(p => p.is_repeat_offender === 1).length,
    },
  };
}

function buildBriefingFacts(scope, d) {
  const lines = [`BRIEFING FACTS — Scope: ${scope}`, `Generated: ${new Date().toISOString()}`, ''];
  lines.push(`CASE VOLUME: ${d.stats.totalCases} total cases | ${d.stats.open} open | ${d.stats.chargesheeted} charge-sheeted (${d.stats.chargesheetRate}%) | ${d.stats.totalAccused} accused | ${d.stats.repeatOffenders} repeat offenders`);
  lines.push('', 'TOP DISTRICTS BY CASELOAD:', ...d.topDistricts.map(([n, c]) => `  ${n}: ${c} cases`));
  lines.push('', 'TOP CRIME TYPES:', ...d.topCrimes.map(([n, c]) => `  ${n}: ${c} cases`));
  lines.push('', d.anomalies.length ? 'STATISTICAL ANOMALIES (z-score ≥ 2 vs district baseline):' : 'STATISTICAL ANOMALIES: none detected this period.',
    ...d.anomalies.map(a => `  ${a.district}: ${a.count} cases in ${a.month} vs ${a.expected} expected (z=${a.zscore}, ${a.direction})`));
  lines.push('', d.moGroups.length ? 'TOP RECURRING MO PATTERNS:' : 'RECURRING MO PATTERNS: none found.',
    ...d.moGroups.map(g => `  "${g.mo}" — ${g.count} cases, concentrated in ${g.topDistricts.map(x => x.name).join(', ')}, peak ${g.peakBand}`));
  lines.push('', d.topOffenders.length ? 'TOP REPEAT OFFENDERS BY RISK:' : 'TOP REPEAT OFFENDERS: none found.',
    ...d.topOffenders.map(p => `  ${p.name} (${p.accused_id}) — risk ${p.risk_score}/100, ${p.district}, ${p.primary_crime}, ${p.repeat_case_count} cases on record`));
  if (d.flaggedAccounts.length) {
    const total = d.flaggedAccounts.reduce((s, a) => s + (Number(a.total_suspicious_amount) || 0), 0);
    lines.push('', `FINANCIAL CRIME: ${d.flaggedAccounts.length} flagged accounts, ₹${total.toLocaleString('en-IN')} suspicious volume traced.`);
  }
  if (d.hw?.forecast?.length) {
    lines.push('', `FORECAST (${d.hw.method}, in-sample MAPE ${d.hw.mape ?? '—'}%): next ${d.hw.forecast.length} months — ${d.hw.forecast.join(', ')} cases predicted.`);
  }
  return lines.join('\n');
}

// Deterministic fallback — guarantees the briefing always renders even if
// the RAG call times out, using the exact same section structure.
function templateBriefing(scope, d) {
  const S = [];
  S.push(`## Situation Overview`);
  S.push(`${scope === 'Statewide' ? 'Karnataka' : scope} currently has **${d.stats.totalCases} cases** on record, of which **${d.stats.open} remain open** and **${d.stats.chargesheeted} (${d.stats.chargesheetRate}%)** have been charge-sheeted. **${d.stats.repeatOffenders} of ${d.stats.totalAccused} accused** are flagged as repeat offenders. Top caseload: ${d.topDistricts.slice(0, 3).map(([n, c]) => `**${n}** (${c})`).join(', ') || 'no data'}. Leading crime type: ${d.topCrimes[0] ? `**${d.topCrimes[0][0]}** (${d.topCrimes[0][1]} cases)` : 'N/A'}.`);

  S.push(`\n## Emerging Threats & Anomalies`);
  S.push(d.anomalies.length
    ? d.anomalies.slice(0, 3).map(a => `**${a.district}** recorded **${a.count} cases** in ${a.month} vs an expected ${a.expected} (z=${a.zscore}) — a statistically significant ${a.direction}.`).join(' ')
    : 'No district currently deviates significantly (|z| ≥ 2) from its historical monthly baseline.');

  S.push(`\n## Repeat Offender Watch`);
  S.push(d.topOffenders.length
    ? d.topOffenders.slice(0, 3).map(p => `**${p.name}** (**${p.accused_id}**) — risk **${p.risk_score}/100**, linked to **${p.primary_crime}** in **${p.district}**, ${p.repeat_case_count} cases on record.`).join(' ')
    : 'No repeat offenders identified in the current scope.');

  S.push(`\n## Recurring Modus Operandi`);
  S.push(d.moGroups.length
    ? d.moGroups.slice(0, 2).map(g => `**"${g.mo}"** appears across **${g.count} cases**, concentrated in ${g.topDistricts.map(x => `**${x.name}**`).join(', ')}, peaking **${g.peakBand}**.`).join(' ')
    : 'No recurring MO clusters found in the current scope.');

  S.push(`\n## Recommended Actions`);
  const actions = [];
  if (d.anomalies[0]) actions.push(`Deploy additional patrol to **${d.anomalies[0].district}** where case volume spiked to ${d.anomalies[0].count} in ${d.anomalies[0].month}.`);
  if (d.topOffenders[0]) actions.push(`Initiate surveillance on **${d.topOffenders[0].name} (${d.topOffenders[0].accused_id})** — highest risk score in scope.`);
  if (d.moGroups[0]) actions.push(`Open a cross-case task force for the **"${d.moGroups[0].mo}"** pattern given its ${d.moGroups[0].count}-case footprint.`);
  if (d.flaggedAccounts.length) actions.push(`Forward the ${d.flaggedAccounts.length} flagged financial accounts to FIU-IND for review.`);
  S.push((actions.length ? actions : ['No specific high-priority action identified beyond routine monitoring.']).map(a => `- ${a}`).join('\n'));

  return S.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (context, basicIO) => {
  basicIO.response.set('Access-Control-Allow-Origin','*');
  basicIO.response.set('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(basicIO.request.method==='OPTIONS') return basicIO.response.status(200).send('');

  try{
    const body=typeof basicIO.request.body==='string'?JSON.parse(basicIO.request.body):basicIO.request.body;

    // ── AI INTELLIGENCE BRIEFING (separate from the chat pipeline — no
    // officer message, just a scope) ──────────────────────────────────────
    if (body.action === 'briefing') {
      const scope = escStr(String(body.scope || 'Statewide').trim()) || 'Statewide';
      const briefUser = body.user || {};
      let app=null;
      try{app=catalyst.initialize(context.req||context);}catch(e){console.error('SDK_FAIL:',e.message);}
      if (!app) return basicIO.response.status(200).json({ error: 'Data Store unavailable' });

      const lookups = await loadLookups(app, q);
      const d = await gatherBriefingData(app, lookups, scope);
      if (!d.cases.length) return basicIO.response.status(200).json({ error: `No cases found for scope "${scope}".` });

      const facts = buildBriefingFacts(scope, d);
      let briefing, generatedBy = 'rag';
      try{
        const token = await getToken();
        const ragResult = await httpsPost(
          'api.catalyst.zoho.in', `/quickml/v1/project/${PROJECT_ID}/rag/answer`,
          {'Content-Type':'application/json','Authorization':`Zoho-oauthtoken ${token}`,'CATALYST-ORG':CATALYST_ORG},
          { query: `${BRIEFING_SYSTEM}\n\n${facts}`, documents: [DOC_ID] }, 30000
        );
        if (ragResult.status!=='success') throw new Error('RAG error');
        briefing = ragResult.response || ragResult.answer;
        if (!briefing || !/## /.test(briefing)) throw new Error('RAG returned unstructured output');
      }catch(e){
        console.error('BRIEFING_RAG_FAIL:', e.message);
        briefing = templateBriefing(scope, d);
        generatedBy = 'template';
      }

      const confidence = generatedBy === 'rag' ? 94 : 75;
      const generatedAt = new Date().toISOString();
      const forecastOut = d.hw?.forecast ? { method: d.hw.method, mape: d.hw.mape, nextMonths: d.hw.forecast } : null;

      let briefingId = null;
      if (briefUser?.id) {
        try{
          briefingId = `BRF-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
          const meta = { stats: d.stats, anomalies: d.anomalies, topMO: d.moGroups, topOffenders: d.topOffenders, forecast: forecastOut };
          await app.zcql().executeZCQLQuery(
            `INSERT INTO Briefings (briefing_id,user_id,scope,generated_by,confidence,briefing_text,stats) VALUES ('${briefingId}','${escStr(briefUser.id)}','${escStr(scope)}','${escId(generatedBy)}',${confidence},'${escLongText(briefing, 6000)}','${escJson(meta)}')`
          );
        }catch(e){ console.error('BRIEFING_PERSIST_FAIL:', e.message); briefingId = null; }
      }

      return basicIO.response.status(200).json({
        briefingId, briefing, scope, generatedAt, generatedBy,
        stats: d.stats,
        alerts: d.alerts.slice(0, 5),
        anomalies: d.anomalies,
        topMO: d.moGroups,
        topOffenders: d.topOffenders,
        forecast: forecastOut,
        confidence,
      });
    }

    const{message,language='en',history=[],user:reqUser={},sessionId:reqSessionId=null}=body;
    if(!message?.trim()) return basicIO.response.status(400).json({error:'message required'});

    const isNewSession = !reqSessionId;
    const sessionId = reqSessionId || `SESS-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    let app=null;
    try{app=catalyst.initialize(context.req||context);console.log('SDK: OK');}
    catch(e){console.error('SDK_FAIL:',e.message);}

    // Kanglish: "Bengaluru alli eshtu kesu ide?" → "in Bengaluru how many
    // cases are there?" — normalized text drives the whole pipeline; the
    // officer's original wording is still what gets sent to the LLM.
    const kanglish = normalizeKanglish(message);
    const effMessage = kanglish.text;
    const wantsKannada = language==='kn' || /[ಀ-೿]/.test(message);

    const intent=detectIntent(effMessage);
    // Comparisons default to a table (easiest to scan two items side by
    // side) unless the officer explicitly names a different chart type.
    const isComparison = intent==='accused_comparison' || intent==='district_comparison';
    // The chart TYPE the officer explicitly asked for, if any ("as a pie
    // chart"). Final chart type is resolved after the reply, factoring in
    // deterministic defaults and whatever the model chose to emit.
    const explicitType = detectChartType(effMessage);
    console.log('INTENT:',intent,'| EXPLICIT_CHART:',explicitType||'-','| KANGLISH:',kanglish.detected,'| MSG:',message.slice(0,70));

    // Officer's own prior questions (not the AI's prose replies) are the
    // reliable signal for resolving follow-ups like "what about him?".
    const priorUserMessages = history.filter(h => h.role === 'user').map(h => normalizeKanglish(h.content).text).slice(-4);
    const entities = extractEntities(effMessage, priorUserMessages);

    // If the query is short, generic, and resolves to no entity even after
    // checking recent context, the officer likely mistyped or left out
    // something — ask for the missing piece instead of guessing with a
    // full system-wide dump (which reads as a wrong/irrelevant answer).
    const wordCount = effMessage.trim().split(/\s+/).length;
    const hasEntity = Object.entries(entities).some(([k,v]) => k!=='followUpUsed' && v!=null);
    const isVague = intent==='general' && wordCount<=4 && !hasEntity;

    if (isVague) {
      console.log('CLARIFY: vague query, short-circuiting RAG');
      const clarifyMsg = {
        text: wantsKannada
          ? `ಸರಿಯಾಗಿ ಉತ್ತರಿಸಲು ಸ್ವಲ್ಪ ಹೆಚ್ಚು ಮಾಹಿತಿ ಬೇಕು — ದಯವಿಟ್ಟು ಸ್ಪಷ್ಟಪಡಿಸಿ: **ಜಿಲ್ಲೆ** (ಉದಾ: ಬೆಂಗಳೂರು ನಗರ), **ಅಪರಾಧದ ವಿಧ** (ಉದಾ: ದರೋಡೆ), **ಆರೋಪಿ ID** (ಉದಾ: ACC-123), ಅಥವಾ **ಪ್ರಕರಣ ಸಂಖ್ಯೆ**.`
          : `I want to make sure I get this right — could you clarify what you're looking for? For example: a **district** (e.g. Bengaluru Urban), a **crime type** (e.g. robbery, POCSO), an **accused ID** (e.g. ACC-123), or a **case number**.`,
        intent: 'general', confidence: 40,
        reasoning: [`That was a bit too open-ended for me to point at a specific case, person, or district, so I asked you to narrow it down rather than dump everything I have.`],
        highlights: [], suggestions: ['Show repeat offenders in Bengaluru Urban', 'List all murder cases', 'Which district has the most cases?'],
        action: null, alert: null, evidence: [],
      };
      if (app && reqUser?.id) {
        await persistChatTurn(app, {
          sessionId, isNewSession, userId: reqUser.id,
          title: fallbackTitle(intent, entities), userText: message, aiMsg: clarifyMsg,
        });
      }
      return basicIO.response.status(200).json({
        reply: clarifyMsg.text, intent: clarifyMsg.intent,
        highlights: clarifyMsg.highlights, suggestions: clarifyMsg.suggestions,
        action: clarifyMsg.action, alert: null, alertLevel: null,
        sources: [], confidence: clarifyMsg.confidence, reasoning: clarifyMsg.reasoning,
        evidenceRowCount: 0,
        sessionId: (app && reqUser?.id) ? sessionId : null,
        sessionTitle: isNewSession ? fallbackTitle(intent, entities) : null,
      });
    }

    const[tokenRes,dbRes]=await Promise.allSettled([
      getToken(),
      app ? loadLookups(app,q).then(lookups => fetchData(app,intent,effMessage,lookups,priorUserMessages)) : Promise.resolve({context:'',rowCount:0,hasMore:false}),
    ]);

    const token    =tokenRes.status==='fulfilled'?tokenRes.value:null;
    const dbContext=dbRes.status==='fulfilled'?dbRes.value.context:'';
    const rowCount =dbRes.status==='fulfilled'?dbRes.value.rowCount:0;
    const hasMore  =dbRes.status==='fulfilled'?dbRes.value.hasMore:false;
    const dbRows   =dbRes.status==='fulfilled'?(dbRes.value.rows||[]):[];
    const dbNarratives =dbRes.status==='fulfilled'?(dbRes.value.narratives||[]):[];

    // Zia Text Analytics enrichment for MO questions — kicked off here so it
    // runs concurrently with the RAG reply below (zero added latency).
    const ziaPromise = (intent==='mo_analysis' && dbNarratives.length && app)
      ? runZiaAnalysis(app, dbNarratives)
      : Promise.resolve(null);

    // Guaranteed chart data for comparison intents, built directly from the
    // structured rows we already fetched — not by regex-parsing the LLM's
    // prose. The model doesn't always phrase "**Label**: N" exactly on its
    // own line every time, so relying on text-parsing alone was dropping
    // the chart on some phrasings; this is correct regardless of wording.
    let chartData = null;
    if (intent === 'accused_comparison') {
      chartData = dbRows.filter(p => p?.name && p?.risk_score != null).map(p => ({ label: p.name, value: p.risk_score }));
    } else if (intent === 'district_comparison') {
      chartData = dbRows.filter(s => s?.label && s?.caseCount != null).map(s => ({ label: s.label, value: s.caseCount }));
    }
    if (!chartData || chartData.length < 2) chartData = null;

    // Same guaranteed-correct approach for a readable table — built from the
    // real rows, not by hoping the model formats markdown pipes correctly.
    const tableData = buildTableData(intent, dbRows);

    console.log('DB_ROWS:',rowCount,'| CTX:',dbContext.length,'| TOKEN:',token?'OK':'FAIL');
    if(!token) throw new Error('Token unavailable: '+(tokenRes.reason?.message||'unknown'));

    const parts=[SYSTEM_INTRO];
    if(dbContext){
      parts.push('══════════ LIVE DATA FROM KAVACH DATA STORE ══════════\n'+dbContext.slice(0,2500)+'\n══════════════════════════════════════════════════════');
    } else {
      parts.push('[NOTE: Live DB unavailable — answering from knowledge base only]');
    }
    if(history.length>0){
      parts.push('CONVERSATION:\n'+history.slice(-4).map(h=>`${h.role==='user'?'Officer':'KAVACH'}: ${h.content}`).join('\n'));
    }
    if(entities.followUpUsed){
      parts.push('NOTE: This is a follow-up — the officer did not repeat the district/accused/case from their earlier question, so it was carried over from the conversation above. Answer as a natural continuation, not a fresh unrelated query.');
    }
    if(wantsKannada){
      parts.push('LANGUAGE: Respond fully in Kannada (ಕನ್ನಡ script). Keep FIR numbers, accused IDs (ACC-xxx), amounts, and dates exactly as they appear in the data. Use **bold** for key names and numbers just like an English answer would.');
    } else if(kanglish.detected){
      parts.push('NOTE: The officer typed Kannada words in English letters (romanized Kannada); their question has been interpreted below. Respond in clear English.');
    }
    parts.push('OFFICER QUERY: '+message+(kanglish.detected?`\n(Interpreted as: ${effMessage})`:''));

    const ragQuery=parts.join('\n\n');
    console.log('RAG_LEN:',ragQuery.length);

    // The reply and the (new-session-only) title rephrase run concurrently —
    // the title call is small and its own 12s timeout, so it never adds to
    // the reply's worst-case latency.
    const replyPromise = (async () => {
      try{
        const ragResult=await httpsPost(
          'api.catalyst.zoho.in',
          `/quickml/v1/project/${PROJECT_ID}/rag/answer`,
          {'Content-Type':'application/json','Authorization':`Zoho-oauthtoken ${token}`,'CATALYST-ORG':CATALYST_ORG},
          {query:ragQuery,documents:[DOC_ID]},
          45000
        );
        console.log('RAG:',ragResult.status);
        if(ragResult.status!=='success') throw new Error('RAG error: '+JSON.stringify(ragResult).slice(0,200));
        return { reply: ragResult.response||ragResult.answer||'No answer returned.', ragFailed:false };
      }catch(ragErr){
        console.error('RAG_FAIL:',ragErr.message);
        return {
          reply: dbContext
            ? `⚠ *AI narration is temporarily slow — showing live data directly.*\n\n${dbContext.slice(0,1800)}`
            : '⚠ Intelligence engine is temporarily unavailable and no matching live records were found. Please retry in a moment.',
          ragFailed: true,
        };
      }
    })();
    const titlePromise = isNewSession ? generateSessionTitle(token, message) : Promise.resolve(null);

    const [{ reply: rawReply, ragFailed }, ragTitle, ziaData] = await Promise.all([replyPromise, titlePromise, ziaPromise]);
    const sessionTitle = isNewSession ? (ragTitle || fallbackTitle(intent, entities)) : null;

    // The model may have appended a ```kavach {…}``` viz block (rule 11) — pull
    // it out, strip it from the prose, and use it to render a chart/table for
    // ANY query. Deterministic data (computed above for known intents) is
    // trusted first for accuracy; the model's block fills everything else.
    const modelViz = parseModelViz(rawReply);
    const reply = modelViz.cleanReply || rawReply;
    const finalChartData = chartData || modelViz.chartData;
    const finalTableData = tableData || modelViz.tableData;
    let finalChartType;
    if (explicitType)              finalChartType = explicitType;                 // officer asked for a specific type
    else if (chartData)            finalChartType = isComparison ? 'table' : 'bar'; // deterministic default
    else if (modelViz.chartData)   finalChartType = modelViz.chartType;           // model chose a chart
    else if (finalTableData)       finalChartType = 'table';
    else                           finalChartType = isComparison ? 'table' : null;
    console.log('FINAL_CHART:',finalChartType,'| chartData:',finalChartData?.length||0,'| table:',finalTableData?'Y':'-','| modelViz:',modelViz.chartType||(modelViz.tableData?'table':'-'));

    if(app&&reqUser?.id){
      try{
        const safeMsg = escStr(message);
        const safeUid = escStr(reqUser.id);
        await app.zcql().executeZCQLQuery(`INSERT INTO AuditLogs (log_id,user_id,action,resource_type,resource_id,query_text) VALUES ('LOG-${Date.now()}','${safeUid}','CHAT_QUERY','AI','${intent}','${safeMsg}')`);
      }catch(e){console.log('AUDIT_SKIP:',e.message);}
    }

    const alert=getAlert(reply);
    const confidence = ragFailed
      ? (dbContext ? 70 : 20)
      : Math.min(50 + (dbContext ? 30 : 0) + Math.min(rowCount, 10) * 2, 97);
    const reasoning = humanReasoning({
      intent, rowCount, hasMore, dbContext, ragFailed,
      kanglishDetected: kanglish.detected, effMessage, followUpUsed: entities.followUpUsed,
    });

    const highlights  = extractHighlights(reply,intent);
    const suggestions = getSuggestions(intent);
    const action       = hasMore ? getAction(intent) : null;
    const evidence     = dbContext?[`Live Data Store — ${rowCount} records (${intent})`,'Karnataka FIR System (ERD)']:['Karnataka FIR System (ERD)'];

    if (app && reqUser?.id) {
      await persistChatTurn(app, {
        sessionId, isNewSession, userId: reqUser.id, title: sessionTitle,
        userText: message,
        aiMsg: { text: reply, intent, confidence, reasoning, highlights, suggestions, action, alert: alert?.msg||null, evidence, tableData: finalTableData },
      });
    }

    return basicIO.response.status(200).json({
      reply, intent, chartType: finalChartType, chartData: finalChartData, tableData: finalTableData, ziaData: ziaData || null,
      highlights, suggestions, action,
      alert      : alert?.msg||null,
      alertLevel : alert?.level||null,
      sources    : evidence,
      confidence,
      reasoning,
      evidenceRowCount: rowCount,
      sessionId: (app && reqUser?.id) ? sessionId : null,
      sessionTitle,
    });

  }catch(err){
    console.error('CHAT_ERR:',err.message);
    return basicIO.response.status(500).json({
      reply:'⚠ Intelligence engine temporarily unavailable. Please retry.',
      intent:'general',highlights:[],
      suggestions:['Show crime statistics for all districts','Top 5 highest risk offenders','List all open murder cases'],
      action:{label:'Retry full analysis',query:'Show complete crime intelligence summary for Karnataka'},
      alert:null,alertLevel:null,sources:[],
    });
  }
};
