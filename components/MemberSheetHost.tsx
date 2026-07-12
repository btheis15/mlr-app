"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { MemberSheet } from "@/components/MemberSheet";

/**
 * Opens a member's contact card from a deep link: any URL with `?member=<id>`
 * (e.g. tapping a birthday push notification) pops the MemberSheet for that
 * person — with their Call / Text buttons — then strips the param so a refresh
 * or back-press doesn't reopen it. Mounted once, app-wide, in the layout.
 */
export function MemberSheetHost() {
  const [member, setMember] = useState<{ id: string; name: string; avatarUrl: string | null } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !supabase) return;
    const id = new URLSearchParams(window.location.search).get("member");
    if (!id) return;
    // Strip ?member so a reload/back-press doesn't reopen the sheet.
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("member");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch {
      /* ignore */
    }
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", id)
        .maybeSingle();
      let row = data as { display_name: string | null; avatar_url: string | null } | null;
      // Guests can't read `profiles` under the RLS lockdown (0081) — fall back
      // to the guest-tier `public_profiles` view (first name + avatar) so a
      // deep link still shows who the card is about. If the view doesn't exist
      // yet (pre-migration) this read just errors and we keep the "Member"
      // default — never a hard failure.
      if (!row) {
        const pub = await supabase
          .from("public_profiles")
          .select("display_name, avatar_url")
          .eq("id", id)
          .maybeSingle();
        if (!pub.error) row = pub.data as typeof row;
      }
      if (!active) return;
      setMember({ id, name: row?.display_name?.trim() || "Member", avatarUrl: row?.avatar_url ?? null });
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!member) return null;
  return (
    <MemberSheet
      key={member.id}
      id={member.id}
      name={member.name}
      avatarUrl={member.avatarUrl}
      onClose={() => setMember(null)}
    />
  );
}
