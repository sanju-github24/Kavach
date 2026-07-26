/**
 * ZCQL input sanitization — shared by data-query, chat-query, auth-role.
 * Catalyst's zcatalyst-sdk-node ZCQL executor takes a raw query string with
 * no parameter-binding API, so every value interpolated into a query must be
 * escaped here before use.
 */

// Escape a value for safe use inside a single-quoted ZCQL string literal.
// Strips backslashes/quotes rather than doubling quotes, since ZCQL's escaping
// rules for embedded quotes are not guaranteed — stripping is the safe default.
function escStr(v) {
  return String(v ?? '').replace(/['"\\;]/g, '').slice(0, 300);
}

// For values that should only ever be simple identifiers (IDs, enum-like
// fields such as status/role/action) — keep alphanumerics, space, dash, slash.
function escId(v) {
  return String(v ?? '').replace(/[^A-Za-z0-9 _\-\/]/g, '').slice(0, 100);
}

// Same stripping rules as escStr (quotes/backslash/semicolon removed — ZCQL
// has no parameter binding, so these characters can't be safely preserved)
// but without the 300-char cap, for TEXT columns storing full chat replies
// or briefing documents. Newlines are left intact.
function escLongText(v, max = 8000) {
  return String(v ?? '').replace(/['"\\;]/g, '').slice(0, max);
}

module.exports = { escStr, escId, escLongText };
