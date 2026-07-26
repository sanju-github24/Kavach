/**
 * KSP CRIMINT — Seed Data Generator (v2, official ERD schema)
 * Run: node generate.js
 * Outputs: numbered SQL files matching backend/schema.sql, in FK-safe order.
 */

const fs = require('fs');
const path = require('path');
const OUT = __dirname;

// ─────────────────────────────────────────────
// REFERENCE DATA (Karnataka-realistic)
// ─────────────────────────────────────────────

const DISTRICTS = [
  { name: 'Bengaluru Urban',  stations: ['Koramangala','HSR Layout','Whitefield','Indiranagar','Rajajinagar'] },
  { name: 'Mysuru',           stations: ['Mysuru City','Nazarbad','Jayalakshmipuram'] },
  { name: 'Tumakuru',         stations: ['Tumakuru City','Tiptur'] },
  { name: 'Belagavi',         stations: ['Belagavi City','Gokak'] },
  { name: 'Kalaburagi',       stations: ['Kalaburagi City','Aland'] },
  { name: 'Dakshina Kannada', stations: ['Mangaluru City','Ullal'] },
  { name: 'Dharwad',          stations: ['Hubballi City','Dharwad Rural'] },
  { name: 'Ballari',          stations: ['Ballari City','Sandur'] },
  { name: 'Shivamogga',       stations: ['Shivamogga City','Sagar'] },
  { name: 'Hassan',           stations: ['Hassan City','Belur'] },
];

const BOXES = {
  'Bengaluru Urban':  { lat:[12.85,13.10], lng:[77.45,77.75] },
  'Mysuru':           { lat:[12.20,12.45], lng:[76.50,76.80] },
  'Tumakuru':         { lat:[13.25,13.50], lng:[77.00,77.30] },
  'Belagavi':         { lat:[15.75,16.00], lng:[74.35,74.65] },
  'Kalaburagi':       { lat:[17.20,17.50], lng:[76.70,77.00] },
  'Dakshina Kannada': { lat:[12.75,13.00], lng:[74.75,75.05] },
  'Dharwad':          { lat:[15.30,15.55], lng:[75.00,75.30] },
  'Ballari':          { lat:[15.10,15.35], lng:[76.75,77.05] },
  'Shivamogga':       { lat:[13.85,14.10], lng:[75.40,75.70] },
  'Hassan':           { lat:[12.95,13.20], lng:[76.00,76.30] },
};

// { subhead name, crimeHead, ipc: [{act, section}] }
const CRIME_TYPES = [
  { type:'Theft',             head:'Property',   acts:[['IPC','379'],['IPC','380']] },
  { type:'Burglary',          head:'Property',   acts:[['IPC','457'],['IPC','380']] },
  { type:'Robbery',           head:'Property',   acts:[['IPC','392'],['IPC','393']] },
  { type:'Vehicle Theft',     head:'Property',   acts:[['IPC','379'],['IPC','411']] },
  { type:'Chain Snatching',   head:'Property',   acts:[['IPC','379'],['IPC','356']] },
  { type:'Assault',           head:'Body',       acts:[['IPC','323'],['IPC','324']] },
  { type:'Murder',            head:'Body',       acts:[['IPC','302'],['IPC','307']] },
  { type:'Kidnapping',        head:'Body',       acts:[['IPC','363'],['IPC','364']] },
  { type:'Domestic Violence', head:'Women',      acts:[['IPC','498A'],['DVACT','1']] },
  { type:'POCSO',             head:'Women',      acts:[['POCSO','4'],['POCSO','6']] },
  { type:'Fraud',             head:'Economic',   acts:[['IPC','420'],['IPC','406']] },
  { type:'Financial Fraud',   head:'Economic',   acts:[['IPC','420'],['IPC','467']] },
  { type:'Smuggling',         head:'Economic',   acts:[['CUSTOMS','135'],['IPC','120B']] },
  { type:'NDPS',              head:'Narcotics',  acts:[['NDPS','20'],['NDPS','21']] },
  { type:'Cyber Crime',       head:'Cyber',      acts:[['ITACT','66C'],['ITACT','66D']] },
];

const HEADS = ['Body','Property','Women','Economic','Narcotics','Cyber'];
const HEAD_LABEL = { Body:'Crimes Against Body', Property:'Crimes Against Property', Women:'Crimes Against Women', Economic:'Economic Offences', Narcotics:'Narcotics Offences', Cyber:'Cyber Crime' };

const ACTS = {
  IPC:      'Indian Penal Code',
  NDPS:     'Narcotic Drugs and Psychotropic Substances Act',
  ITACT:    'Information Technology Act',
  POCSO:    'Protection of Children from Sexual Offences Act',
  CUSTOMS:  'Customs Act',
  DVACT:    'Protection of Women from Domestic Violence Act',
};

