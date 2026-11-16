"use client";

import { useState } from "react";
import { MigrationHint } from "@/components/MigrationHint";
import { SkeletonCard } from "@/components/Skeleton";
import { useCachedResource } from "@/lib/swrCache";
import { mediaSrc } from "@/lib/mediaToken";
import {
  deleteLocalPlace,
  fetchLocalPlaces,
  groupKeys,
  groupTitle,
  KNOWN_GROUPS,
  PLACES,
  saveLocalPlace,
  saveLocalPlaceOrder,
  uploadLocalPlaceImage,
  validateLocalPlace,
  type LocalPlace,
  type LocalPlaceInput,
  type PlaceAccent,
} from "@/lib/places";

/**
 * Admin editor for Local Places (migration 0225, table `local_places`): every
 * contract field, add, delete (with confirm), hide/show, reorder within a
 * section, and a photo upload to site-assets/local-places/. Writes are
 * admin-only by RLS; the page is also wrapped in AdminGuard. Real Postgres
 * errors are shown, never swallowed. Reads here come straight from the table
 * (hidden rows included, since admins can read them); if the read errors the
 * migration hasn't run and we show the MigrationHint instead of fake rows.
 */

const ACCENTS: PlaceAccent[] = ["primary", "lake", "campfire", "sun", "dusk"];
const FIELD = "mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary";

function blank(group: string, position: number): LocalPlaceInput {
  return {
    slug: "", name: "", category: "", group, locality: "", address: "", blurb: "", emoji: "📍",
    accent: "primary", imageUrl: "", website: "", menuUrl: "", orderUrl: "", phoneDisplay: "",
    phoneTel: "", internalHref: "", internalCta: "", bookingUrl: "", bookingCta: "", ratesUrl: "",
    ratesCta: "", position, isActive: true,
  };
}

function toInput(p: LocalPlace): LocalPlaceInput {
  return {
    id: p.id, slug: p.slug, name: p.name, category: p.category, group: p.group, locality: p.locality,
    address: p.address ?? "", blurb: p.blurb, emoji: p.emoji, accent: p.accent, imageUrl: p.imageUrl ?? "",
    website: p.website ?? "", menuUrl: p.menuUrl ?? "", orderUrl: p.orderUrl ?? "",
    phoneDisplay: p.phoneDisplay ?? "", phoneTel: p.phoneTel ?? "", internalHref: p.internalHref ?? "",
    internalCta: p.internalCta ?? "", bookingUrl: p.bookingUrl ?? "", bookingCta: p.bookingCta ?? "",
    ratesUrl: p.ratesUrl ?? "", ratesCta: p.ratesCta ?? "", position: p.position ?? 0, isActive: p.isActive !== false,
  };
}

