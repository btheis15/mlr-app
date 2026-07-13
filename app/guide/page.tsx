"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * In-app viewer for the guided-tour PDF (public/mlr-app-guide.pdf). We embed the
 * PDF on a normal in-app route — rather than linking straight to the file —
 * specifically so the app chrome (bottom TabBar) and a Back button stay put.
 * Opening the raw PDF in a standalone PWA leaves people with no way back; this
 * page always gives them one. "Open full screen" is the escape hatch for anyone
 * whose browser won't render the embed inline.
 */
export default function GuidePage() {
  const router = useRouter();

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={goBack}
          className="press inline-flex items-center gap-1 text-sm font-semibold text-primary"
        >
          ‹ Back
        </button>
        <a
          href="/mlr-app-guide.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="press text-xs font-medium text-muted underline-offset-2 hover:underline"
        >
          Open full screen ↗
        </a>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Guided tour</h1>
        <p className="text-sm text-foreground/65">
          A quick, screen-by-screen walk through the app.
        </p>
      </header>

      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        <iframe
          src="/mlr-app-guide.pdf"
          title="MLR app guided tour"
          className="h-[78vh] w-full"
        />
      </div>

      <p className="text-center text-xs text-muted">
        Can&rsquo;t see it?{" "}
        <a
          href="/mlr-app-guide.pdf"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:underline"
        >
          Open the guide as a PDF
        </a>
        .
      </p>
    </div>
  );
}
