"use client";

import type { ReactNode } from "react";
import { useSeason, type Season } from "@/lib/season";

// Seasonal dressing for the MLR logo, drawn as an SVG overlay that sits exactly
// on top of the logo image (viewBox = the logo's 1340×896 pixels, so every
// coordinate below is a spot on the artwork).
//
// Two modes share one drawing:
//   • animate — the splash: a short (~2.4s) intro that ends in the final state
//     (leaves fall and land, snow falls and settles, flowers grow, the sun rises).
//   • still   — the header: that final state as a snapshot, no motion.
// The base styles ARE the final state; animations only live under `.fx-anim`
// (app/globals.css), so reduce-motion (which kills animations) and the still
// header both naturally show the snapshot.

type Leaf = { x: number; y: number; r: number; c: string; s?: number };
const LEAVES: Leaf[] = [
  { x: 430, y: 478, r: -60, c: "#d9531e" },
  { x: 520, y: 500, r: -30, c: "#e8a317", s: 1.15 },
  { x: 660, y: 522, r: 10, c: "#b5341c" },
  { x: 760, y: 506, r: 20, c: "#c9771a", s: 1.1 },
  { x: 900, y: 476, r: 50, c: "#e8a317" },
  { x: 1010, y: 568, r: 75, c: "#d9531e", s: 1.15 },
  { x: 300, y: 590, r: -20, c: "#b5341c" },
  { x: 850, y: 622, r: 35, c: "#d9531e" },
  { x: 570, y: 410, r: 25, c: "#e8a317", s: 0.9 },
  { x: 1090, y: 330, r: -40, c: "#c9771a", s: 0.9 },
  { x: 250, y: 330, r: 55, c: "#d9531e", s: 0.9 },
];

const FLAKES: [number, number, number][] = [
  [300, 200, 11], [430, 120, 9], [560, 80, 12], [700, 150, 9], [830, 90, 11],
  [960, 180, 7], [1090, 250, 9], [220, 380, 7], [1160, 430, 8], [390, 320, 6],
  [1000, 360, 6], [140, 520, 8], [1250, 560, 7], [660, 60, 6],
];

const CAPS: [number, number, number][] = [
  [607, 232, 1.1], [547, 268, 1], [802, 248, 1.2], [500, 342, 0.9], [862, 330, 0.9], [607, 338, 1.3],
];

type Flower = { x: number; h: number; c: string };
const FLOWERS: Flower[] = [
  { x: 90, h: 120, c: "#ec6fa0" },
  { x: 190, h: 90, c: "#f6c445" },
  { x: 290, h: 60, c: "#a97bd8" },
  { x: 560, h: 34, c: "#ffffff" },
  { x: 790, h: 40, c: "#f6c445" },
  { x: 1050, h: 62, c: "#ec6fa0" },
  { x: 1150, h: 100, c: "#a97bd8" },
  { x: 1250, h: 140, c: "#f6c445" },
];

function Fall() {
  return (
    <>
      {LEAVES.map((l, i) => (
        <g key={i} transform={`translate(${l.x} ${l.y}) rotate(${l.r}) scale(${(l.s ?? 1) * 1.35})`}>
          <g
            className="fx-leaf"
            style={{ ["--dx" as string]: `${(i % 2 ? 1 : -1) * (60 + (i % 4) * 25)}px`, ["--d" as string]: `${(i * 0.06).toFixed(2)}s` }}
          >
            <path d="M0,-34 C24,-24 28,10 0,34 C-28,10 -24,-24 0,-34Z" fill={l.c} />
            <path d="M0,-30 L0,40" stroke="#00000033" strokeWidth="3" strokeLinecap="round" />
          </g>
        </g>
      ))}
    </>
  );
}

function Winter() {
  const stroke = "#a9c4da";
  return (
    <>
      <g className="fx-drift">
        <path
          d="M385,530 Q660,468 965,550 Q905,522 660,512 Q500,508 385,530Z"
          fill="#fff"
          stroke={stroke}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        {CAPS.map(([x, y, s], i) => (
          <path
            key={i}
            transform={`translate(${x} ${y}) scale(${s * 1.7})`}
            d="M-28,16 Q-12,-6 0,-18 Q12,-6 28,16 Q12,22 0,13 Q-12,22 -28,16Z"
            fill="#fff"
            stroke={stroke}
            strokeWidth="3"
            strokeLinejoin="round"
          />
        ))}
      </g>
      {FLAKES.map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <circle
            className="fx-flake"
            r={r * 1.3}
            fill="#fff"
            stroke={stroke}
            strokeWidth="3"
            style={{ ["--d" as string]: `${(i * 0.07).toFixed(2)}s`, ["--dx" as string]: `${(i % 2 ? 1 : -1) * 40}px` }}
          />
        </g>
      ))}
    </>
  );
}

function Spring() {
  return (
    <>
      {FLOWERS.map((f, i) => {
        const base = 884;
        const d = `${(i * 0.14).toFixed(2)}s`;
        return (
          <g key={i} transform={`translate(${f.x} ${base})`} style={{ ["--d" as string]: d }}>
            <path
              className="fx-stem"
              d={`M0,0 C${i % 2 ? 14 : -14},${-f.h * 0.4} ${i % 2 ? -10 : 10},${-f.h * 0.75} 0,${-f.h}`}
              fill="none"
              stroke="#3f8f4a"
              strokeWidth="7"
              strokeLinecap="round"
            />
            <ellipse
              className="fx-sprout"
              cx={i % 2 ? 16 : -16}
              cy={-f.h * 0.45}
              rx="16"
              ry="7"
              fill="#56a85f"
              transform={`rotate(${i % 2 ? -30 : 30} ${i % 2 ? 16 : -16} ${-f.h * 0.45})`}
            />
            <g transform={`translate(0 ${-f.h})`}>
              <g className="fx-bloom">
                {[0, 72, 144, 216, 288].map((a) => (
                  <ellipse key={a} cx="0" cy="-17" rx="10" ry="16" fill={f.c} stroke="#00000022" strokeWidth="1.5" transform={`rotate(${a})`} />
                ))}
                <circle r="8" fill={f.c === "#f6c445" ? "#d9822b" : "#f6c445"} />
              </g>
            </g>
          </g>
        );
      })}
    </>
  );
}

function Summer() {
  const rays = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <g transform="translate(1180 150)">
      <g className="fx-sun">
        <circle className="fx-glow" r="92" fill="#ffd34d" opacity="0.28" />
        {rays.map((a) => (
          <line key={a} x1="0" y1="-76" x2="0" y2="-98" stroke="#f6a81a" strokeWidth="9" strokeLinecap="round" transform={`rotate(${a})`} />
        ))}
        <circle r="58" fill="#ffc933" stroke="#f6a81a" strokeWidth="5" />
      </g>
    </g>
  );
}

const ART: Record<Season, () => ReactNode> = {
  fall: Fall,
  winter: Winter,
  spring: Spring,
  summer: Summer,
};

/**
 * Absolutely fills its (relative) parent, which must be exactly the logo's box.
 * Renders nothing until the season is known (client-side, after mount).
 */
export function SeasonalLogoFX({ animate }: { animate: boolean }) {
  const season = useSeason();
  if (!season) return null;
  const Art = ART[season];
  return (
    <svg
      aria-hidden
      viewBox="0 0 1340 896"
      className={`pointer-events-none absolute inset-0 h-full w-full overflow-visible ${animate ? "fx-anim" : ""}`}
      data-season={season}
    >
      <Art />
    </svg>
  );
}
