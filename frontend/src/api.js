/**
 * KSP CRIMINT — Frontend API Layer
 *
 * Features:
 * - In-flight request deduplication (same URL+body returns same promise)
 * - sessionStorage response cache (5 min TTL) to avoid redundant calls
 * - Exponential backoff retry on 429 / 5xx errors (max 3 retries)
 * - 401 → redirect to login
 */

const BASE = import.meta.env.VITE_CATALYST_BASE_URL || ''
const FN   = import.meta.env.VITE_FUNCTION_NAME     || 'ksp_crimint_function'

export const API = {
  AUTH_ME:    `${BASE}/server/${FN}/auth-me`,
  AUTH_ROLE:  `${BASE}/server/${FN}/auth-role`,
  CHAT_QUERY: `${BASE}/server/${FN}/chat-query`,
  DATA_QUERY: `${BASE}/server/${FN}/data-query`,
}

// ── In-memory: in-flight deduplication ────────────────────────────────────────
// If the same request is already in-flight, return the same promise
const inflight = new Map()   // cacheKey → Promise

// ── sessionStorage cache ───────────────────────────────────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem('ksp_api_' + key)
    if (!raw) return null
    const { ts, data } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL_MS) { sessionStorage.removeItem('ksp_api_' + key); return null }
    return data
  } catch { return null }
}

function cacheSet(key, data) {
  try { sessionStorage.setItem('ksp_api_' + key, JSON.stringify({ ts: Date.now(), data })) } catch {}
}

export function cacheClear() {
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith('ksp_api_'))
      .forEach(k => sessionStorage.removeItem(k))
  } catch {}
}

// ── Exponential backoff retry ──────────────────────────────────────────────────
function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res  = await fetch(url, options)
      const data = await res.json().catch(() => ({}))

      if (res.status === 401) {
        localStorage.removeItem('catalyst_token')
        localStorage.removeItem('ksp_user')
        window.location.href = '/login'
        return
      }

      if (res.status === 429 || (res.status >= 500 && res.status !== 501)) {
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 8000) // 1s, 2s, 4s, max 8s
          console.warn(`[API] ${res.status} on ${url} — retry ${attempt + 1}/${retries} in ${delay}ms`)
          await wait(delay)
          continue
        }
      }

      if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`)
      return data

    } catch (err) {
      if (attempt < retries && err.message !== 'HTTP 501') {
        const delay = Math.min(800 * Math.pow(2, attempt), 6000)
        console.warn(`[API] Error on ${url}:`, err.message, `— retry in ${delay}ms`)
        await wait(delay)
        continue
      }
      throw err
    }
  }
}

// ── Core smart request (dedup + cache + retry) ─────────────────────────────────
async function request(url, options = {}, { useCache = false, cacheKey = '' } = {}) {
  const token = localStorage.getItem('catalyst_token')

  const finalOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  }

  // Cache hit?
  const key = cacheKey || (url + (options.body || ''))
  if (useCache) {
    const cached = cacheGet(key)
    if (cached) { console.log('[API] cache hit:', url); return cached }
  }

  // Already in-flight? Return same promise (dedup)
  if (inflight.has(key)) {
    console.log('[API] dedup in-flight:', url)
    return inflight.get(key)
  }

  // Fire request
  const promise = fetchWithRetry(url, finalOptions)
    .then(data => {
      if (useCache && data) cacheSet(key, data)
      return data
    })
    .finally(() => inflight.delete(key))

  inflight.set(key, promise)
  return promise
}

// ── Auth ───────────────────────────────────────────────────────────────────────
export async function loginUser(email, password) {
  const PROJECT = import.meta.env.VITE_CATALYST_PROJECT_ID || ''
  const res = await fetch(
    `https://auth.catalyst.zoho.com/baas/v1/project/${PROJECT}/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_id: email, password }),
    }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Login failed')
  const token = data.data?.access_token
  if (!token) throw new Error('No token returned')
  localStorage.setItem('catalyst_token', token)
  cacheClear() // Clear stale cache on new login
  const profile = await getMe()
  if (profile?.user) localStorage.setItem('ksp_user', JSON.stringify(profile.user))
  return profile?.user
}

export async function getMe() {
  return request(API.AUTH_ME, {}, { useCache: true, cacheKey: 'auth_me' })
}

export async function getRole() {
  return request(API.AUTH_ROLE, {}, { useCache: true, cacheKey: 'auth_role' })
}

export function logoutUser() {
  localStorage.removeItem('catalyst_token')
  localStorage.removeItem('ksp_user')
  cacheClear()
}

// ── Data Query (all pages) ─────────────────────────────────────────────────────
// The signed-in officer's role travels with every query so the server can
// decide what identity data this viewer is entitled to see (see _lib/privacy.js).
// It is part of the cache key too, so one role's view can never be served to
// another from cache.
function currentRole() {
  try { return JSON.parse(localStorage.getItem('ksp_user') || '{}')?.role || '' } catch { return '' }
}

