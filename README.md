# KAVACH — AI Crime Intelligence & Conversational Analytics

**KAVACH** is an AI-powered crime intelligence and conversational analytics platform built for the **Karnataka State Police (KSP)**, deployed entirely on **Zoho Catalyst**. It turns fragmented FIR, accused, victim, and financial records into instant, explainable decisions for investigators, analysts, supervisors, and policymakers.

---

## Problem

Officers lack a unified, explainable way to query fragmented crime records, spot patterns across cases, and act early. KAVACH provides a single conversational and analytical surface over live case data — in English and Kannada.

## Key Features

- **Conversational AI** — Natural-language queries in English & ಕನ್ನಡ (voice-enabled) over live case records, returning charts, tables, and source citations. Powered by Catalyst QuickML RAG.
- **Pattern Analytics** — Crime trends, district breakdowns, seasonal patterns, and demographic analysis.
- **Criminal Profiler** — Behavioural profiling with **Zia AutoML** risk scoring and explainable investigative leads.
- **Network & Financial Analysis** — Criminal relationship graphs and money-flow / laundering link analysis.
- **Crime Forecasting** — 72-hour hotspot prediction with statistical anomaly (z-score) early-warning.
- **AI Intelligence Briefings** — One-click narrative reports with explainable-AI trails, exportable as branded PDF (Catalyst SmartBrowz).
- **Zia Text Analytics** — NER, keyword, and sentiment extraction on case narratives.
- **KAVACH Spotlight** — Proactive per-module insights that surface what changed in the data.

## Technology Stack

**Backend — Zoho Catalyst (mandatory platform):**
- Data Store / ZCQL — case, accused, victim, and financial records
- Authentication — role-based access (admin, supervisor, analyst, investigator, policymaker)
- QuickML RAG — retrieval-augmented conversational answers
- Serverless Functions (Node.js) — query, analytics, forecasting, briefing endpoints
- SmartBrowz — server-side branded PDF generation
- Stratus — media/object storage for accused photos
- Zia Text Analytics & Zia AutoML — NER/keywords/sentiment and risk classification

**Frontend:**
- React + Vite
- Tailwind CSS (dark, data-dense dashboard design system)
- Apache ECharts, Cytoscape, Leaflet for visualisation

## Impact & Use Case

Faster investigations, data-driven patrol deployment, and preventive, transparent policing — with every AI output traceable to its source data.

---

## Repository Structure

```
frontend/                     React + Vite single-page app
functions/                    Catalyst serverless functions
  ksp_crimint_function/
    chat-query/               Conversational RAG endpoint
    data-query/               Analytics / forecast / spotlights / Zia / AutoML
    _lib/                     Shared data-access, intel, sanitize helpers
backend/
  seed-data/csv/              Sample dataset (synthetic hackathon data)
  kavach_risk_training.csv    AutoML training set (deterministic labels)
```

## Setup & Execution

### Prerequisites
- Node.js 18+
- Zoho Catalyst CLI: `npm install -g zcatalyst-cli`
- A Zoho Catalyst project (Data Store, Authentication, QuickML, SmartBrowz, Stratus, Zia enabled)

### 1. Configure secrets
The file `functions/ksp_crimint_function/catalyst-config.json` holds environment variables and is **git-ignored** (never committed). Create it with:

```json
{
  "env_variables": {
    "ZOHO_CLIENT_ID": "<your-client-id>",
    "ZOHO_CLIENT_SECRET": "<your-client-secret>",
    "ZIA_AUTOML_MODEL_ID": "<your-automl-model-id>",
    "STRATUS_BUCKET": "<your-bucket-name>"
  }
}
```

### 2. Install dependencies
```bash
cd frontend && npm install
cd ../functions/ksp_crimint_function && npm install
```

### 3. Run locally
```bash
# From the project root — starts Catalyst functions on :3000
npx catalyst serve

# In a second terminal — starts the frontend (proxies /server to :3000)
cd frontend && npm run dev
```

Open the printed local URL (e.g. `http://localhost:5173`).

### 4. Deploy to Catalyst
```bash
npx catalyst deploy
```
The CLI prints the hosted app URL on completion.

---

## Notes
- All numbers shown in the UI are computed live from the Catalyst Data Store — no fabricated or hardcoded values.
- Risk scores are deterministic and explainable; every AI answer cites its evidence sources.
- The dataset under `backend/seed-data/` is synthetic sample data for demonstration.
