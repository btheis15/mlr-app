"use client";

import { useState } from "react";

// Structured address entry with a "check on map" step: the member fills street /
// apt / city / state / ZIP, then geocodes it (free OpenStreetMap Nominatim, no API
// key) and confirms the pin looks right before saving — like Robinhood's address
// verify. We store the formatted one-line string in profiles.address (what the
// member card shows + uses for directions); no extra column needed.

interface Parts { street: string; apt: string; city: string; state: string; zip: string }

// Best-effort parse of the one-line format we emit ("street, apt, city, ST ZIP").
function parse(addr: string): Parts {
  const empty: Parts = { street: "", apt: "", city: "", state: "", zip: "" };
  const segs = (addr || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return empty;
  const last = segs[segs.length - 1];
  const mz = /^(.*?)\s+(\d{5}(?:-\d{4})?)$/.exec(last); // "ST 12345"
  const state = mz ? mz[1].trim() : "";
  const zip = mz ? mz[2] : "";
  const head = mz ? segs.slice(0, -1) : segs;
  const p: Parts = { ...empty, state, zip };
  if (head.length >= 3) { p.street = head[0]; p.apt = head[1]; p.city = head.slice(2).join(", "); }
  else if (head.length === 2) { p.street = head[0]; p.city = head[1]; }
  else if (head.length === 1) { p.street = head[0]; }
  return p;
}

function format(p: Parts): string {
  const cityLine = [p.city.trim(), [p.state.trim(), p.zip.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [p.street.trim(), p.apt.trim(), cityLine].filter(Boolean).join(", ");
}

// Module-scope (stable identity) so typing doesn't remount the input and drop focus.
function AddrField({ label, ph, value, onChange, opt }: { label: string; ph: string; value: string; onChange: (v: string) => void; opt?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground/70">{label}{opt ? " (optional)" : ""}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={ph}
        className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
      />
    </label>
  );
}

export function AddressEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press flex w-full items-center justify-between gap-2 rounded-xl bg-background px-3 py-2 text-left text-sm ring-1 ring-border"
      >
        <span className={value ? "" : "text-foreground/40"}>{value || "Add your address…"}</span>
        <span className="shrink-0 text-xs text-primary">{value ? "Edit" : "Add"}</span>
      </button>
      {open && (
        <AddressModal
          initial={value}
          onClose={() => setOpen(false)}
          onClear={() => { onChange(""); setOpen(false); }}
          onSave={(v) => { onChange(v); setOpen(false); }}
        />
      )}
    </>
  );
}

function AddressModal({ initial, onClose, onClear, onSave }: { initial: string; onClose: () => void; onClear: () => void; onSave: (v: string) => void }) {
  const [p, setP] = useState<Parts>(() => parse(initial));
  const [checking, setChecking] = useState(false);
  const [found, setFound] = useState<{ label: string; lat: string; lon: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof Parts, val: string) => { setP((q) => ({ ...q, [k]: val })); setFound(null); setErr(null); };
  const formatted = format(p);

  const check = async () => {
    if (!formatted) return;
    setChecking(true); setErr(null); setFound(null);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(formatted)}`, { headers: { Accept: "application/json" } });
      const data = await r.json();
      if (Array.isArray(data) && data[0]) setFound({ label: data[0].display_name, lat: String(data[0].lat), lon: String(data[0].lon) });
      else setErr("Couldn't find that on the map — double-check it, or save it anyway.");
    } catch {
      setErr("Map lookup failed (connection?). You can still save it.");
    } finally {
      setChecking(false);
    }
  };

  const bbox = found ? (() => {
    const la = parseFloat(found.lat), lo = parseFloat(found.lon), d = 0.004;
    return `${lo - d},${la - d},${lo + d},${la + d}`;
  })() : "";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[88dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-3xl bg-background p-5 ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label="Close" className="press absolute right-4 top-4 text-foreground/40 hover:text-foreground">✕</button>
        <h2 className="text-lg font-bold">Your address</h2>

        <AddrField label="Street address" ph="123 Lake Rd" value={p.street} onChange={(val) => set("street", val)} />
        <AddrField label="Apt / unit" ph="Apt 2" opt value={p.apt} onChange={(val) => set("apt", val)} />
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <AddrField label="City" ph="Minocqua" value={p.city} onChange={(val) => set("city", val)} />
          <AddrField label="State" ph="WI" value={p.state} onChange={(val) => set("state", val)} />
        </div>
        <AddrField label="ZIP" ph="54548" value={p.zip} onChange={(val) => set("zip", val)} />

        <button
          type="button"
          onClick={check}
          disabled={!formatted || checking}
          className="press w-full rounded-xl bg-card py-2.5 text-sm font-semibold text-foreground ring-1 ring-border disabled:opacity-50"
        >
          {checking ? "Checking…" : "📍 Check on map"}
        </button>
        {err && <p className="text-xs text-accent">{err}</p>}
        {found && (
          <div className="space-y-1.5">
            <p className="text-xs text-foreground/60">Found: <span className="text-foreground/80">{found.label}</span></p>
            <iframe
              title="Address location"
              loading="lazy"
              className="h-44 w-full rounded-xl ring-1 ring-border"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${found.lat},${found.lon}`}
            />
            <p className="text-[11px] text-foreground/45">Does the pin look right? If so, save it.</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          {initial ? (
            <button type="button" onClick={onClear} className="press text-xs font-medium text-accent">Remove address</button>
          ) : <span />}
          <button
            type="button"
            onClick={() => onSave(formatted)}
            disabled={!formatted}
            className="press rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Use this address
          </button>
        </div>
      </div>
    </div>
  );
}
