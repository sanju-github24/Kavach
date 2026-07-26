# KSP CRIMINT — Seed Data (v2, official ERD schema)

This replaces the earlier flat 8-table seed set. The schema now implements
the official Police FIR System ER Diagram (Karnataka Police Department)
exactly — see `backend/schema.sql` — plus a few flagged application
extension tables the ERD does not model (UserProfiles, AuditLogs,
Relationships, FinancialAccounts).

## What's in here

| File | Tables | Approx rows |
|------|--------|-------------|
| 01_geography.sql | State, District | 1, 10 |
| 02_units.sql | UnitType, Unit | 2, 34 |
| 03_personnel.sql | Rank, Designation, Employee, Court | 8, 4, ~67, 20 |
| 04_case_lookups.sql | CaseCategory, GravityOffence, CaseStatusMaster, CrimeHead, CrimeSubHead | small |
| 05_acts_sections.sql | Act, Section, CrimeHeadActSection | small |
| 06_demographic_lookups.sql | CasteMaster, ReligionMaster, OccupationMaster | small |
| 07_casemaster.sql | CaseMaster | 500 |
| 08_occurance_time.sql | Inv_OccuranceTime | 500 |
| 09_complainants.sql | ComplainantDetails | ~560 |
| 10_act_section_association.sql | ActSectionAssociation | ~1,000 |
| 11_victims.sql | Victim | ~1,020 |
| 12_accused.sql | Accused | ~960 |
| 13_arrest_surrender.sql | ArrestSurrender, inv_arrestsurrenderaccused | ~333, ~600 |
| 14_chargesheets.sql | ChargesheetDetails | ~373 |
| 15_users.sql | UserProfiles (extension) | 5 |
| 16_relationships.sql | Relationships (extension) | ~1,250 |
| 17_financial_accounts.sql | FinancialAccounts (extension) | 50 |

Regenerate at any time with `node generate.js` (deterministic structure,
random content — re-running produces a fresh dataset of the same shape).

## ⚠ This is a schema replacement, not an additive migration

Your Catalyst Data Store currently has the **old** 8-table schema
(`UserProfiles`, `Accused`, `Victims`, `FIRs`, `FIR_Accused`, `Relationships`,
`FinancialAccounts`, `AuditLogs`) with live seeded data in it. The new schema
uses different table names and column names throughout (e.g. `FIRs` →
`CaseMaster`, `Accused.risk_score` no longer exists as a stored column).
**Dropping the old tables will delete that data permanently.** Back up
first if you want to keep it (Data Store → Tables → export, or
`catalyst ds:export <table>`).

## How to import into Catalyst Data Store

### Step 1 — Drop old tables (if they exist)
In **Catalyst Console → Data Store → Tables → SQL Query**, drop the old
8 tables before creating the new ones (they share some names like
`Accused`, `Relationships`, `FinancialAccounts`, `UserProfiles`, `AuditLogs`
with different column sets, which will conflict otherwise):
```sql
DROP TABLE IF EXISTS FIR_Accused;
DROP TABLE IF EXISTS FIRs;
DROP TABLE IF EXISTS Victims;
DROP TABLE IF EXISTS Accused;
DROP TABLE IF EXISTS Relationships;
DROP TABLE IF EXISTS FinancialAccounts;
DROP TABLE IF EXISTS AuditLogs;
DROP TABLE IF EXISTS UserProfiles;
```

### Step 2 — Create the new schema
Paste and run `backend/schema.sql` in the same SQL Query tool — creates all
~28 tables (Section 1: ERD tables, Section 2: extension tables) in one go.

### Step 3 — Import seed data, in numeric order
Run `01_geography.sql` through `17_financial_accounts.sql` **in order** —
each file's foreign keys depend on tables created by earlier files.

### Step 4 — Recreate the 5 test login accounts
In **Catalyst Console → Authentication → Users**, create these 5 accounts
first (same as before), then confirm `15_users.sql`'s `user_id` values
(`USR001`-`USR005`) match the Catalyst Auth user IDs — update the SQL if
your project auto-assigns different IDs.

| Email | Role |
|-------|------|
| admin@ksp.gov.in | admin |
| supervisor@ksp.gov.in | supervisor |
| investigator@ksp.gov.in | investigator |
| analyst@ksp.gov.in | analyst |
| policymaker@ksp.gov.in | policymaker |

### Step 5 — Verify
```sql
SELECT 'CaseMaster' AS tbl, COUNT(*) AS cnt FROM CaseMaster
UNION ALL SELECT 'Accused', COUNT(*) FROM Accused
UNION ALL SELECT 'Victim', COUNT(*) FROM Victim
UNION ALL SELECT 'ComplainantDetails', COUNT(*) FROM ComplainantDetails
UNION ALL SELECT 'ArrestSurrender', COUNT(*) FROM ArrestSurrender
UNION ALL SELECT 'Relationships', COUNT(*) FROM Relationships
UNION ALL SELECT 'FinancialAccounts', COUNT(*) FROM FinancialAccounts;
```

## Known modelling limitation (inherited from the ERD)

`Accused` rows are scoped to a single `CaseMasterID` — there is no stable
person identity across cases in the ERD (`PersonID` is just a per-case label
like "A1"/"A2"). The app approximates "repeat offender" by matching
`AccusedName` exactly across cases (see `functions/ksp_crimint_function/_lib/dataAccess.js`).
This is a real limitation, not a bug — a production system would need a
proper person-matching/entity-resolution layer on top of this ERD.

## NoSQL Collections (create manually in Catalyst NoSQL — not yet wired up)

```
chat_history        ← conversation threads (sessionId, userId, messages[])
case_documents      ← case document blobs, evidence notes
audit_logs_detail   ← detailed query logs (complements AuditLogs table)
```

## Stratus Buckets (create manually — not yet wired up)

```
ksp-fir-documents   ← scanned FIR PDFs
ksp-evidence        ← photos, seized documents
ksp-exports         ← SmartBrowz-generated PDF exports
```