export async function dataQuery(action, body = {}) {
  const role = currentRole()
  return request(
    API.DATA_QUERY,
    { method: 'POST', body: JSON.stringify({ action, role, ...body }) },
    { useCache: true, cacheKey: `data_${action}_${role}_${JSON.stringify(body)}` }
  )
}

// ── Chat ───────────────────────────────────────────────────────────────────────
// Chat is NOT cached — every message is unique
export async function sendChatQuery(message, language = 'en', history = [], user = {}, sessionId = null) {
  return request(
    API.CHAT_QUERY,
    { method: 'POST', body: JSON.stringify({ message, language, history, user, sessionId }) },
    { useCache: false }
  )
}

// ── Chat history (server-persisted, not cached — lists/messages change on
// every turn and must never be served stale) ───────────────────────────────
export async function listChatSessions(userId) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'chat_sessions', userId }) }, { useCache: false })
}
export async function getChatSessionMessages(sessionId) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'chat_session_messages', sessionId }) }, { useCache: false })
}
export async function deleteChatSession(sessionId) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'chat_session_delete', sessionId }) }, { useCache: false })
}

// ── AI Intelligence Briefing ────────────────────────────────────────────────
// Shares the chat-query endpoint (action:'briefing' instead of a message) so
// it reuses the same RAG token/call plumbing; not cached — always regenerate.
export async function generateBriefing(scope = 'Statewide', user = {}) {
  return request(
    API.CHAT_QUERY,
    { method: 'POST', body: JSON.stringify({ action: 'briefing', scope, user }) },
    { useCache: false }
  )
}

// ── Briefing history ─────────────────────────────────────────────────────────
export async function listBriefings(userId) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'briefings_list', userId }) }, { useCache: false })
}
export async function getBriefing(briefingId) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'briefing_get', briefingId }) }, { useCache: false })
}
export async function deleteBriefing(briefingId) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'briefing_delete', briefingId }) }, { useCache: false })
}

// ── Accused photos — no real mugshots in this dataset; officers can attach
// one manually, stored as a resized base64 JPEG. Not cached: uploads/deletes
// must be reflected immediately everywhere the same accused ID appears. ─────
export async function getAccusedPhotosBulk(accusedIds) {
  if (!accusedIds?.length) return { photos: {} }
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'accused_photos_bulk', accusedIds }) }, { useCache: false })
}
export async function setAccusedPhoto(accusedId, photoData, userId) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'accused_photo_set', accusedId, photoData, userId }) }, { useCache: false })
}
export async function deleteAccusedPhoto(accusedId, userId) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'accused_photo_delete', accusedId, userId }) }, { useCache: false })
}

// ── Zia Text Analytics — keyword extraction, named-entity recognition, and
// sentiment/tone on crime narratives (BriefFacts). Returns { keywords, entities,
// sentiment } or { error } if the Zia service is unavailable.
export async function analyzeText(documents) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'text_analysis', documents }) }, { useCache: false })
}

// ── Zia AutoML risk prediction — sends an accused's structured features to the
// trained AutoML model. Returns { prediction: { classification_result } } or
// { error: 'model_not_configured' | 'automl_unavailable' }.
export async function predictRisk(features) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'predict_risk', features }) }, { useCache: false })
}

// ── Catalyst Zia Vision ───────────────────────────────────────────────────────
// Three image-intelligence calls. Each is designed to end in analysable data:
// OCR turns paper FIRs into structured case fields, face match ranks the
// accused gallery, and object detection tags evidence photos so the tags can
// be charted as a new analytic dimension.

// Scanned/photographed FIR -> { text, confidence, fields, entities }
export async function ocrIntake(imageB64) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'ocr_intake', imageB64, role: currentRole() }) }, { useCache: false })
}

// Probe photo -> { matches: [{ accused_id, name, confidence }], comparedCount }
export async function faceMatch(imageB64, limit = 40) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'face_match', imageB64, limit, role: currentRole() }) }, { useCache: false })
}

// Scene/evidence photo -> { objects: [{ name, confidence }], count }
export async function evidenceAnalyze(imageB64) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'evidence_analyze', imageB64 }) }, { useCache: false })
}

// ── KAVACH Sentinel ───────────────────────────────────────────────────────────
// Recomputes the live alert set on demand (and on a Catalyst Cron schedule),
// optionally delivering a priority digest by Catalyst Email.
export async function sentinelScan({ notify = false, to = '' } = {}) {
  return request(API.DATA_QUERY, { method: 'POST', body: JSON.stringify({ action: 'sentinel_scan', notify, to }) }, { useCache: false })
}

// ── Convenience wrappers used by pages ────────────────────────────────────────
export const fetchAnalytics = () => dataQuery('analytics')
export const fetchNetwork   = () => dataQuery('networks')
export const fetchProfiles  = (search = '') => dataQuery('profiler', search ? { search } : {})
export const fetchForecast  = () => dataQuery('forecast')
export const fetchDashboard = () => dataQuery('dashboard')
export const fetchSociological = () => dataQuery('sociological')
export const fetchFinancial     = () => dataQuery('financial')