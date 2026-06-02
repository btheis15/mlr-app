// Wraps each page's content. Unlike layout.tsx, template.tsx mounts a fresh
// instance on every navigation, so the `page-enter` CSS animation re-fires on
// each tab tap / route change — a quick iOS-style fade-up. It stays a Server
// Component (no state, no hooks) so the markup is byte-identical server/client
// (no hydration mismatch) and it's safe under the static export. The shell
// (TabBar, providers) lives in layout.tsx and does not re-animate.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
