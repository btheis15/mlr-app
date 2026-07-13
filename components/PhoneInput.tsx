"use client";

import { formatPhoneNational, formatPhoneStored, phoneDigits } from "@/lib/format";

/**
 * Phone entry that assumes "+1" so the less-technical family members don't have
 * to think about country codes. The "+1" sits fixed in front; they just type
 * the 10 digits and watch them fall into a friendly "(715) 555-0123" — never a
 * long unbroken string. Stores the full canonical "+1 (715) 555-0123" (which
 * `tel:`/`sms:` links re-strip to digits, so it stays link-safe).
 *
 * `className` tweaks the wrapper (e.g. `mt-1`); it already carries the same
 * rounded / ring / focus look as the app's plain inputs so it drops in beside
 * them.
 */
interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  id?: string;
}

export function PhoneInput({ value, onChange, className = "", placeholder = "(715) 555-0123", id }: Props) {
  const display = formatPhoneNational(phoneDigits(value));
  return (
    <div
      className={`flex w-full items-stretch overflow-hidden rounded-xl bg-background text-sm ring-1 ring-border focus-within:ring-2 focus-within:ring-primary ${className}`}
    >
      <span className="flex select-none items-center border-r border-border pl-3 pr-2 font-medium text-muted">
        +1
      </span>
      <input
        id={id}
        value={display}
        onChange={(e) => onChange(formatPhoneStored(e.target.value))}
        placeholder={placeholder}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        className="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none"
      />
    </div>
  );
}
