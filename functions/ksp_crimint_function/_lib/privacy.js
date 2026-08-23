// ── PII protection ───────────────────────────────────────────────────────────
// KAVACH surfaces powerful capabilities (face comparison, offender profiling),
// so identity data is exposed on a need-to-know basis rather than to everyone
// who can log in.
//
// Case-working roles (investigator / supervisor / admin) see full identities —
// they are acting on specific people. Aggregate-analysis roles (analyst /
// policymaker) study patterns, not persons, so personal identifiers are
// reduced to initials before they ever leave the server.

const IDENTITY_ROLES = new Set(['admin', 'supervisor', 'investigator']);

function canSeeIdentities(role) {
  return IDENTITY_ROLES.has(String(role || '').toLowerCase());
}

// "Ramesh Kumar" -> "R. K." ; keeps the record linkable without naming a person
function maskPerson(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.map(p => p[0].toUpperCase() + '.').join(' ');
}

// Account / document numbers: keep the last 4 so records stay reconcilable
function maskNumber(value) {
  const s = String(value || '');
  if (s.length <= 4) return s ? '****' : '';
  return '****' + s.slice(-4);
}

// Applies masking to a list of objects in place-safe fashion.
// fields: { person: [...keys], number: [...keys] }
function maskRecords(rows, role, fields = {}) {
  if (canSeeIdentities(role) || !Array.isArray(rows)) return rows;
  const persons = fields.person || [];
  const numbers = fields.number || [];
  return rows.map(r => {
    if (!r || typeof r !== 'object') return r;
    const out = { ...r };
    persons.forEach(k => { if (out[k]) out[k] = maskPerson(out[k]); });
    numbers.forEach(k => { if (out[k]) out[k] = maskNumber(out[k]); });
    return out;
  });
}

module.exports = { canSeeIdentities, maskPerson, maskNumber, maskRecords };
