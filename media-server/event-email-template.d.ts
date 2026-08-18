// Types for event-email-template.js, which is shared between the mac-mini
// mailer (CommonJS `require`) and the web app (`import` — tsconfig has
// allowJs + the @/* root alias). A .d.ts sitting beside the .js wins over
// inference, so the app gets a real signature instead of `any`.
//
// ⚠️ The app imports this so the in-app preview is built by THE SAME function
// that builds the real send. Do not fork a second layout for preview — a
// preview that can disagree with what goes out is worse than none.

/** One work item as the email renders it. */
export interface EventEmailItem {
  title?: string | null;
  notes?: string | null;
  urgency?: "asap" | "this_year" | "next_year" | "nice_to_have" | "custom" | null;
  customLabel?: string | null;
  customColor?: string | null;
  peopleNeeded?: number | null;
}

/** One house that has items on the event — its people get their own send. */
export interface EventEmailHouseGroup {
  houseId?: string | null;
  name?: string | null;
  emoji?: string | null;
  items?: EventEmailItem[] | null;
  /** Present on the mailer's payload only; the preview RPC omits addresses. */
  emails?: string[] | null;
}

/** Shaped like an `event_message_email()` / `event_message_preview()` row. */
export interface EventEmailData {
  subject?: string | null;
  body?: string | null;
  sender_name?: string | null;
  sender_email?: string | null;
  event_id?: string | null;
  event_title?: string | null;
  event_when?: string | null;
  /** Real "YYYY-MM-DD" dates, distinct from the formatted `event_when` string
   *  — feeds the "Add to calendar" link. Null for a seed/synthesized event. */
  event_start_date?: string | null;
  event_end_date?: string | null;
  event_emoji?: string | null;
  event_location?: string | null;
  event_description?: string | null;
  mlr_items?: EventEmailItem[] | null;
  house_groups?: EventEmailHouseGroup[] | null;
  general_emails?: string[] | null;
}

export interface BuiltEventEmail {
  subject: string;
  html: string;
  text: string;
  taskCount: number;
}

/**
 * Build the subject + HTML + plain-text parts for ONE bucket.
 * @param bucket the house this send is for, or null for the general send.
 */
export function buildEventEmail(
  d: EventEmailData,
  appUrl: string,
  bucket?: EventEmailHouseGroup | null,
): BuiltEventEmail;

export function escapeHtml(s: unknown): string;
export function urgencyLabel(it: EventEmailItem | null | undefined): string;
