/**
 * Shared data-access helpers for the official ERD schema (backend/schema.sql).
 * Used by data-query and chat-query so both denormalize CaseMaster/Accused/
 * Victim the same way and agree on derived fields the ERD doesn't store
 * directly (crime_type, district, risk_score, is_repeat_offender...).
 *
 * IMPORTANT MODELLING NOTE: the ERD has no stable cross-case person identity
 * for Accused (AccusedMasterID is scoped to one case; PersonID is just a
 * per-case display label like "A1"). Repeat-offender detection here matches
 * on exact AccusedName, which is an approximation, not a guaranteed identity
 * match — documented in backend/schema.sql as an inherited ERD limitation.
 */

const { extractMO } = require('./intel');

const flat    = (row, tbl) => row[tbl] || row;
const flatAll = (rows, tbl) => rows.map(r => flat(r, tbl));

// Deterministic per-crime severity weight (0–15) used in risk scoring — heavier
// for violent/exploitative offences, lighter for property crime. Replaces the
// old random noise term so scores are reproducible and grounded in real data.
const CRIME_SEVERITY = {
  Murder: 15, Rape: 15, POCSO: 15, Kidnapping: 12, 'Sexual Assault': 13,
  Robbery: 10, Narcotics: 10, 'Arms Act': 9, Smuggling: 8, Extortion: 8,
  Assault: 7, 'Cyber Crime': 7, Fraud: 6, 'Domestic Violence': 6,
  Burglary: 5, 'Vehicle Theft': 4, Theft: 3,
};
const crimeSeverity = (crimeType) => CRIME_SEVERITY[crimeType] ?? 5;

// ZCQL enforces a hard 300-row max per query ("ZCQL CANNOT HAVE MORE THAN 300
// ROWS in LIMIT") — this pages through with LIMIT 300 OFFSET n until either
// a short page (< 300) or maxRows is hit, so callers can query without
// worrying about that cap. Pass a SELECT string with NO LIMIT/OFFSET clause.
async function qAll(app, q, baseSql, maxRows = 1500) {
  let all = [];
  let offset = 0;
  while (offset < maxRows) {
    const page = await q(app, `${baseSql} LIMIT 300 OFFSET ${offset}`);
    all = all.concat(page);
    if (page.length < 300) break;
    offset += 300;
  }
  return all;
}

async function loadLookups(app, q) {
  const [districts, units, subHeads, heads, statuses, gravities] = await Promise.all([
    q(app, 'SELECT DistrictID, DistrictName FROM District'),
    q(app, 'SELECT UnitID, UnitName, DistrictID FROM Unit'),
    q(app, 'SELECT CrimeSubHeadID, CrimeHeadID, CrimeHeadName FROM CrimeSubHead'),
    q(app, 'SELECT CrimeHeadID, CrimeGroupName FROM CrimeHead'),
    q(app, 'SELECT CaseStatusID, CaseStatusName FROM CaseStatusMaster'),
    q(app, 'SELECT GravityOffenceID, LookupValue FROM GravityOffence'),
  ]);

  const gravityMap = {};
  flatAll(gravities, 'GravityOffence').forEach(g => { gravityMap[g.GravityOffenceID] = g.LookupValue; });

  const districtMap = {};
  flatAll(districts, 'District').forEach(d => { districtMap[d.DistrictID] = d.DistrictName; });

  const unitMap = {};
  flatAll(units, 'Unit').forEach(u => {
    unitMap[u.UnitID] = { name: u.UnitName, district: districtMap[u.DistrictID] || 'Unknown' };
  });

  const headMap = {};
  flatAll(heads, 'CrimeHead').forEach(h => { headMap[h.CrimeHeadID] = h.CrimeGroupName; });

  const subHeadMap = {};
  flatAll(subHeads, 'CrimeSubHead').forEach(s => { subHeadMap[s.CrimeSubHeadID] = s.CrimeHeadName; });

  const statusMap = {};
  flatAll(statuses, 'CaseStatusMaster').forEach(s => { statusMap[s.CaseStatusID] = s.CaseStatusName; });

  return { districtMap, unitMap, headMap, subHeadMap, statusMap, gravityMap };
}

