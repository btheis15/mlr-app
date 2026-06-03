"use client";

import { useEffect, useRef, useState } from "react";

/**
 * In-app GIF search, backed by Tenor (Google) — reliable on iOS *and* Android,
 * unlike relying on the phone keyboard's GIF key inside a web app. The chosen
 * GIF is hotlinked from Tenor's CDN (we store its URL, media_type 'gif'), so it
 * costs no storage anywhere.
 *
 * Env-gated: set NEXT_PUBLIC_TENOR_KEY (a free key from
 * https://developers.google.com/tenor/guides/quickstart). With no key, this
 * shows a tasteful "not set up yet" note instead of breaking — nothing else in
 * the composer is affected.
 */
const TENOR_KEY = process.env.NEXT_PUBLIC_TENOR_KEY || "";

export interface PickedGif {
  url: string;
  width?: number;
  height?: number;
}

interface TenorResult {
  id: string;
  content_description?: string;
  media_formats?: Record<string, { url: string; dims?: [number, number] }>;
}

export function GifPicker({ onSelect, onClose }: { onSelect: (gif: PickedGif) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TenorResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!TENOR_KEY) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void run(q), q ? 350 : 0);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const run = async (query: string) => {
    setLoading(true);
    setErr(null);
    try {
      const base = "https://tenor.googleapis.com/v2";
      const path = query.trim()
        ? `/search?q=${encodeURIComponent(query.trim())}`
        : "/featured?";
      const url = `${base}${path}&key=${TENOR_KEY}&client_key=mlr-app&limit=24&media_filter=tinygif,gif&contentfilter=high`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Tenor ${r.status}`);
      const json = (await r.json()) as { results?: TenorResult[] };
      setResults(json.results ?? []);
    } catch {
      setErr("Couldn't load GIFs just now.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const pick = (res: TenorResult) => {
    const full = res.media_formats?.gif ?? res.media_formats?.tinygif;
    if (!full?.url) return;
    onSelect({ url: full.url, width: full.dims?.[0], height: full.dims?.[1] });
  };

  return (
    <div className="space-y-2 rounded-2xl bg-background p-2 ring-1 ring-border">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search GIFs…"
          autoFocus
          className="flex-1 rounded-full bg-card px-3 py-1.5 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
        />
        <button type="button" onClick={onClose} className="press rounded-full px-2 py-1 text-xs font-medium text-foreground/50">
          Close
        </button>
      </div>

      {!TENOR_KEY ? (
        <p className="rounded-xl bg-card px-3 py-4 text-center text-xs text-foreground/55 ring-1 ring-border">
          🎬 GIF search isn&rsquo;t set up yet. Add a free <span className="font-semibold">NEXT_PUBLIC_TENOR_KEY</span> to enable it. You can still send emojis, stickers, and photos.
        </p>
      ) : (
        <>
          <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto overscroll-contain">
            {results.map((res) => {
              const thumb = res.media_formats?.tinygif?.url ?? res.media_formats?.gif?.url;
              if (!thumb) return null;
              return (
                <button
                  key={res.id}
                  type="button"
                  onClick={() => pick(res)}
                  className="press aspect-square overflow-hidden rounded-lg bg-card ring-1 ring-border"
                  aria-label={res.content_description || "GIF"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                </button>
              );
            })}
          </div>
          {loading && <p className="py-2 text-center text-xs text-foreground/40">Loading…</p>}
          {err && <p className="py-2 text-center text-xs text-accent">{err}</p>}
          {!loading && !err && results.length === 0 && (
            <p className="py-2 text-center text-xs text-foreground/40">No GIFs found.</p>
          )}
          <p className="text-center text-[10px] text-foreground/30">Powered by Tenor</p>
        </>
      )}
    </div>
  );
}
