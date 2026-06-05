import { Protected } from "@/components/Guard";

/**
 * The standard "reach this person" control: side-by-side Call / Text buttons
 * (tel:/sms:, which work on iOS and Android), gated behind sign-in. Used
 * wherever a lead/chef/contact's number is surfaced.
 */
export function CallTextButtons({
  phone,
  label = "Sign in to call or text",
}: {
  phone: string;
  label?: string;
}) {
  return (
    <Protected label={label}>
      <div className="grid grid-cols-2 gap-2">
        <a
          href={`tel:${phone}`}
          className="press rounded-xl bg-primary/10 py-3 text-center text-sm font-semibold text-primary"
        >
          📞 Call
        </a>
        <a
          href={`sms:${phone}`}
          className="press rounded-xl bg-accent/10 py-3 text-center text-sm font-semibold text-accent"
        >
          💬 Text
        </a>
      </div>
    </Protected>
  );
}
