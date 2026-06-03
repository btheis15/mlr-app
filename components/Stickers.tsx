// The built-in MLR sticker pack. These are inline vector art (not files), so
// they render crisp at any size, work offline, and don't care about the hosting
// origin or GitHub-Pages basePath. A chat sticker is stored as media_type
// 'sticker' with storage_path = the sticker id; <StickerArt> draws it from here.
//
// To add a sticker: add an entry to STICKERS and a case to <StickerArt>.

export interface Sticker {
  id: string;
  label: string;
}

export const STICKERS: Sticker[] = [
  { id: "up-north", label: "Up North" },
  { id: "gone-fishin", label: "Gone Fishin'" },
  { id: "smores", label: "S'mores" },
  { id: "lake-day", label: "Lake Day" },
  { id: "paddle", label: "Paddle" },
  { id: "loon-life", label: "Loon Life" },
];

export const isSticker = (id: string) => STICKERS.some((s) => s.id === id);

const label = (text: string, fill = "#ffffff") => (
  <text
    x="100"
    y="182"
    textAnchor="middle"
    fontFamily="system-ui, -apple-system, Arial, sans-serif"
    fontWeight="800"
    fontSize="20"
    letterSpacing="0.5"
    fill={fill}
  >
    {text}
  </text>
);

export function StickerArt({ id, size = 120, className = "" }: { id: string; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 200 200", className } as const;
  switch (id) {
    case "up-north":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Up North">
          <rect width="200" height="200" rx="36" fill="#14532d" />
          <circle cx="150" cy="50" r="15" fill="#fde68a" />
          <g fill="#dcfce7">
            <polygon points="78,34 110,86 46,86" />
            <polygon points="78,62 120,116 36,116" />
            <polygon points="78,92 130,146 26,146" />
          </g>
          <rect x="70" y="144" width="16" height="16" rx="3" fill="#7c4a1e" />
          {label("UP NORTH")}
        </svg>
      );
    case "gone-fishin":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Gone Fishin'">
          <rect width="200" height="200" rx="36" fill="#0369a1" />
          <g opacity="0.35" stroke="#bae6fd" strokeWidth="4" strokeLinecap="round">
            <line x1="28" y1="60" x2="60" y2="60" />
            <line x1="150" y1="46" x2="178" y2="46" />
          </g>
          <ellipse cx="92" cy="96" rx="46" ry="30" fill="#fcd34d" />
          <polygon points="138,96 176,72 176,120" fill="#fbbf24" />
          <circle cx="70" cy="88" r="6" fill="#1e293b" />
          <path d="M58 110 q34 22 68 0" fill="none" stroke="#b45309" strokeWidth="4" strokeLinecap="round" />
          {label("GONE FISHIN'")}
        </svg>
      );
    case "smores":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="S'mores">
          <rect width="200" height="200" rx="36" fill="#1e293b" />
          <g stroke="#92400e" strokeWidth="10" strokeLinecap="round">
            <line x1="58" y1="150" x2="142" y2="120" />
            <line x1="58" y1="120" x2="142" y2="150" />
          </g>
          <path d="M100 40 C124 70 120 92 100 120 C80 92 76 70 100 40 Z" fill="#f97316" />
          <path d="M100 64 C114 84 112 98 100 116 C88 98 86 84 100 64 Z" fill="#fde047" />
          {label("S'MORES")}
        </svg>
      );
    case "lake-day":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Lake Day">
          <rect width="200" height="200" rx="36" fill="#fdba74" />
          <rect y="120" width="200" height="80" rx="0" fill="#0ea5e9" />
          <rect y="120" width="200" height="80" fill="#0ea5e9" />
          <circle cx="100" cy="86" r="34" fill="#fb7185" />
          <g opacity="0.5" stroke="#e0f2fe" strokeWidth="4" strokeLinecap="round">
            <line x1="30" y1="150" x2="80" y2="150" />
            <line x1="110" y1="168" x2="170" y2="168" />
          </g>
          {label("LAKE DAY")}
        </svg>
      );
    case "paddle":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Paddle">
          <rect width="200" height="200" rx="36" fill="#0e7490" />
          <path d="M36 96 Q100 156 164 96 Q100 116 36 96 Z" fill="#b45309" />
          <path d="M36 96 Q100 150 164 96" fill="none" stroke="#fcd34d" strokeWidth="4" />
          <line x1="150" y1="40" x2="118" y2="104" stroke="#fde68a" strokeWidth="7" strokeLinecap="round" />
          <ellipse cx="150" cy="40" rx="12" ry="16" fill="#fde68a" transform="rotate(28 150 40)" />
          {label("PADDLE")}
        </svg>
      );
    case "loon-life":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Loon Life">
          <rect width="200" height="200" rx="36" fill="#115e59" />
          <ellipse cx="104" cy="118" rx="54" ry="28" fill="#0f172a" />
          <path d="M150 116 C150 86 132 70 112 70 C120 84 126 96 128 112 Z" fill="#0f172a" />
          <circle cx="120" cy="80" r="5" fill="#ef4444" />
          <g fill="#e2e8f0">
            <circle cx="92" cy="112" r="3" />
            <circle cx="104" cy="120" r="3" />
            <circle cx="80" cy="120" r="3" />
            <circle cx="116" cy="114" r="3" />
          </g>
          {label("LOON LIFE")}
        </svg>
      );
    default:
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sticker">
          <rect width="200" height="200" rx="36" fill="#e2e8f0" />
          <text x="100" y="115" textAnchor="middle" fontSize="64">🌲</text>
        </svg>
      );
  }
}
