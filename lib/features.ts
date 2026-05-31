/**
 * Feature flags for staged rollout.
 *
 * `READ_ONLY` — public read-only launch. The whole browse experience (resort
 * info, activities, dining, Family Fest hub, schedule, reading chat) is live;
 * the *interactive* features (sign-in, posting in chat, RSVP, photo uploads,
 * admin alerts) are deferred to the Supabase phase (NEXT-STEPS.md §3). While
 * this is true, write actions render a tasteful "coming soon" instead of the
 * device-local stand-in, so nothing looks fake or broken.
 *
 * Flip to `false` (or wire to `isSupabaseConfigured`) when login lands.
 */
export const READ_ONLY: boolean = true;
