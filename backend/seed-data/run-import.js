/**
 * One-off migration runner — feeds every INSERT statement from the numbered
 * seed .sql files through data-query's temporary `debug_seed_insert` action
 * (running locally via `catalyst serve`, which proxies to the real cloud
 * Data Store). Used because the CLI's `ds:import` Stratus bucket-listing
 * path is broken in this environment.
 *
 * Usage: node run-import.js [fileGlob]
 *   node run-import.js                  → imports all 17 files in order
 *   node run-import.js 07_casemaster.sql → imports just one file
 */
const fs = require('fs');
const path = require('path');

const ENDPOINT = process.env.KAVACH_ENDPOINT || 'http://localhost:3000/server/ksp_crimint_function/data-query';
const DIR = __dirname;
const CONCURRENCY = 8;

const ALL_FILES = [
  '01_geography.sql','02_units.sql','03_personnel.sql','04_case_lookups.sql',
  '05_acts_sections.sql','06_demographic_lookups.sql','07_casemaster.sql',
  '08_occurance_time.sql','09_complainants.sql','10_act_section_association.sql',
  '11_victims.sql','12_accused.sql','13_arrest_surrender.sql','14_chargesheets.sql',
  '15_users.sql','16_relationships.sql','17_financial_accounts.sql',
];

async function postOne(sql) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'debug_seed_insert', sql }),
  });
  return res.json();
}

async function runPool(statements, concurrency) {
  let i = 0, ok = 0, fail = 0;
  const failures = [];
  async function worker() {
    while (i < statements.length) {
      const idx = i++;
      const sql = statements[idx];
      try {
        const result = await postOne(sql);
        if (result.ok) ok++;
        else { fail++; if (failures.length < 5) failures.push({ sql: sql.slice(0,120), error: result.error }); }
      } catch (e) {
        fail++; if (failures.length < 5) failures.push({ sql: sql.slice(0,120), error: e.message });
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { ok, fail, failures };
}

async function main() {
  const only = process.argv[2];
  const files = only ? [only] : ALL_FILES;

  for (const file of files) {
    const filePath = path.join(DIR, file);
    if (!fs.existsSync(filePath)) { console.log(`SKIP (missing): ${file}`); continue; }
    const content = fs.readFileSync(filePath, 'utf8');
    const statements = content.split('\n').map(l => l.trim()).filter(l => l.startsWith('INSERT INTO'));
    if (!statements.length) { console.log(`SKIP (no inserts): ${file}`); continue; }

    process.stdout.write(`${file}: ${statements.length} rows... `);
    const { ok, fail, failures } = await runPool(statements, CONCURRENCY);
    console.log(`ok=${ok} fail=${fail}`);
    if (failures.length) {
      console.log('  Sample failures:');
      failures.forEach(f => console.log(`   - ${f.error}  <<  ${f.sql}`));
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
