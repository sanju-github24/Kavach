// ── Evidence → offence mapping ───────────────────────────────────────────────
// Object detection names what is in a photo ("knife"); case records name what
// happened ("Murder", "Assault"). The literal word rarely appears in either the
// crime type or the MO narrative, so matching on the label alone finds nothing.
//
// This maps a detected object to the offence classes it is actually used in,
// plus narrative terms worth searching, so a knife on a floor becomes "bladed
// weapon — appears in the Murder/Assault/Robbery case set".

const EVIDENCE_MAP = [
  { match: ['knife', 'scissors', 'blade', 'sword', 'dagger'],
    label: 'bladed weapon',
    crimes: ['Murder', 'Attempt to Murder', 'Assault', 'Robbery', 'Kidnapping', 'Dacoity'],
    terms:  ['knife', 'stab', 'blade', 'sharp weapon', 'weapon'] },

  { match: ['gun', 'pistol', 'rifle', 'firearm', 'revolver'],
    label: 'firearm',
    crimes: ['Murder', 'Attempt to Murder', 'Robbery', 'Dacoity'],
    terms:  ['gun', 'firearm', 'pistol', 'shot', 'fired'] },

  { match: ['car', 'truck', 'bus', 'motorcycle', 'motorbike', 'bicycle', 'scooter', 'vehicle'],
    label: 'vehicle',
    crimes: ['Vehicle Theft', 'Robbery', 'Chain Snatching', 'Kidnapping'],
    terms:  ['vehicle', 'bike', 'motorcycle', 'car', 'two-wheeler', 'getaway'] },

  { match: ['handbag', 'backpack', 'suitcase', 'purse', 'bag'],
    label: 'bag / carried property',
    crimes: ['Theft', 'Chain Snatching', 'Robbery', 'Burglary', 'Pickpocketing'],
    terms:  ['bag', 'purse', 'snatch', 'stolen'] },

  { match: ['cell phone', 'mobile phone', 'phone', 'laptop', 'computer', 'tablet'],
    label: 'electronic device',
    crimes: ['Theft', 'Robbery', 'Cyber Crime', 'Fraud', 'Chain Snatching'],
    terms:  ['mobile', 'phone', 'laptop', 'device'] },

  { match: ['bottle', 'wine glass', 'cup'],
    label: 'bottle / intoxicant',
    crimes: ['Assault', 'NDPS', 'Domestic Violence'],
    terms:  ['liquor', 'alcohol', 'drunk', 'bottle'] },

  { match: ['jewellery', 'necklace', 'ring', 'watch', 'gold'],
    label: 'valuables',
    crimes: ['Theft', 'Chain Snatching', 'Robbery', 'Burglary'],
    terms:  ['gold', 'chain', 'jewel', 'ornament'] },
];

// Objects that carry no forensic signal on their own — reporting "35 cases
// involve a person" is noise, not intelligence.
const NON_PROBATIVE = new Set([
  'person', 'man', 'woman', 'bench', 'chair', 'table', 'floor', 'wall', 'sky',
  'tree', 'plant', 'building', 'room', 'ceiling', 'door', 'window', 'clock',
]);

function classifyObject(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return null;
  if (NON_PROBATIVE.has(n)) return { name: n, probative: false };
  const entry = EVIDENCE_MAP.find(e => e.match.some(m => n.includes(m) || m.includes(n)));
  if (!entry) return { name: n, probative: true, label: n, crimes: [], terms: [n] };
  return { name: n, probative: true, label: entry.label, crimes: entry.crimes, terms: entry.terms };
}

// A case links if its offence class matches, or its narrative mentions a term.
function linkCases(cls, cases) {
  if (!cls || !cls.probative) return { hits: [], via: null };
  const crimeSet = new Set((cls.crimes || []).map(c => c.toLowerCase()));
  const terms = (cls.terms || []).map(t => t.toLowerCase());
  const byCrime = [], byTerm = [];
  cases.forEach(c => {
    const ct = String(c.crime_type || '').toLowerCase();
    const nar = String(c.narrative || '').toLowerCase();
    if (crimeSet.size && [...crimeSet].some(k => ct.includes(k) || k.includes(ct))) byCrime.push(c);
    else if (terms.some(t => nar.includes(t))) byTerm.push(c);
  });
  const hits = [...byCrime, ...byTerm];
  const via = byCrime.length && byTerm.length ? 'offence type and narrative'
            : byCrime.length ? 'offence type'
            : byTerm.length ? 'MO narrative' : null;
  return { hits, via };
}

module.exports = { classifyObject, linkCases, EVIDENCE_MAP, NON_PROBATIVE };
