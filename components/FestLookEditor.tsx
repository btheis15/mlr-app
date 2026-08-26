"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSaveStatus } from "@/lib/hooks";
import { saveFestCover, saveFestLook } from "@/lib/festContent";
import { uploadSiteImage } from "@/lib/appImages";
import { mediaSrc } from "@/lib/mediaToken";
import {
  FEST_LOOK_DEFAULTS,
  FEST_PRESETS,
  contrastWarnings,
  festThemeStyle,
  hasCustomLook,
  hexOrNull,
  type FestBgImageMode,
  type FestBgStyle,
  type FestFont,
  type FestTheme,
} from "@/lib/festTheme";
import type { FestConfigContent } from "@/lib/types";

/**
 * **Look** — the Planner section where a fest year's cover photo, palette,
 * background and display font are set (migration 0219).
 *
 * The Family Fest section's parchment/heraldry appearance was CSS, which meant
 * the answer to "can we make next year look like a county fair?" was "someone
 * has to ship a build". This is that, in the app, for the people who actually
 * run the fest — an admin or a Family Fest committee member.
 *
 * Three things make a colour editor safe to hand to a volunteer:
 *
 *  - **Presets first.** A one-tap complete palette is the path most people
 *    should take; six colour wells with no starting point is a way to make
 *    something ugly, not a feature. The individual pickers are for tuning after.
 *  - **A live preview of the real components** — the same card / button / body
 *    text the section is built from, wrapped in the draft look via the same
 *    `festThemeStyle()` the app renders with. Not a colour-swatch row, which
 *    tells you nothing about whether the text is readable on the card.
 *  - **Contrast warnings, not contrast limits.** The family picks the look; the
 *    editor just says when a pair can't be read. The editor's own screen at full
 *    brightness is the best case, so "it looked fine to me" is exactly how an
 *    unreadable year ships.
 *
 * ⚠️ Unset stays UNSET. "Use the built-in look" writes nulls rather than the
 * current default hexes — that's what keeps globals.css the single source of
 * truth for the default and leaves unstyled years on the Display-P3 upgrade.
 * That's also why every colour row has its own "use default" control instead of
 * `<input type="color">` alone, which has no empty state to express it.
 */
export function FestLookEditor({
  config,
  onChanged,
}: {
  config: FestConfigContent;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-4">
      <CoverEditor config={config} onChanged={onChanged} />
      <ThemeEditor config={config} onChanged={onChanged} />
    </div>
  );
}

// ── Cover photo ───────────────────────────────────────────────────────────────

