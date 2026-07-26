/**
 * auth-me — returns current user + role from UserProfiles table
 * OPTIMIZED: UserProfiles lookup is best-effort, non-blocking
 */
const catalyst = require('zcatalyst-sdk-node');

// ── Token/profile cache ────────────────────────────────────────────────────────
// Cache user profiles to avoid repeated ZCQL on every page load
const profileCache = new Map(); // uid → { profile, role, ts }
const CACHE_TTL    = 5 * 60 * 1000; // 5 minutes

module.exports = async (context, basicIO) => {
  const response = basicIO?.response || context?.res || context?.response;
  const request  = basicIO?.request  || context?.req || context?.request;

  // CORS
  if (response.set) {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (request?.method === 'OPTIONS') return response.status(200).send('');

  try {
    const app      = catalyst.initialize(context);
    const authUser = await app.userManagement().getCurrentUser();

    if (!authUser) return response.status(401).json({ message: 'Unauthorized' });

    const uid   = authUser.user_id   || authUser.userId || authUser.id || 'unknown';
    const email = authUser.email_id  || authUser.emailId || '';
    const firstName = authUser.first_name || authUser.firstName || 'Officer';
    const lastName  = authUser.last_name  || authUser.lastName  || '';

    // ── Serve from cache if fresh ──────────────────────────────────────────────
    const cached = profileCache.get(uid);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
      return response.status(200).json({
        user: cached.user,
        role: cached.role,
      });
    }

    // ── Best-effort ZCQL lookup with timeout ───────────────────────────────────
    let role    = 'investigator';
    let profile = null;

    try {
      const zcql = app.zcql();

      // Race the DB lookup against a 4-second timeout
      const dbPromise = zcql.executeZCQLQuery(
        `SELECT user_id, email, first_name, last_name, role, station, badge_number, is_active FROM UserProfiles WHERE user_id = '${uid}' LIMIT 1`
      );
      const timeoutPromise = new Promise(res => setTimeout(() => res([]), 4000));

      let rows = await Promise.race([dbPromise, timeoutPromise]);

      // Fallback: try by email if user_id not found
      if ((!rows || rows.length === 0) && email) {
        const dbPromise2 = zcql.executeZCQLQuery(
          `SELECT user_id, email, first_name, last_name, role, station, badge_number, is_active FROM UserProfiles WHERE email = '${email}' LIMIT 1`
        );
        const timeout2   = new Promise(res => setTimeout(() => res([]), 3000));
        rows = await Promise.race([dbPromise2, timeout2]);
      }

      if (rows && rows.length > 0) {
        profile = rows[0].UserProfiles || rows[0];
        role    = profile.role || 'investigator';
      }
    } catch (dbErr) {
      console.log('auth-me: UserProfiles lookup failed:', dbErr.message);
    }

    const user = {
      id:           uid,
      email:        email,
      first_name:   profile?.first_name  || firstName,
      last_name:    profile?.last_name   || lastName,
      role:         role,
      station:      profile?.station     || 'Bengaluru Urban',
      badge_number: profile?.badge_number || 'KSP-0001',
      is_active:    profile?.is_active !== undefined ? Number(profile.is_active) : 1,
    };

    // Store in cache
    profileCache.set(uid, { user, role, ts: Date.now() });

    return response.status(200).json({ user, role });

  } catch (err) {
    console.error('auth-me error:', err.message);
    // Graceful fallback — always return 200 with a usable profile
    return response.status(200).json({
      user: {
        id:           'demo-user',
        email:        'officer@ksp.gov.in',
        first_name:   'Officer',
        last_name:    '',
        role:         'investigator',
        station:      'Bengaluru Urban',
        badge_number: 'KSP-0001',
        is_active:    1,
      },
      role: 'investigator',
    });
  }
};