const MO_LIST = [
  'Night-time entry through rear window','Distraction theft in crowded market',
  'ATM corner ambush, motorbike getaway','SIM swap + OTP intercept',
  'Hawala transfer through shell accounts','Posing as government official',
  'Online investment scam via WhatsApp','Vehicle theft from parking lots at night',
  'Chain snatching near signal stops','Residential burglary, targets electronics',
  'Highway robbery targeting truck drivers','Impersonation fraud at banks',
  'Pickpocketing in BMTC buses','Drug supply through courier networks',
];

const FIRST_M = ['Rajesh','Mohan','Suresh','Ravi','Arjun','Vijay','Ganesh','Prakash','Santhosh','Kiran','Arun','Mahesh','Nagaraj','Venkatesh','Manjunath','Lokesh','Farhan','Imran','Syed','Basavaraj'];
const FIRST_F = ['Deepa','Suma','Kavitha','Anitha','Pushpa','Lakshmi','Savitha','Meena','Rashmi','Priya','Nandini','Usha','Rekha','Chandana','Sunitha'];
const LAST    = ['Gowda','Naik','Reddy','Rao','Shetty','Hegde','Patil','Kumar','Singh','Khan','Sharma','Nair','Kumar','Nayak'];
const OCCUPATIONS = ['Daily Wage Labourer','Auto Driver','Construction Worker','Street Vendor','Unemployed','Petty Shopkeeper','Driver','Mechanic','Farmer','Domestic Worker','Small Trader','Government Employee','Private Employee','Student'];
const RELIGIONS   = ['Hindu','Muslim','Christian','Sikh','Jain','Other'];
const CASTES      = ['General','OBC','SC','ST','Other'];

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
let _seq = {};
const nextId = (key) => { _seq[key] = (_seq[key]||0) + 1; return _seq[key]; };
const pick   = (arr) => arr[Math.floor(Math.random()*arr.length)];
const rand   = (a,b) => Math.floor(Math.random()*(b-a+1))+a;
const esc    = (s) => String(s??'').replace(/'/g,"''");

// Columns that are Boolean type in Catalyst Data Store — ZCQL requires the
// literal true/false, not 1/0 (confirmed via direct insert test: "Invalid
// input value for Active" when given 1).
const BOOLEAN_COLUMNS = new Set([
  'Active','is_active','flagged','IsAccused','IsComplainantAccused','PhysicallyChallenged',
]);

function sqlVal(v, col) {
  if (v === null || v === undefined) return 'NULL';
  if (col && BOOLEAN_COLUMNS.has(col)) return (v === 1 || v === true || v === '1') ? 'true' : 'false';
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return `'${esc(v)}'`;
}

function randomDate(startYear, endYear) {
  const start = new Date(startYear,0,1).getTime();
  const end   = new Date(endYear,11,31).getTime();
  return new Date(start + Math.random()*(end-start));
}
const toDateStr = (d) => d.toISOString().slice(0,10);
const toDateTimeStr = (d) => d.toISOString().slice(0,19).replace('T',' ');

function randomCoord(dist) {
  const box = BOXES[dist] || BOXES['Bengaluru Urban'];
  return {
    lat: +(box.lat[0] + Math.random()*(box.lat[1]-box.lat[0])).toFixed(6),
    lng: +(box.lng[0] + Math.random()*(box.lng[1]-box.lng[0])).toFixed(6),
  };
}

// One INSERT statement per row (not batched multi-row VALUES) — ZCQL's
// runtime executor (app.zcql().executeZCQLQuery()) only reliably accepts a
// single simple statement per call, unlike the console's SQL Query tool.
function insertSQL(table, rows, cols) {
  if (!rows.length) return `-- No rows for ${table}\n`;
  return rows.map(r =>
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(c => sqlVal(r[c], c)).join(', ')});`
  ).join('\n') + '\n';
}

function write(filename, sql) {
  fs.writeFileSync(path.join(OUT, filename), sql);
  console.log('Wrote', filename);
}

const CSV_DIR = path.join(OUT, 'csv');
if (!fs.existsSync(CSV_DIR)) fs.mkdirSync(CSV_DIR);

function csvVal(v, col) {
  if (v === null || v === undefined) return '';
  if (BOOLEAN_COLUMNS.has(col)) return (v === 1 || v === true || v === '1') ? 'true' : 'false';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}

// One CSV per table, for `catalyst ds:import --table <Name> csv/<Name>.csv`
function writeCSV(table, rows, cols) {
  if (!rows.length) { console.log('Skip CSV (no rows):', table); return; }
  const lines = [cols.join(',')].concat(rows.map(r => cols.map(c => csvVal(r[c], c)).join(',')));
  fs.writeFileSync(path.join(CSV_DIR, `${table}.csv`), lines.join('\n') + '\n');
  console.log('Wrote csv/%s.csv (%d rows)', table, rows.length);
}

// ─────────────────────────────────────────────
// 1. STATE, DISTRICT
// ─────────────────────────────────────────────
const states = [{ StateID:1, StateName:'Karnataka', NationalityID:1, Active:1 }];

const districts = DISTRICTS.map((d,i) => ({ DistrictID:i+1, DistrictName:d.name, StateID:1, Active:1 }));
const districtIdByName = Object.fromEntries(districts.map(d => [d.DistrictName, d.DistrictID]));

// ─────────────────────────────────────────────
// 2. UNITTYPE, UNIT
// ─────────────────────────────────────────────
const unitTypes = [
  { UnitTypeID:1, UnitTypeName:'Police Station', CityDistState:'City', Hierarchy:3, Active:1 },
  { UnitTypeID:2, UnitTypeName:'District HQ',     CityDistState:'District', Hierarchy:2, Active:1 },
];

const units = [];
const stationsByDistrict = {}; // districtId -> [unitId,...]
DISTRICTS.forEach((d) => {
  const distId = districtIdByName[d.name];
  const hqId = nextId('unit');
  units.push({ UnitID:hqId, UnitName:`${d.name} District HQ`, TypeID:2, ParentUnit:null, NationalityID:1, StateID:1, DistrictID:distId, Active:1 });
  stationsByDistrict[distId] = [];
  d.stations.forEach(st => {
    const uid = nextId('unit');
    units.push({ UnitID:uid, UnitName:`${st} PS`, TypeID:1, ParentUnit:hqId, NationalityID:1, StateID:1, DistrictID:distId, Active:1 });
    stationsByDistrict[distId].push(uid);
  });
});

// ─────────────────────────────────────────────
// 3. RANK, DESIGNATION, EMPLOYEE
// ─────────────────────────────────────────────
const ranks = ['Constable','Head Constable','ASI','SI','PSI','Inspector','DSP','SP'].map((n,i) => ({ RankID:i+1, RankName:n, Hierarchy:8-i, Active:1 }));
const designations = ['Investigating Officer','SHO','Beat Officer','Admin Officer'].map((n,i) => ({ DesignationID:i+1, DesignationName:n, Active:1, SortOrder:i+1 }));

const employees = [];
const employeesByUnit = {};
Object.entries(stationsByDistrict).forEach(([distId, unitIds]) => {
  unitIds.forEach(unitId => {
    const count = rand(2,4);
    employeesByUnit[unitId] = [];
    for (let i=0;i<count;i++) {
      const empId = nextId('employee');
      const male = Math.random() > 0.15;
      employees.push({
        EmployeeID: empId, DistrictID: Number(distId), UnitID: unitId,
        RankID: pick([1,2,3,4,5,6]), DesignationID: i===0 ? 2 : 1,
        KGID: `KGID${String(empId).padStart(6,'0')}`,
        FirstName: `${pick(male?FIRST_M:FIRST_F)} ${pick(LAST)}`,
        EmployeeDOB: toDateStr(randomDate(1968,1995)),
        GenderID: male ? 1 : 2,
        BloodGroupID: rand(1,8),
        PhysicallyChallenged: 0,
        AppointmentDate: toDateStr(randomDate(1996,2020)),
      });
      employeesByUnit[unitId].push(empId);
    }
  });
});

// ─────────────────────────────────────────────
// 4. COURT
// ─────────────────────────────────────────────
const courts = [];
const courtsByDistrict = {};
districts.forEach(d => {
  const c1 = nextId('court'), c2 = nextId('court');
  courts.push({ CourtID:c1, CourtName:`${d.DistrictName} District & Sessions Court`, DistrictID:d.DistrictID, StateID:1, Active:1 });
  courts.push({ CourtID:c2, CourtName:`${d.DistrictName} JMFC Court`, DistrictID:d.DistrictID, StateID:1, Active:1 });
  courtsByDistrict[d.DistrictID] = [c1,c2];
});

// ─────────────────────────────────────────────
// 5. CASE CLASSIFICATION LOOKUPS
// ─────────────────────────────────────────────
const caseCategories = [
  { CaseCategoryID:1, LookupValue:'FIR' }, { CaseCategoryID:2, LookupValue:'UDR' },
  { CaseCategoryID:3, LookupValue:'Zero FIR' }, { CaseCategoryID:4, LookupValue:'PAR' },
];
const gravityOffences = [
  { GravityOffenceID:1, LookupValue:'Heinous' }, { GravityOffenceID:2, LookupValue:'Non-Heinous' },
];
const HEINOUS = new Set(['Murder','Kidnapping','Robbery','POCSO','NDPS']);

const caseStatuses = ['Under Investigation','Charge Sheeted','Convicted','Acquitted','Closed - FR','Pending Trial']
  .map((n,i) => ({ CaseStatusID:i+1, CaseStatusName:n }));
const statusIdByName = Object.fromEntries(caseStatuses.map(s => [s.CaseStatusName, s.CaseStatusID]));

const crimeHeads = HEADS.map((h,i) => ({ CrimeHeadID:i+1, CrimeGroupName:HEAD_LABEL[h], Active:1 }));
const crimeHeadIdByKey = Object.fromEntries(crimeHeads.map((h,i) => [HEADS[i], h.CrimeHeadID]));

const crimeSubHeads = CRIME_TYPES.map((c,i) => ({
  CrimeSubHeadID:i+1, CrimeHeadID:crimeHeadIdByKey[c.head], CrimeHeadName:c.type, SeqID:i+1,
}));
const subHeadIdByType = Object.fromEntries(crimeSubHeads.map(s => [s.CrimeHeadName, s.CrimeSubHeadID]));

// ─────────────────────────────────────────────
// 6. ACT, SECTION, CRIMEHEADACTSECTION
// ─────────────────────────────────────────────
const acts = Object.entries(ACTS).map(([code,desc]) => ({ ActCode:code, ActDescription:desc, ShortName:code, Active:1 }));

const sectionSet = new Map(); // "ACT|SECTION" -> {ActCode, SectionCode}
CRIME_TYPES.forEach(c => c.acts.forEach(([act,sec]) => sectionSet.set(`${act}|${sec}`, { ActCode:act, SectionCode:sec })));
const sections = [...sectionSet.values()].map(s => ({ ...s, SectionDescription:`${s.ActCode} Section ${s.SectionCode}`, Active:1 }));

const chasSet = new Map(); // "head|act" -> row
CRIME_TYPES.forEach(c => {
  const headId = crimeHeadIdByKey[c.head];
  c.acts.forEach(([act,sec]) => chasSet.set(`${headId}|${act}`, { CrimeHeadID:headId, ActCode:act, SectionCode:sec }));
});
const crimeHeadActSections = [...chasSet.values()];

// ─────────────────────────────────────────────
// 7. DEMOGRAPHIC LOOKUPS
// ─────────────────────────────────────────────
const castes    = CASTES.map((n,i) => ({ caste_master_id:i+1, caste_master_name:n }));
const religions = RELIGIONS.map((n,i) => ({ ReligionID:i+1, ReligionName:n }));
const occupations = OCCUPATIONS.map((n,i) => ({ OccupationID:i+1, OccupationName:n }));

// ─────────────────────────────────────────────
// 8. CASEMASTER + dependents
// ─────────────────────────────────────────────
// Deliberate repeat-offender modelling: most accused get a name never used
// before (checked against a running list); ~15% of the time we instead reuse
// an existing name on purpose, so "repeat offender" (same AccusedName across
// cases) reflects an intentional ~15% rate rather than incidental collisions
// from a small first/last-name pool colliding by chance.
const MIDDLE_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const usedNames = [];
function freshAccusedName(male) {
  // First+last alone only give ~35*14=490 combinations — far fewer than the
  // ~1000+ accused generated, so a middle initial multiplies the name space
  // ~26x to keep collisions rare (this is what "fresh" actually means below).
  let name;
  for (let tries = 0; tries < 25; tries++) {
    name = `${pick(male ? FIRST_M : FIRST_F)} ${pick(MIDDLE_INITIALS)}. ${pick(LAST)}`;
    if (!usedNames.includes(name)) break;
  }
  usedNames.push(name);
  return name;
}
function nameForAccused(male) {
  if (usedNames.length > 30 && Math.random() < 0.15) return pick(usedNames);
  return freshAccusedName(male);
}

const NUM_CASES = 500;
const caseMasters = [];
const occuranceTimes = [];
const complainants = [];
const actSections = [];
const victims = [];
const accusedList = [];
const arrestSurrenders = [];
const arrestAccusedJunction = [];
const chargesheets = [];

// Track per-district per-category per-year running serials
const serialTracker = {};

districts.forEach(d => {});

for (let i=0;i<NUM_CASES;i++) {
  const caseId = nextId('case');
  const dist = pick(districts);
  const stationId = pick(stationsByDistrict[dist.DistrictID]);
  const officerId = pick(employeesByUnit[stationId]);
  const crime = pick(CRIME_TYPES);
  const catId = Math.random() < 0.85 ? 1 : pick([2,3,4]); // mostly FIR
  const gravityId = HEINOUS.has(crime.type) ? 1 : 2;
  const headId = crimeHeadIdByKey[crime.head];
  const subHeadId = subHeadIdByType[crime.type];
  const regDate = randomDate(2018, 2026);
  const year = regDate.getFullYear();

  const trackKey = `${catId}|${dist.DistrictID}|${stationId}|${year}`;
  serialTracker[trackKey] = (serialTracker[trackKey]||0) + 1;
  const serial = String(serialTracker[trackKey]).padStart(5,'0');
  const crimeNo = `${catId}${String(dist.DistrictID).padStart(4,'0')}${String(stationId).padStart(4,'0')}${year}${serial}`;
  const caseNo  = `${year}${serial}`;

  const statusName = year < 2024 ? pick(['Convicted','Acquitted','Closed - FR','Charge Sheeted']) : pick(['Under Investigation','Pending Trial','Charge Sheeted']);
  const statusId = statusIdByName[statusName];
  const courtId = Math.random() < 0.6 ? pick(courtsByDistrict[dist.DistrictID]) : null;

  caseMasters.push({
    CaseMasterID:caseId, CrimeNo:crimeNo, CaseNo:caseNo, CrimeRegisteredDate:toDateStr(regDate),
    PolicePersonID:officerId, PoliceStationID:stationId, CaseCategoryID:catId,
    GravityOffenceID:gravityId, CrimeMajorHeadID:headId, CrimeMinorHeadID:subHeadId,
    CaseStatusID:statusId, CourtID:courtId,
  });

  const coord = randomCoord(dist.DistrictName);
  const fromDt = new Date(regDate.getTime() - rand(0,12)*3600*1000);
  occuranceTimes.push({
    CaseMasterID:caseId, IncidentFromDate:toDateTimeStr(fromDt), IncidentToDate:toDateTimeStr(regDate),
    InfoReceivedPSDate:toDateTimeStr(regDate), latitude:coord.lat, longitude:coord.lng,
    BriefFacts:`${crime.type} reported in ${dist.DistrictName}. MO: ${pick(MO_LIST)}.`,
  });

  const numComplainants = Math.random() < 0.85 ? 1 : 2;
  for (let c=0;c<numComplainants;c++) {
    const male = Math.random() > 0.4;
    complainants.push({
      ComplainantID: nextId('complainant'), CaseMasterID:caseId,
      ComplainantName:`${pick(male?FIRST_M:FIRST_F)} ${pick(LAST)}`,
      AgeYear: rand(19,65), OccupationID: pick(occupations).OccupationID,
      ReligionID: pick(religions).ReligionID, CasteID: pick(castes).caste_master_id,
      GenderID: male ? 1 : 2,
    });
  }

  crime.acts.forEach(([act,sec],idx) => {
    actSections.push({ CaseMasterID:caseId, ActID:act, SectionID:sec, ActOrderID:idx+1, SectionOrderID:idx+1 });
  });

  const numVictims = rand(1,3);
  for (let v=0;v<numVictims;v++) {
    const male = Math.random() > 0.45;
    victims.push({
      VictimMasterID: nextId('victim'), CaseMasterID:caseId,
      VictimName:`${pick(male?FIRST_M:FIRST_F)} ${pick(LAST)}`,
      AgeYear: rand(5,75), GenderID: male?'m':'f', VictimPolice: Math.random()<0.03 ? '1':'0',
    });
  }

  const numAccused = rand(1,3);
  const caseAccusedIds = [];
  for (let a=0;a<numAccused;a++) {
    const male = Math.random() > 0.1;
    const accId = nextId('accused');
    accusedList.push({
      AccusedMasterID:accId, CaseMasterID:caseId,
      AccusedName: nameForAccused(male),
      AgeYear: rand(18,55), GenderID: male?'M':'F', PersonID:`A${a+1}`,
    });
    caseAccusedIds.push(accId);
  }

  if (Math.random() < 0.65 && caseAccusedIds.length) {
    const asId = nextId('arrestsurrender');
    const primaryAccused = caseAccusedIds[0];
    arrestSurrenders.push({
      ArrestSurrenderID:asId, CaseMasterID:caseId,
      ArrestSurrenderTypeID: Math.random()<0.85?1:2,
      ArrestSurrenderDate: toDateStr(new Date(regDate.getTime()+rand(0,30)*86400000)),
      ArrestSurrenderStateId:1, ArrestSurrenderDistrictId:dist.DistrictID,
      PoliceStationID:stationId, IOID:officerId, CourtID:courtId, AccusedMasterID:primaryAccused,
      IsAccused:1, IsComplainantAccused: Math.random()<0.02 ? 1:0,
    });
    caseAccusedIds.forEach(accId => arrestAccusedJunction.push({ ArrestSurrenderID:asId, AccusedMasterID:accId }));
  }

  if (['Charge Sheeted','Convicted','Acquitted','Closed - FR'].includes(statusName)) {
    chargesheets.push({
      CSID: nextId('cs'), CaseMasterID:caseId,
      csdate: toDateTimeStr(new Date(regDate.getTime()+rand(30,180)*86400000)),
      cstype: statusName==='Closed - FR' ? 'C' : (statusName==='Acquitted' ? 'A' : 'A'),
      PolicePersonID: officerId,
    });
  }
}

// ─────────────────────────────────────────────
// 9. EXTENSIONS — UserProfiles, AuditLogs, Relationships, FinancialAccounts
// ─────────────────────────────────────────────
const userProfiles = [
  { user_id:'USR001', email:'admin@ksp.gov.in',        first_name:'Arjun',  last_name:'Nair',   role:'admin',        EmployeeID:null, is_active:1 },
  { user_id:'USR002', email:'supervisor@ksp.gov.in',   first_name:'Priya',  last_name:'Sharma', role:'supervisor',   EmployeeID:null, is_active:1 },
  { user_id:'USR003', email:'investigator@ksp.gov.in', first_name:'Kiran',  last_name:'Gowda',  role:'investigator', EmployeeID: employees[0]?.EmployeeID ?? null, is_active:1 },
  { user_id:'USR004', email:'analyst@ksp.gov.in',      first_name:'Divya',  last_name:'Rao',    role:'analyst',      EmployeeID:null, is_active:1 },
  { user_id:'USR005', email:'policymaker@ksp.gov.in',  first_name:'Suresh', last_name:'Patil',  role:'policymaker',  EmployeeID:null, is_active:1 },
];

// Repeat-offender approximation: group Accused by exact AccusedName, link
// same-named accused across different cases as ASSOCIATE/REPEAT-OFFENDER.
const relationships = [];
const byCase = {};
accusedList.forEach(a => { (byCase[a.CaseMasterID] ??= []).push(a); });
Object.values(byCase).forEach(list => {
  for (let i=0;i<list.length;i++) for (let j=i+1;j<list.length;j++) {
    relationships.push({
      rel_id:`R${nextId('rel')}`, from_id:list[i].AccusedMasterID, from_type:'Accused',
      to_id:list[j].AccusedMasterID, to_type:'Accused', rel_type:'CO-ACCUSED',
      strength:+(0.6+Math.random()*0.4).toFixed(2), CaseMasterID:list[i].CaseMasterID,
    });
  }
});
const byName = {};
accusedList.forEach(a => { (byName[a.AccusedName] ??= []).push(a); });
Object.values(byName).filter(l => l.length > 1).forEach(list => {
  for (let i=0;i<list.length-1;i++) {
    relationships.push({
      rel_id:`R${nextId('rel')}`, from_id:list[i].AccusedMasterID, from_type:'Accused',
      to_id:list[i+1].AccusedMasterID, to_type:'Accused', rel_type:'REPEAT-OFFENDER-LINK',
      strength:0.5, CaseMasterID:list[i].CaseMasterID,
    });
  }
});

const banks = ['SBI','HDFC','ICICI','Canara Bank','Axis Bank'];
const financialAccounts = [];
const highActivityAccused = accusedList.filter(() => Math.random() < 0.1).slice(0,50);
highActivityAccused.forEach(a => {
  const flagged = Math.random() < 0.45 ? 1 : 0;
  financialAccounts.push({
    account_id:`FA${nextId('finacc')}`, account_number:`${pick(banks).slice(0,3).toUpperCase()}-${rand(1000,9999)}`,
    bank: pick(banks), linked_accused_id:a.AccusedMasterID, flagged,
    suspicious_txn_count: flagged ? rand(3,20) : rand(0,2),
    total_suspicious_amount: flagged ? rand(50000,2500000) : 0,
    notes: flagged ? 'Multiple high-value transfers inconsistent with declared income' : null,
  });
});

// ─────────────────────────────────────────────
// WRITE FILES (FK-safe order)
// ─────────────────────────────────────────────
write('01_geography.sql',
  insertSQL('State', states, ['StateID','StateName','NationalityID','Active']) + '\n' +
  insertSQL('District', districts, ['DistrictID','DistrictName','StateID','Active']));

write('02_units.sql',
  insertSQL('UnitType', unitTypes, ['UnitTypeID','UnitTypeName','CityDistState','Hierarchy','Active']) + '\n' +
  insertSQL('Unit', units, ['UnitID','UnitName','TypeID','ParentUnit','NationalityID','StateID','DistrictID','Active']));

write('03_personnel.sql',
  insertSQL('Rank', ranks, ['RankID','RankName','Hierarchy','Active']) + '\n' +
  insertSQL('Designation', designations, ['DesignationID','DesignationName','Active','SortOrder']) + '\n' +
  insertSQL('Employee', employees, ['EmployeeID','DistrictID','UnitID','RankID','DesignationID','KGID','FirstName','EmployeeDOB','GenderID','BloodGroupID','PhysicallyChallenged','AppointmentDate']) + '\n' +
  insertSQL('Court', courts, ['CourtID','CourtName','DistrictID','StateID','Active']));

write('04_case_lookups.sql',
  insertSQL('CaseCategory', caseCategories, ['CaseCategoryID','LookupValue']) + '\n' +
  insertSQL('GravityOffence', gravityOffences, ['GravityOffenceID','LookupValue']) + '\n' +
  insertSQL('CaseStatusMaster', caseStatuses, ['CaseStatusID','CaseStatusName']) + '\n' +
  insertSQL('CrimeHead', crimeHeads, ['CrimeHeadID','CrimeGroupName','Active']) + '\n' +
  insertSQL('CrimeSubHead', crimeSubHeads, ['CrimeSubHeadID','CrimeHeadID','CrimeHeadName','SeqID']));

write('05_acts_sections.sql',
  insertSQL('Act', acts, ['ActCode','ActDescription','ShortName','Active']) + '\n' +
  insertSQL('Section', sections, ['ActCode','SectionCode','SectionDescription','Active']) + '\n' +
  insertSQL('CrimeHeadActSection', crimeHeadActSections, ['CrimeHeadID','ActCode','SectionCode']));

write('06_demographic_lookups.sql',
  insertSQL('CasteMaster', castes, ['caste_master_id','caste_master_name']) + '\n' +
  insertSQL('ReligionMaster', religions, ['ReligionID','ReligionName']) + '\n' +
  insertSQL('OccupationMaster', occupations, ['OccupationID','OccupationName']));

write('07_casemaster.sql', insertSQL('CaseMaster', caseMasters,
  ['CaseMasterID','CrimeNo','CaseNo','CrimeRegisteredDate','PolicePersonID','PoliceStationID','CaseCategoryID','GravityOffenceID','CrimeMajorHeadID','CrimeMinorHeadID','CaseStatusID','CourtID']));

write('08_occurance_time.sql', insertSQL('Inv_OccuranceTime', occuranceTimes,
  ['CaseMasterID','IncidentFromDate','IncidentToDate','InfoReceivedPSDate','latitude','longitude','BriefFacts']));

write('09_complainants.sql', insertSQL('ComplainantDetails', complainants,
  ['ComplainantID','CaseMasterID','ComplainantName','AgeYear','OccupationID','ReligionID','CasteID','GenderID']));

write('10_act_section_association.sql', insertSQL('ActSectionAssociation', actSections,
  ['CaseMasterID','ActID','SectionID','ActOrderID','SectionOrderID']));

write('11_victims.sql', insertSQL('Victim', victims,
  ['VictimMasterID','CaseMasterID','VictimName','AgeYear','GenderID','VictimPolice']));

write('12_accused.sql', insertSQL('Accused', accusedList,
  ['AccusedMasterID','CaseMasterID','AccusedName','AgeYear','GenderID','PersonID']));

write('13_arrest_surrender.sql',
  insertSQL('ArrestSurrender', arrestSurrenders, ['ArrestSurrenderID','CaseMasterID','ArrestSurrenderTypeID','ArrestSurrenderDate','ArrestSurrenderStateId','ArrestSurrenderDistrictId','PoliceStationID','IOID','CourtID','AccusedMasterID','IsAccused','IsComplainantAccused']) + '\n' +
  insertSQL('inv_arrestsurrenderaccused', arrestAccusedJunction, ['ArrestSurrenderID','AccusedMasterID']));

write('14_chargesheets.sql', insertSQL('ChargesheetDetails', chargesheets,
  ['CSID','CaseMasterID','csdate','cstype','PolicePersonID']));

write('15_users.sql', insertSQL('UserProfiles', userProfiles,
  ['user_id','email','first_name','last_name','role','EmployeeID','is_active']));

write('16_relationships.sql', insertSQL('Relationships', relationships,
  ['rel_id','from_id','from_type','to_id','to_type','rel_type','strength','CaseMasterID']));

write('17_financial_accounts.sql', insertSQL('FinancialAccounts', financialAccounts,
  ['account_id','account_number','bank','linked_accused_id','flagged','suspicious_txn_count','total_suspicious_amount','notes']));

// ─────────────────────────────────────────────
// CSV EXPORT — one file per table, for `catalyst ds:import --table <Name>`
// (import order must respect the same FK dependency order as the .sql files)
// ─────────────────────────────────────────────
writeCSV('State', states, ['StateID','StateName','NationalityID','Active']);
writeCSV('District', districts, ['DistrictID','DistrictName','StateID','Active']);
writeCSV('UnitType', unitTypes, ['UnitTypeID','UnitTypeName','CityDistState','Hierarchy','Active']);
writeCSV('Unit', units, ['UnitID','UnitName','TypeID','ParentUnit','NationalityID','StateID','DistrictID','Active']);
writeCSV('Rank', ranks, ['RankID','RankName','Hierarchy','Active']);
writeCSV('Designation', designations, ['DesignationID','DesignationName','Active','SortOrder']);
writeCSV('Employee', employees, ['EmployeeID','DistrictID','UnitID','RankID','DesignationID','KGID','FirstName','EmployeeDOB','GenderID','BloodGroupID','PhysicallyChallenged','AppointmentDate']);
writeCSV('Court', courts, ['CourtID','CourtName','DistrictID','StateID','Active']);
writeCSV('CaseCategory', caseCategories, ['CaseCategoryID','LookupValue']);
writeCSV('GravityOffence', gravityOffences, ['GravityOffenceID','LookupValue']);
writeCSV('CaseStatusMaster', caseStatuses, ['CaseStatusID','CaseStatusName']);
writeCSV('CrimeHead', crimeHeads, ['CrimeHeadID','CrimeGroupName','Active']);
writeCSV('CrimeSubHead', crimeSubHeads, ['CrimeSubHeadID','CrimeHeadID','CrimeHeadName','SeqID']);
writeCSV('Act', acts, ['ActCode','ActDescription','ShortName','Active']);
writeCSV('Section', sections, ['ActCode','SectionCode','SectionDescription','Active']);
writeCSV('CrimeHeadActSection', crimeHeadActSections, ['CrimeHeadID','ActCode','SectionCode']);
writeCSV('CasteMaster', castes, ['caste_master_id','caste_master_name']);
writeCSV('ReligionMaster', religions, ['ReligionID','ReligionName']);
writeCSV('OccupationMaster', occupations, ['OccupationID','OccupationName']);
writeCSV('CaseMaster', caseMasters, ['CaseMasterID','CrimeNo','CaseNo','CrimeRegisteredDate','PolicePersonID','PoliceStationID','CaseCategoryID','GravityOffenceID','CrimeMajorHeadID','CrimeMinorHeadID','CaseStatusID','CourtID']);
writeCSV('Inv_OccuranceTime', occuranceTimes, ['CaseMasterID','IncidentFromDate','IncidentToDate','InfoReceivedPSDate','latitude','longitude','BriefFacts']);
writeCSV('ComplainantDetails', complainants, ['ComplainantID','CaseMasterID','ComplainantName','AgeYear','OccupationID','ReligionID','CasteID','GenderID']);
writeCSV('ActSectionAssociation', actSections, ['CaseMasterID','ActID','SectionID','ActOrderID','SectionOrderID']);
writeCSV('Victim', victims, ['VictimMasterID','CaseMasterID','VictimName','AgeYear','GenderID','VictimPolice']);
writeCSV('Accused', accusedList, ['AccusedMasterID','CaseMasterID','AccusedName','AgeYear','GenderID','PersonID']);
writeCSV('ArrestSurrender', arrestSurrenders, ['ArrestSurrenderID','CaseMasterID','ArrestSurrenderTypeID','ArrestSurrenderDate','ArrestSurrenderStateId','ArrestSurrenderDistrictId','PoliceStationID','IOID','CourtID','AccusedMasterID','IsAccused','IsComplainantAccused']);
writeCSV('inv_arrestsurrenderaccused', arrestAccusedJunction, ['ArrestSurrenderID','AccusedMasterID']);
writeCSV('ChargesheetDetails', chargesheets, ['CSID','CaseMasterID','csdate','cstype','PolicePersonID']);
writeCSV('UserProfiles', userProfiles, ['user_id','email','first_name','last_name','role','EmployeeID','is_active']);
writeCSV('Relationships', relationships, ['rel_id','from_id','from_type','to_id','to_type','rel_type','strength','CaseMasterID']);
writeCSV('FinancialAccounts', financialAccounts, ['account_id','account_number','bank','linked_accused_id','flagged','suspicious_txn_count','total_suspicious_amount','notes']);

fs.writeFileSync(path.join(OUT,'summary.json'), JSON.stringify({
  counts: {
    states:states.length, districts:districts.length, units:units.length, employees:employees.length,
    courts:courts.length, cases:caseMasters.length, complainants:complainants.length,
    victims:victims.length, accused:accusedList.length, arrestSurrenders:arrestSurrenders.length,
    chargesheets:chargesheets.length, relationships:relationships.length, financialAccounts:financialAccounts.length,
  },
}, null, 2));

console.log('\nDone. Row counts:', JSON.parse(fs.readFileSync(path.join(OUT,'summary.json'))).counts);
