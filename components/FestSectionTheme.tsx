"use client";

import { FestThemeScope } from "@/components/FestThemeScope";
import { useFestContent } from "@/lib/useFestContent";

/**
 * Wraps the whole /family-fest/* subtree in the CURRENT fest year's look
 * (migration 0219). Split out of the layout because the layout is a server
 * component and the look is live, editable data — an editor changing the palette
 * in the Planner should see the section repaint, not have to reload.
 *
 * Reads `useFestContent()` WITHOUT its own Realtime subscription on purpose. The
 * hub already subscribes, and `useFestContent` rides the shared module-scope SWR
 * cache — so a Realtime-triggered reload anywhere updates the value this
 * instance renders from, while a second subscription would duplicate the
 * `fest-content-live` channel for every fest page. The seed's empty look means
 * the first paint (and the prerendered HTML) is the built-in parchment, so
 * there's no flash of an unthemed section.
 */
export function FestSectionTheme({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { config } = useFestContent();
  return (
    <FestThemeScope look={config.look} canvas className={className}>
      {children}
    </FestThemeScope>
  );
}
