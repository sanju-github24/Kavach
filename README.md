# KAVACH — AI Crime Intelligence & Conversational Analytics

**KAVACH** is an AI-powered crime intelligence platform for the **Karnataka State Police (KSP)**, built entirely on **Zoho Catalyst**. It turns fragmented FIR, accused, victim, and financial records into instant, explainable answers for investigators, analysts, supervisors, and policymakers.

🔗 **Live Demo:** [KAVACH Dashboard](https://ksp-crimint-60073493322.development.catalystserverless.in/app/index.html#/dashboard)

---

## Problem

Officers lack a single, explainable way to query fragmented crime records, spot patterns across cases, and act early. KAVACH provides one conversational and analytical surface over live case data — in English and Kannada.

## Features

| Feature | What it does |
|---|---|
| **Conversational AI** | Ask questions in English or ಕನ್ನಡ (voice-enabled); get charts, tables, and cited sources — powered by Catalyst QuickML RAG |
| **Pattern Analytics** | Crime trends, district breakdowns, seasonal and demographic patterns |
| **Criminal Profiler** | Behavioural risk scoring via Zia AutoML, with explainable investigative leads |
| **Network & Financial Analysis** | Criminal relationship graphs and money-laundering link detection |
| **Crime Forecasting** | 72-hour hotspot prediction with statistical (z-score) early-warning |
| **Intelligence Briefings** | One-click narrative reports, exportable as branded PDF (SmartBrowz) |
| **Text Analytics** | NER, keyword, and sentiment extraction on case narratives (Zia) |
| **Spotlight** | Proactive per-module insights on what changed in the data |

## Tech Stack

**Backend (Zoho Catalyst):** Data Store/ZCQL, Authentication (role-based), QuickML RAG, Serverless Functions (Node.js), SmartBrowz, Stratus, Zia Text Analytics & AutoML

**Frontend:** React + Vite, Tailwind CSS, ECharts, Cytoscape, Leaflet

## Impact

Faster investigations, data-driven patrol deployment, and preventive, transparent policing — every AI output is traceable to its source data.

---

## Repository Structure

```
frontend/                     React + Vite single-page app
functions/ksp_crimint_function/
  chat-query/                 Conversational RAG endpoint
  data-query/                 Analytics / forecast / spotlights / Zia / AutoML
  _lib/                        Shared data-access, intel, sanitize helpers
backend/
  seed-data/csv/               Sample dataset (synthetic hackathon data)
  kavach_risk_training.csv     AutoML training set (deterministic labels)
```

## Setup & Execution

**Prerequisites:** Node.js 18+, `npm install -g zcatalyst-cli`, a Zoho Catalyst project (Data Store, Auth, QuickML, SmartBrowz, Stratus, Zia enabled)

```bash
# 1. Configure secrets — create functions/ksp_crimint_function/catalyst-config.json (git-ignored):
{
  "env_variables": {
    "ZOHO_CLIENT_ID": "<your-client-id>",
    "ZOHO_CLIENT_SECRET": "<your-client-secret>",
    "ZIA_AUTOML_MODEL_ID": "<your-automl-model-id>",
    "STRATUS_BUCKET": "<your-bucket-name>"
  }
}

# 2. Install dependencies
cd frontend && npm install
cd ../functions/ksp_crimint_function && npm install

# 3. Run locally
npx catalyst serve          # from project root, starts functions on :3000
cd frontend && npm run dev  # in a second terminal

# 4. Deploy
npx catalyst deploy
```

## Notes

- All numbers in the UI are computed live from the Catalyst Data Store — no fabricated or hardcoded values.
- Risk scores are deterministic and explainable; every AI answer cites its evidence sources.
- The dataset under `backend/seed-data/` is synthetic sample data for demonstration.
