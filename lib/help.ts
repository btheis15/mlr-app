// The human escape hatch for the Help page. For the least-technical relatives, a
// real person to text matters more than any in-app feature — so /help leads with
// this.
//
// The real name/phone/email now live in Supabase (`resort_config`, migration
// 0082 — see lib/resortConfig.ts `fetchResortConfig()`), NOT here, so they no
// longer ship as literal PII in the public client bundle. Nothing imports this
// constant anymore (app/help/page.tsx fetches the live contact itself); it
// survives only as the documented guard-rail for the old name — if you need
// the help contact somewhere new, call `fetchResortConfig()`, and don't put a
// real phone/email back here.
export const HELP_CONTACT = {
  name: "the resort admin",
  phone: "", // intentionally empty — see lib/resortConfig.ts for the live value
  email: "", // intentionally empty — see lib/resortConfig.ts for the live value
} as const;