// CaseMaster row -> FIR-shaped object used throughout the app's JSON contracts
function denormalizeCase(c, lookups, extra = {}) {
  const unit = lookups.unitMap[c.PoliceStationID] || {};
  return {
    fir_id:       String(c.CaseMasterID),
    fir_number:   c.CrimeNo,
    case_no:      c.CaseNo,
    district:     unit.district || 'Unknown',
    station:      unit.name || 'N/A',
    crime_type:   lookups.subHeadMap[c.CrimeMinorHeadID] || 'Other',
    crime_head:   lookups.headMap[c.CrimeMajorHeadID] || 'Other',
    status:       lookups.statusMap[c.CaseStatusID] || 'Unknown',
    date_filed:   c.CrimeRegisteredDate,
    ...extra,
  };
}

// Given all Accused rows + a caseId->denormalized-FIR map, compute per-accused
// derived fields: district/crime_type from their case, repeat-offender count
// (by exact name match), and a composite risk score.
function computeAccusedProfiles(accusedRows, firByCaseId, gravityByCaseId) {
  const nameCount = {};
  accusedRows.forEach(a => { nameCount[a.AccusedName] = (nameCount[a.AccusedName] || 0) + 1; });

  return accusedRows.map(a => {
    const fir = firByCaseId[a.CaseMasterID] || {};
    const repeatCount = nameCount[a.AccusedName] || 1;
    const isHeinous = (gravityByCaseId?.[a.CaseMasterID] === 'Heinous');
    // Fully DETERMINISTIC risk score — derived only from real data (repeat
    // history + offence gravity + crime-type severity), no randomness, so the
    // same accused always scores identically across every page and reload.
    const riskScore = Math.max(0, Math.min(100,
      20 + (repeatCount - 1) * 15 + (isHeinous ? 15 : 0) + crimeSeverity(fir.crime_type)
    ));
    return {
      accused_id:         `ACC-${a.AccusedMasterID}`,
      name:               a.AccusedName,
      age:                a.AgeYear,
      gender:             a.GenderID === 'M' ? 'Male' : a.GenderID === 'F' ? 'Female' : 'Other',
      district:           fir.district || 'Unknown',
      primary_crime:      fir.crime_type || 'Unknown',
      case_id:            a.CaseMasterID,
      fir_number:         fir.fir_number,
      status:             fir.status,
      risk_score:         riskScore,
      is_repeat_offender: repeatCount > 1 ? 1 : 0,
      repeat_case_count:  repeatCount,
    };
  });
}

// Shared loader for MO/anomaly/forecast/briefing analysis: joins CaseMaster +
// Inv_OccuranceTime once and returns denormalized cases enriched with the MO
// narrative, incident hour/day-of-week, coordinates, and gravity — the common
// input every intel.js function (groupMOPatterns, detectAnomalies, etc.) expects.
async function loadIntelCases(app, q, lookups) {
  const [caseRows, occRows] = await Promise.all([
    qAll(app, q, 'SELECT CaseMasterID, CrimeNo, CaseNo, PoliceStationID, CrimeMajorHeadID, CrimeMinorHeadID, CaseStatusID, CrimeRegisteredDate, GravityOffenceID FROM CaseMaster'),
    qAll(app, q, 'SELECT CaseMasterID, IncidentFromDate, latitude, longitude, BriefFacts FROM Inv_OccuranceTime'),
  ]);
  const occByCase = {};
  flatAll(occRows, 'Inv_OccuranceTime').forEach(o => { occByCase[o.CaseMasterID] = o; });
  return flatAll(caseRows, 'CaseMaster').map(c => {
    const occ = occByCase[c.CaseMasterID] || {};
    const incident = occ.IncidentFromDate ? new Date(occ.IncidentFromDate) : null;
    return denormalizeCase(c, lookups, {
      mo: extractMO(occ.BriefFacts),
      narrative: occ.BriefFacts || '',
      hour: incident && !Number.isNaN(incident.getTime()) ? incident.getHours() : null,
      dow: incident && !Number.isNaN(incident.getTime()) ? incident.getDay() : null,
      lat: Number(occ.latitude) || null,
      lng: Number(occ.longitude) || null,
      gravity: lookups.gravityMap[c.GravityOffenceID],
    });
  });
}

function ageBand(age) {
  const a = Number(age);
  if (a >= 18 && a <= 25) return '18–25';
  if (a >= 26 && a <= 35) return '26–35';
  if (a >= 36 && a <= 45) return '36–45';
  if (a > 45) return '46+';
  return 'Unknown';
}

module.exports = { flat, flatAll, loadLookups, qAll, denormalizeCase, computeAccusedProfiles, ageBand, loadIntelCases };
