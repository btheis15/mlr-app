import { ScrollReset } from "@/components/ScrollReset";

// Wraps each page's content. Unlike layout.tsx, template.tsx mounts a fresh
// instance on every navigation, so the `page-enter` CSS animation re-fires on
// each tab tap / route change — a subtle Messages-style right-to-left slide
// (see globals.css: a full fade here reads as a flash now that cached pages
// paint instantly). It stays a Server
// Component (no state, no hooks) so the markup is byte-identical server/client
// (no hydration mismatch) and it's safe under the static export. The shell
// (TabBar, providers) lives in layout.tsx and does not re-animate.
// ScrollReset renders nothing (a pure effect), so the markup stays
// byte-identical here too.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-enter">
      <ScrollReset />
      {children}
    </div>
  );
}
