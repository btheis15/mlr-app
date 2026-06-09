// The human escape hatch for the Help page. For the least-technical relatives, a
// real person to text matters more than any in-app feature — so /help leads with
// this. Brian (the admin) handles it.
//
// 👉 SET `phone` to your mobile in E.164 format — a leading "+", country code,
//    then the number, no spaces or dashes (US example: "+17155551234"). That's
//    what makes the tap-to-Text and tap-to-Call buttons work. Leave it empty and
//    the Help page quietly falls back to the email link instead.
export const HELP_CONTACT = {
  name: "Brian",
  phone: "+12248005389", // E.164; powers tap-to-text / tap-to-call
  email: "brian.theis15@gmail.com",
} as const;