export function AdminLocalPlaces() {
  const { data, loading, reload } = useCachedResource("adminLocalPlaces", { places: PLACES, fromDb: false }, fetchLocalPlaces);
  const [editing, setEditing] = useState<LocalPlaceInput | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (loading) return <SkeletonCard />;
  if (!data.fromDb) {
    return (
      <MigrationHint file="0225_local_places.sql">
        To edit Local Places in-app,
      </MigrationHint>
    );
  }

  const places = data.places;
  const keys = groupKeys(places);

  const report = (r: { error?: string }, ok: string) => {
    if (r.error) {
      setErr(r.error);
      setMsg(null);
    } else {
      setErr(null);
      setMsg(ok);
    }
  };

  const move = async (group: string, id: string, dir: -1 | 1) => {
    const ids = places.filter((p) => p.group === group).map((p) => p.id!);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    report(await saveLocalPlaceOrder(ids), "Order saved ✓");
    await reload();
  };

  const toggle = async (p: LocalPlace) => {
    report(await saveLocalPlace({ ...toInput(p), isActive: p.isActive === false }), p.isActive === false ? "Shown ✓" : "Hidden ✓");
    await reload();
  };

  const remove = async (p: LocalPlace) => {
    if (!window.confirm(`Delete ${p.name}? This can't be undone.`)) return;
    report(await deleteLocalPlace(p.id!), "Deleted ✓");
    await reload();
  };

  if (editing) {
    return (
      <PlaceForm
        initial={editing}
        groups={keys}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          setErr(null);
          setMsg("Saved ✓");
          await reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {(msg || err) && (
        <p className={`rounded-xl px-3 py-2 text-xs font-medium ${err ? "bg-red-50 text-red-700" : "bg-primary/10 text-primary"}`}>
          {err ?? msg}
        </p>
      )}
      <button
        onClick={() => setEditing(blank("food", places.filter((p) => p.group === "food").length))}
        className="press rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white"
      >
        + Add a place
      </button>

      {keys.map((g) => {
        const list = places.filter((p) => p.group === g);
        return (
          <section key={g} className="space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-foreground/60">
              {KNOWN_GROUPS[g]?.emoji ?? "📍"} {groupTitle(g)}
            </h2>
            {list.map((p, i) => (
              <div key={p.id} className={`rounded-2xl bg-card p-3 ring-1 ring-border ${p.isActive === false ? "opacity-60" : ""}`}>
                <div className="flex items-center gap-3">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaSrc(p.imageUrl)} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-background text-2xl">{p.emoji}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {p.name} {p.isActive === false && <span className="text-xs font-normal text-faint">(hidden)</span>}
                    </p>
                    <p className="truncate text-xs text-foreground/60">{p.phoneDisplay ?? "No phone"}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                  <button disabled={i === 0} onClick={() => move(g, p.id!, -1)} aria-label={`Move ${p.name} up`} className="press rounded-full bg-background px-3 py-1.5 ring-1 ring-border disabled:opacity-30">↑</button>
                  <button disabled={i === list.length - 1} onClick={() => move(g, p.id!, 1)} aria-label={`Move ${p.name} down`} className="press rounded-full bg-background px-3 py-1.5 ring-1 ring-border disabled:opacity-30">↓</button>
                  <button onClick={() => setEditing(toInput(p))} className="press rounded-full bg-background px-3 py-1.5 ring-1 ring-border">Edit</button>
                  <button onClick={() => toggle(p)} className="press rounded-full bg-background px-3 py-1.5 ring-1 ring-border">{p.isActive === false ? "Show" : "Hide"}</button>
                  <button onClick={() => remove(p)} className="press rounded-full bg-background px-3 py-1.5 text-red-700 ring-1 ring-border">Delete</button>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function PlaceForm({
  initial,
  groups,
  onCancel,
  onSaved,
}: {
  initial: LocalPlaceInput;
  groups: string[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [v, setV] = useState<LocalPlaceInput>(initial);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = !initial.id;
  const set = <K extends keyof LocalPlaceInput>(k: K, val: LocalPlaceInput[K]) => setV((p) => ({ ...p, [k]: val }));

  const text = (k: keyof LocalPlaceInput, label: string, placeholder = "", hint?: string) => (
    <label className="block">
      <span className="text-xs font-medium text-foreground/70">{label}</span>
      <input
        value={String(v[k] ?? "")}
        onChange={(e) => set(k, e.target.value as never)}
        placeholder={placeholder}
        className={FIELD}
      />
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      set("imageUrl", await uploadLocalPlaceImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const check = validateLocalPlace(v);
    if ("error" in check) {
      setError(check.error);
      return;
    }
    setSaving(true);
    const r = await saveLocalPlace(check.input);
    setSaving(false);
    if (r.error) setError(r.error);
    else await onSaved();
  };

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <h2 className="text-base font-bold">{isNew ? "Add a place" : `Edit ${initial.name}`}</h2>
      {text("name", "Name *", "Billy Bob's Sports Bar & Grill")}
      {text("category", "What it is", "Pizza & Sports Bar")}
      <label className="block">
        <span className="text-xs font-medium text-foreground/70">Section</span>
        <input
          list="lp-groups"
          value={v.group}
          onChange={(e) => set("group", e.target.value)}
          className={FIELD}
        />
        <datalist id="lp-groups">
          {Array.from(new Set(["golf", "food", "coffee", ...groups])).map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <span className="mt-1 block text-xs text-faint">golf, food and coffee are built in; any other word makes a new section.</span>
      </label>
      {text("locality", "Town", "Tomahawk, WI")}
      {text("address", "Street address (optional)", "123 Main St, Tomahawk, WI")}
      <label className="block">
        <span className="text-xs font-medium text-foreground/70">One-line description</span>
        <textarea value={v.blurb} onChange={(e) => set("blurb", e.target.value)} rows={2} className={FIELD} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {text("emoji", "Emoji", "🍕")}
        <label className="block">
          <span className="text-xs font-medium text-foreground/70">Color</span>
          <select value={v.accent} onChange={(e) => set("accent", e.target.value as PlaceAccent)} className={FIELD}>
            {ACCENTS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-medium text-foreground/70">Photo (optional)</span>
        {v.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaSrc(v.imageUrl)} alt="" className="h-32 w-full rounded-xl object-cover ring-1 ring-border" />
        )}
        <div className="flex items-center gap-3 text-xs">
          <input type="file" accept="image/*" disabled={uploading} onChange={(e) => upload(e.target.files?.[0])} />
          {uploading && <span className="text-faint">Uploading…</span>}
          {v.imageUrl && (
            <button type="button" onClick={() => set("imageUrl", "")} className="press font-semibold text-red-700">Remove photo</button>
          )}
        </div>
      </div>

      {text("phoneTel", "Phone", "(715) 453-3130", "Any format; saved as +1… for tap-to-call.")}
      {text("phoneDisplay", "Phone as shown", "", "Leave blank to format it automatically.")}
      {text("website", "Website", "https://…")}
      {text("menuUrl", "Menu link", "https://…")}
      {text("orderUrl", "Online ordering link", "https://…")}
      {text("bookingUrl", "Tee-time booking link", "https://…")}
      {text("bookingCta", "Booking button label", "Book Tee Time")}
      {text("ratesUrl", "Rates link", "https://…")}
      {text("ratesCta", "Rates button label", "See Rates")}
      {text("internalHref", "In-app link (advanced)", "/tee-times", "A page inside this app; becomes the main button.")}
      {text("internalCta", "In-app button label", "Book Tee Time")}
      {text("slug", "Short id", "auto from the name", "Leave blank to generate. Must be unique.")}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} />
        Show on the Local Places page
      </label>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        <button onClick={onCancel} className="press rounded-full px-4 py-2 text-sm font-semibold text-foreground/70">Cancel</button>
        <button onClick={save} disabled={saving || uploading} className="press rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