function CoverEditor({
  config,
  onChanged,
}: {
  config: FestConfigContent;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadSiteImage(file, `fest-cover/${config.year}`);
      const { error: saveErr } = await saveFestCover(url);
      if (saveErr) throw new Error(saveErr);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await saveFestCover(null);
    if (err) setError(err);
    else onChanged();
    setBusy(false);
  };

  return (
    <div className="space-y-3 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div>
        <p className="text-sm font-semibold">Cover photo</p>
        <p className="mt-0.5 text-xs text-foreground/55">
          The banner across the top of the Family Fest page. This one belongs to{" "}
          {config.name} — putting up a new one next year won&rsquo;t change what{" "}
          {config.year}&rsquo;s archive shows.
        </p>
      </div>
      {config.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mediaSrc(config.coverUrl)}
          alt="This year's cover"
          className="max-h-48 w-full rounded-xl object-cover"
        />
      ) : (
        <p className="rounded-xl bg-primary/5 px-3 py-6 text-center text-xs text-foreground/55">
          No cover set for {config.year} yet — the page is showing the built-in art.
        </p>
      )}
      <input ref={inputRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="press rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Uploading…" : config.coverUrl ? "Replace photo" : "Add cover photo"}
        </button>
        {config.coverUrl && (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="press rounded-xl bg-card px-3 py-2 text-sm font-semibold text-accent ring-1 ring-border disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs font-medium text-accent ring-1 ring-accent/20">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Palette / background / font ───────────────────────────────────────────────

const COLOR_ROWS: { key: keyof typeof FEST_LOOK_DEFAULTS; label: string; note: string }[] = [
  { key: "primary", label: "Main colour", note: "Headings, buttons and links." },
  { key: "accent", label: "Accent", note: "Warnings and secondary highlights." },
  { key: "background", label: "Page background", note: "Behind everything in this section." },
  { key: "card", label: "Cards", note: "The surface every box sits on." },
  { key: "border", label: "Hairlines", note: "The thin outline around cards." },
  { key: "ink", label: "Text", note: "Body copy." },
];

const BG_STYLES: { key: FestBgStyle; label: string; note: string }[] = [
  { key: "default", label: "Soft wash", note: "A subtle gradient in the background colour." },
  { key: "flat", label: "Flat colour", note: "Just the background colour, no gradient." },
  { key: "image", label: "Photo or pattern", note: "Your own image behind the page." },
];

const FONTS: { key: FestFont; label: string; note: string }[] = [
  { key: "cinzel", label: "Cinzel", note: "Roman inscription serif — the 2026 look." },
  { key: "playfair", label: "Playfair", note: "High-contrast classic serif." },
  { key: "sans", label: "App default", note: "Matches the rest of the resort app." },
];

function ThemeEditor({
  config,
  onChanged,
}: {
  config: FestConfigContent;
  onChanged: () => void;
}) {
  const save = useSaveStatus();
  const [draft, setDraft] = useState<FestTheme>(config.look);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  // Keep the form in sync if the live config arrives after first paint (or
  // Realtime brings in another editor's save).
  useEffect(() => {
    setDraft(config.look);
  }, [config.look]);

  const set = <K extends keyof FestTheme>(key: K, value: FestTheme[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const bgStyle: FestBgStyle = draft.bgStyle ?? "default";
  const warnings = useMemo(() => contrastWarnings(draft), [draft]);
  const previewStyle = useMemo(() => festThemeStyle(draft), [draft]);

  const submit = () =>
    save.run(async () => {
      const { error } = await saveFestLook(draft);
      if (error) return error;
      onChanged();
      return "Saved.";
    });

  const resetAll = () =>
    save.run(async () => {
      const cleared: FestTheme = {};
      const { error } = await saveFestLook(cleared);
      if (error) return error;
      setDraft(cleared);
      onChanged();
      return "Back to the built-in look.";
    });

  const onPickBackdrop = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setUploadError(null);
    try {
      const url = await uploadSiteImage(file, `fest-backdrop/${config.year}`);
      // Choosing a backdrop implies wanting it shown — flipping the style too
      // saves the "I uploaded it and nothing happened" step.
      setDraft((d) => ({ ...d, bgImageUrl: url, bgStyle: "image" }));
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl bg-card p-4 ring-1 ring-border">
      <div>
        <p className="text-sm font-semibold">Theme colours &amp; background</p>
        <p className="mt-0.5 text-xs text-foreground/55">
          Restyles the whole Family Fest section for {config.name}. Past years keep the look they
          had, so changing this can&rsquo;t repaint the archive.
        </p>
        {!hasCustomLook(draft) && (
          <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-xs text-foreground/60">
            Using the built-in parchment look. Pick a starting point below, or change any single
            colour.
          </p>
        )}
      </div>

      {/* Presets */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
          Start from
        </p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {FEST_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setDraft({ ...p.theme })}
              title={p.blurb}
              className="press shrink-0 rounded-xl px-3 py-2 text-left ring-1 ring-border"
              style={{ backgroundColor: p.theme.card ?? FEST_LOOK_DEFAULTS.card }}
            >
              <span className="flex items-center gap-1.5">
                {(["primary", "accent", "background"] as const).map((k) => (
                  <span
                    key={k}
                    aria-hidden
                    className="h-3 w-3 rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: p.theme[k] ?? FEST_LOOK_DEFAULTS[k] }}
                  />
                ))}
              </span>
              <span
                className="mt-1 block text-xs font-semibold"
                style={{ color: p.theme.ink ?? FEST_LOOK_DEFAULTS.ink }}
              >
                {p.name}
              </span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint">
          A preset only fills the fields in — nothing changes for the family until you save.
        </p>
      </div>

      {/* Colours */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
          Colours
        </p>
        {COLOR_ROWS.map((row) => (
          <ColorRow
            key={row.key}
            label={row.label}
            note={row.note}
            value={hexOrNull(draft[row.key])}
            fallback={FEST_LOOK_DEFAULTS[row.key]}
            onChange={(v) => set(row.key, v)}
          />
        ))}
      </div>

      {/* Background */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
          Background
        </p>
        <div className="grid grid-cols-3 gap-2">
          {BG_STYLES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => set("bgStyle", s.key)}
              className={`press rounded-xl px-2 py-2 text-xs font-semibold ring-1 ${
                bgStyle === s.key
                  ? "bg-primary text-white ring-primary"
                  : "bg-primary/5 text-primary ring-border"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint">
          {BG_STYLES.find((s) => s.key === bgStyle)?.note}
        </p>

        {bgStyle === "image" && (
          <div className="space-y-2 rounded-xl bg-primary/5 p-3">
            {draft.bgImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaSrc(draft.bgImageUrl)}
                alt="Background"
                className="max-h-32 w-full rounded-lg object-cover"
              />
            ) : (
              <p className="py-3 text-center text-xs text-foreground/55">
                No background image yet.
              </p>
            )}
            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              onChange={onPickBackdrop}
              className="hidden"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => bgInputRef.current?.click()}
                disabled={busy}
                className="press rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Uploading…" : draft.bgImageUrl ? "Replace image" : "Upload image"}
              </button>
              {draft.bgImageUrl && (
                <button
                  type="button"
                  onClick={() => set("bgImageUrl", null)}
                  className="press rounded-lg bg-card px-3 py-1.5 text-xs font-semibold text-accent ring-1 ring-border"
                >
                  Remove image
                </button>
              )}
            </div>
            {uploadError && (
              <p className="rounded-lg bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent">
                {uploadError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { key: "cover", label: "One big photo" },
                  { key: "tile", label: "Repeating pattern" },
                ] as { key: FestBgImageMode; label: string }[]
              ).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => set("bgImageMode", m.key)}
                  className={`press rounded-lg px-2 py-1.5 text-[11px] font-semibold ring-1 ${
                    (draft.bgImageMode ?? "cover") === m.key
                      ? "bg-primary text-white ring-primary"
                      : "bg-card text-primary ring-border"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-[11px] font-semibold text-foreground/60">
                How strongly it shows through — {draft.bgImageOpacity ?? 35}%
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={draft.bgImageOpacity ?? 35}
                onChange={(e) => set("bgImageOpacity", Number(e.target.value))}
                className="mt-1 w-full accent-[var(--color-primary)]"
              />
              {/* The image always sits under a wash of the background colour.
                  Full strength is offered, but it's the setting that makes body
                  text unreadable, so say so rather than silently capping it. */}
              <span className="text-[11px] text-faint">
                Higher is bolder. Past about 60% the text on top gets hard to read.
              </span>
            </label>
          </div>
        )}
      </div>

      {/* Font */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
          Heading font
        </p>
        <div className="grid grid-cols-3 gap-2">
          {FONTS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => set("font", f.key)}
              className={`press rounded-xl px-2 py-2 text-xs font-semibold ring-1 ${
                (draft.font ?? "cinzel") === f.key
                  ? "bg-primary text-white ring-primary"
                  : "bg-primary/5 text-primary ring-border"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-faint">
          {FONTS.find((f) => f.key === (draft.font ?? "cinzel"))?.note}
        </p>
      </div>

      {/* Live preview — the real components, in the draft look. */}
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
          Preview
        </p>
        <div
          style={previewStyle}
          className="overflow-hidden rounded-2xl ring-1 ring-border"
        >
          <div
            className="space-y-2 p-4"
            style={{
              backgroundColor: "var(--color-background)",
              backgroundImage: "var(--ff-ambient-image)",
              backgroundSize: "var(--ff-ambient-size)",
              backgroundRepeat: "var(--ff-ambient-repeat)",
              backgroundPosition: "var(--ff-ambient-position)",
              color: "var(--color-foreground)",
            }}
          >
            <p className="font-display text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
              ⚜ {config.theme || "Your theme"} ⚜
            </p>
            <div className="rounded-xl bg-card p-3 ring-1 ring-border">
              <p className="text-sm font-bold">{config.name}</p>
              <p className="mt-0.5 text-xs" style={{ opacity: 0.7 }}>
                Body text on a card — this is most of the section.
              </p>
              <div className="mt-2 flex gap-2">
                <span className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-white">
                  Going
                </span>
                <span className="rounded-lg bg-card px-2.5 py-1 text-[11px] font-semibold text-accent ring-1 ring-border">
                  Can&rsquo;t make
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1 rounded-xl bg-accent/10 p-3 ring-1 ring-accent/20">
          <p className="text-xs font-semibold text-accent">Hard to read</p>
          {warnings.map((w) => (
            <p key={w} className="text-[11px] text-accent">
              • {w}
            </p>
          ))}
          <p className="text-[11px] text-accent/80">
            You can save anyway — this is just a heads-up.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {save.status && <p className="text-center text-xs text-foreground/60">{save.status}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={save.pending}
            className="press flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {save.pending ? "Saving…" : "Save look"}
          </button>
          <button
            type="button"
            onClick={resetAll}
            disabled={save.pending || !hasCustomLook(config.look)}
            className="press rounded-xl bg-card px-3 py-2.5 text-sm font-semibold text-accent ring-1 ring-border disabled:opacity-40"
          >
            Use built-in
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One colour: a native picker plus an explicit "default" state.
 *
 * `<input type="color">` can't be empty, so it always shows SOMETHING — and if
 * that were the whole control, opening this screen and touching nothing would
 * still look like six deliberate choices. The checkbox is what keeps "unset"
 * expressible, which is the difference between a year that uses the built-in
 * look and one that has hardcoded today's built-in hexes into its own row.
 */
function ColorRow({
  label,
  note,
  value,
  fallback,
  onChange,
}: {
  label: string;
  note: string;
  value: string | null;
  fallback: string;
  onChange: (v: string | null) => void;
}) {
  const shown = value ?? fallback;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-primary/5 px-3 py-2">
      <input
        type="color"
        value={shown}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{label}</p>
        <p className="text-[11px] text-foreground/55">{note}</p>
      </div>
      <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-foreground/60">
        <input
          type="checkbox"
          checked={value == null}
          onChange={(e) => onChange(e.target.checked ? null : fallback)}
          className="h-3.5 w-3.5 accent-[var(--color-primary)]"
        />
        Default
      </label>
    </div>
  );
}
