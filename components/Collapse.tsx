import type { ReactNode } from "react";

/**
 * Smooth, iOS-style expand/collapse. Animates the panel's height (grid rows
 * 0fr → 1fr; see `.collapse` in globals.css) so it opens/closes gently and the
 * content below *slides* rather than jumping — no screen fidget. Children stay
 * mounted so the close animation can play, and they cross-fade. Honors the OS
 * reduce-motion setting.
 *
 * Usage: <Collapse open={isOpen}><div>…</div></Collapse>
 */
export function Collapse({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="collapse" data-open={open ? "true" : "false"}>
      <div className={`collapse-inner ${className}`}>{children}</div>
    </div>
  );
}
