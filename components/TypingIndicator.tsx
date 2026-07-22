"use client";

import { motion } from "framer-motion";

/**
 * The "… is typing" row shown above the chat composer. Purely presentational —
 * the live state comes from useTypingChannel (lib/hooks), which rides its OWN
 * realtime channel, separate from the message subscription, so this feature can
 * never affect message delivery. Renders nothing when nobody's typing.
 */
export function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const label =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : "Several people are typing";
  return (
    <div className="flex items-center gap-2 px-4 py-1 text-xs text-foreground/50" aria-live="polite">
      <span className="flex items-end gap-0.5" aria-hidden>
        {[0, 0.15, 0.3].map((delay) => (
          <motion.span
            key={delay}
            className="inline-block h-1.5 w-1.5 rounded-full bg-foreground/40"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay }}
          />
        ))}
      </span>
      <span className="truncate">{label}…</span>
    </div>
  );
}
