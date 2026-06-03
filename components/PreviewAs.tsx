"use client";

import { useEffect, useState } from "react";
import { useIdentity } from "@/components/IdentityProvider";
import { supabase } from "@/lib/supabase";
import { Avatar } from "@/components/Avatar";

/**
 * Admin-only "view as" control. Preview the app as a signed-out guest, or as a
 * SPECIFIC member — to check what each actually sees (the privacy wall, hidden
 * contact info, first-name-only, their name/avatar in the UI, etc.).
 *
 * Device-local and UI-only — it never changes your real Supabase session, so
 * your data and permissions are untouched; it only changes what's rendered.
 * Admin tools hide while previewing, so you exit from the floating banner
 * ([`PreviewBanner`](components/PreviewBanner.tsx)).
 */
interface P {
  id: string;
  name: string;
  avatar: string | null;
}

export function PreviewAs() {
  const { previewMode, previewMember, setPreviewMode, setPreviewMember } = useIdentity();
  const [people, setPeople] = useState<P[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;
    let active = true;
    sb.from("profiles")
      .select("id, display_name, avatar_url")
      .order("display_name", { ascending: true })
      .then(({ data }) => {
        if (!active) return;
        setPeople(
          ((data ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).map((p) => ({
            id: p.id,
            name: p.display_name?.trim() || "Member",
            avatar: p.avatar_url,
          })),
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const query = q.trim().toLowerCase();
  const shown = query ? people.filter((p) => p.name.toLowerCase().includes(query)) : people;

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-primary/30">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">Admin</span>
        <h2 className="text-sm font-semibold">View as</h2>
      </div>
      <p className="text-xs text-foreground/60">
        Preview the app the way others see it. Admin tools hide while you preview — exit anytime from the banner. UI-only on
        this device; your data &amp; permissions are untouched.
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => setPreviewMode("off")}
          className={`press flex-1 rounded-xl px-3 py-2.5 text-left ring-1 ${previewMode === "off" ? "bg-primary text-white ring-primary" : "bg-background ring-border"}`}
        >
          <span className="block text-sm font-semibold">You</span>
          <span className={`block text-[11px] ${previewMode === "off" ? "text-white/80" : "text-foreground/45"}`}>Admin (normal)</span>
        </button>
        <button
          onClick={() => setPreviewMode("guest")}
          className={`press flex-1 rounded-xl px-3 py-2.5 text-left ring-1 ${previewMode === "guest" ? "bg-primary text-white ring-primary" : "bg-background ring-border"}`}
        >
          <span className="block text-sm font-semibold">A guest</span>
          <span className={`block text-[11px] ${previewMode === "guest" ? "text-white/80" : "text-foreground/45"}`}>Signed-out visitor</span>
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-foreground/70">…or as a specific member:</p>
        {people.length > 5 && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search members…"
            className="w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          />
        )}
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {shown.map((p) => {
            const active = previewMode === "member" && previewMember?.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPreviewMember({ id: p.id, name: p.name, avatarUrl: p.avatar })}
                className={`press flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm ring-1 ${active ? "bg-primary/10 text-primary ring-primary/30" : "ring-transparent hover:bg-background"}`}
              >
                <Avatar name={p.name} url={p.avatar} size={26} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                {active && <span className="shrink-0 text-xs font-semibold text-primary">Viewing</span>}
              </button>
            );
          })}
          {shown.length === 0 && <p className="px-2 py-1 text-xs text-foreground/40">No members{query ? " match" : " yet"}.</p>}
        </div>
      </div>
    </div>
  );
}
