// The human escape hatch for the Help page. For the least-technical relatives, a
// real person to text matters more than any in-app feature — so /help leads with
// this.
//
// The real name/phone/email now live in Supabase (`resort_config`, migration
// 0082 — see lib/resortConfig.ts `fetchResortConfig()`), NOT here, so they no
// longer ship as literal PII in the public client bundle. This constant stays
// only because other files still import `HELP_CONTACT` by that name; it's a
// neutral placeholder that renders sensibly until the live fetch resolves —
// don't put a real phone/email back here. app/help/page.tsx is the one place
// that fetches + renders the live contact; if you add another consumer, have
// it call `fetchResortConfig()` too rather than reading real values from here.
export const HELP_CONTACT = {
  name: "the resort admin",
  phone: "", // intentionally empty — see lib/resortConfig.ts for the live value
  email: "", // intentionally empty — see lib/resortConfig.ts for the live value
} as const;
