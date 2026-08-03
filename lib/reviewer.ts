// The Apple App Review demo account. It's kept fully functional — the reviewer
// signs in and uses the app for real, so it must never be blocked — but it's
// hidden from the member-facing People directory and left out of the member
// count, since it isn't a family member and the family doesn't need to see it.
// (Admin surfaces like AdminMembers still show it, so it can be managed.)
//
// Matched by display name (the account is named "App Review"); if it's ever
// renamed or you'd rather key off the login email, add it to REVIEWER_EMAILS.

const REVIEWER_NAMES = new Set(["app review"]);
const REVIEWER_EMAILS = new Set<string>([]); // lowercase emails, if ever needed

/** True for the Apple reviewer demo account — hide it from member-facing lists. */
export function isReviewerAccount(p: {
  display_name?: string | null;
  contact_email?: string | null;
}): boolean {
  const name = (p.display_name ?? "").trim().toLowerCase();
  const email = (p.contact_email ?? "").trim().toLowerCase();
  return (name !== "" && REVIEWER_NAMES.has(name)) || (email !== "" && REVIEWER_EMAILS.has(email));
}
