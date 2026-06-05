"use client";

import { useState } from "react";

// Structured address entry with a "check on map" step. The member picks a country
// (defaults to United States), fills the country-appropriate fields, then geocodes
// via free OpenStreetMap Nominatim (structured query → more reliable than free-text)
// and confirms the pin before saving the one-line address into profiles.address
// (what the member card shows + uses for directions). No API key, no extra column.

type Country = "US" | "MX";
interface Parts { country: Country; street: string; apt: string; colonia: string; city: string; state: string; zip: string }
const EMPTY: Parts = { country: "US", street: "", apt: "", colonia: "", city: "", state: "", zip: "" };
// The mini proxies geocoding (US Census for US, OpenStreetMap otherwise).
const MEDIA = (process.env.NEXT_PUBLIC_MEDIA_URL || "https://brians-mac-mini.tail49943c.ts.net").replace(/\/+$/, "");

// Best-effort parse of the one-line format we emit, so re-opening pre-fills fields.
function parse(addr: string): Parts {
  const p: Parts = { ...EMPTY };
  let segs = (addr || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!segs.length) return p;
  const last = (segs[segs.length - 1] || "").toLowerCase();
  if (last === "mexico" || last === "méxico") { p.country = "MX"; segs = segs.slice(0, -1); }
  else if (last === "united states" || last === "usa") { p.country = "US"; segs = segs.slice(0, -1); }

  if (p.country === "MX") {
    p.street = segs[0] || "";
    let i = 1;
    if (segs[i] && /^col\.?\s+/i.test(segs[i])) { p.colonia = segs[i].replace(/^col\.?\s+/i, ""); i++; }
    if (segs[i] !== undefined) {
      const mz = /^(\d{4,5})\s+(.*)$/.exec(segs[i]);
      if (mz) { p.zip = mz[1]; p.city = mz[2]; } else { p.city = segs[i]; }
      i++;
    }
    if (segs[i] !== undefined) p.state = segs[i];
  } else {
    const tail = segs[segs.length - 1] || "";
    const mz = /^(.*?)\s+(\d{5}(?:-\d{4})?)$/.exec(tail); // "ST 12345"
    if (mz) { p.state = mz[1].trim(); p.zip = mz[2]; segs = segs.slice(0, -1); }
    if (segs.length >= 3) { p.street = segs[0]; p.apt = segs[1]; p.city = segs.slice(2).join(", "); }
    else if (segs.length === 2) { p.street = segs[0]; p.city = segs[1]; }
    else if (segs.length === 1) { p.street = segs[0]; }
  }
  return p;
}

function format(p: Parts): string {
  if (p.country === "MX") {
    const zipCity = [p.zip.trim(), p.city.trim()].filter(Boolean).join(" ");
    return [p.street.trim(), p.colonia.trim() ? `Col. ${p.colonia.trim()}` : "", zipCity, p.state.trim(), "Mexico"]
      .filter(Boolean).join(", ");
  }
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
  const setCountry = (c: Country) => { setP((q) => ({ ...q, country: c })); setFound(null); setErr(null); };
  const formatted = format(p);

  const check = async () => {
    if (!formatted) return;
    setChecking(true); setErr(null); setFound(null);
    try {
      const r = await fetch(`${MEDIA}/geocode?country=${p.country}&q=${encodeURIComponent(format(p))}`);
      const d = await r.json();
      if (d && d.found) setFound({ label: String(d.label), lat: String(d.lat), lon: String(d.lon) });
      else setErr("Couldn't pinpoint it on the map — double-check the fields, or save anyway. Your card's directions link will still work.");
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
  const mx = p.country === "MX";

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 px-4 pb-6 sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[88dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-3xl bg-background p-5 ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label="Close" className="press absolute right-4 top-4 text-foreground/40 hover:text-foreground">✕</button>
        <h2 className="text-lg font-bold">Your address</h2>

        <label className="block">
          <span className="text-xs font-medium text-foreground/70">Country</span>
          <select
            value={p.country}
            onChange={(e) => setCountry(e.target.value as Country)}
            className="mt-1 w-full rounded-xl bg-background px-3 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="US">United States</option>
            <option value="MX">Mexico</option>
          </select>
        </label>

        {mx ? (
          <>
            <AddrField label="Street & number" ph="Calle Falsa 123" value={p.street} onChange={(v) => set("street", v)} />
            <AddrField label="Colonia (neighborhood)" ph="Centro" value={p.colonia} onChange={(v) => set("colonia", v)} />
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <AddrField label="City / municipio" ph="Mérida" value={p.city} onChange={(v) => set("city", v)} />
              <AddrField label="State" ph="Yuc." value={p.state} onChange={(v) => set("state", v)} />
            </div>
            <AddrField label="Postal code" ph="97000" value={p.zip} onChange={(v) => set("zip", v)} />
          </>
        ) : (
          <>
            <AddrField label="Street address" ph="123 Lake Rd" value={p.street} onChange={(v) => set("street", v)} />
            <AddrField label="Apt / unit" ph="Apt 2" opt value={p.apt} onChange={(v) => set("apt", v)} />
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <AddrField label="City" ph="Lake Villa" value={p.city} onChange={(v) => set("city", v)} />
              <AddrField label="State" ph="IL" value={p.state} onChange={(v) => set("state", v)} />
            </div>
            <AddrField label="ZIP" ph="60046" value={p.zip} onChange={(v) => set("zip", v)} />
          </>
        )}

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
