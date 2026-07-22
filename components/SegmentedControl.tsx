"use client";

import { LayoutGroup, motion } from "framer-motion";
import { useId, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  /** Optional per-segment active tint (defaults to the shared `activeClass`). */
  activeClass?: string;
}

/**
 * iOS-style segmented control with a shared-element active "pill" that GLIDES
 * between options (framer-motion layoutId) instead of hard-swapping — the
 * RangeTabs pattern from the sibling stock-game app. Theme-token colors only;
 * degrades to an instant move under Reduce Motion (via MotionProvider's
 * reducedMotion="user"). A light haptic fires on change.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  className = "",
  pillClass = "bg-primary",
  activeTextClass = "text-white",
  idleTextClass = "text-foreground/60",
  size = "md",
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  /** The gliding pill's background (a solid token surface). */
  pillClass?: string;
  activeTextClass?: string;
  idleTextClass?: string;
  size?: "sm" | "md";
}) {
  const groupId = useId();
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <LayoutGroup id={groupId}>
      <div className={`inline-flex items-stretch gap-1 rounded-full bg-foreground/5 p-1 ${className}`} role="tablist">
        {segments.map((seg) => {
          const active = seg.value === value;
          return (
            <button
              key={seg.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                if (!active) {
                  haptic("light");
                  onChange(seg.value);
                }
              }}
              className={`press relative rounded-full font-semibold transition-colors ${pad} ${active ? activeTextClass : idleTextClass}`}
            >
              {active && (
                <motion.span
                  layoutId="segmented-pill"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className={`absolute inset-0 rounded-full ${seg.activeClass ?? pillClass}`}
                  aria-hidden
                />
              )}
              <span className="relative z-10 whitespace-nowrap">{seg.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
