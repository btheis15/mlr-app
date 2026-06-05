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
      if (!active) return;
      const row = data as { display_name: string | null; avatar_url: string | null } | null;
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
