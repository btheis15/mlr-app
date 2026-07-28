"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * A QR code for a member's Venmo pay link, generated on-device (the `qrcode`
 * package — no third-party QR API, so the handle/link never leaves the
 * browser). It encodes the exact same `venmo.com/<handle>?txn=pay` URL as the
 * Venmo button above it, so scanning is equivalent to tapping — not a
 * separate, opaque code. QR codes have built-in error correction (Reed–
 * Solomon), which is why a printed/worn/warped one still scans; that's a
 * property of the QR standard itself, not something Venmo does specially.
 *
 * The recipient's name is shown large, above and below the code, so it's
 * unambiguous who a scan will pay — this only ever renders directly under
 * that person's own Venmo row.
 */
export function PayQRCode({ value, name, handle }: { value: string; name: string; handle: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: 220, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setDataUrl(null);
      });
    return () => {
      active = false;
    };
  }, [value]);

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl bg-card p-4 ring-1 ring-border">
      <p className="text-center text-sm font-semibold">
        Scan to pay <span className="text-primary">{name}</span> on Venmo
      </p>
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={`Venmo QR code for ${name}, @${handle}`}
          className="h-44 w-44 rounded-lg bg-white p-2 ring-1 ring-border"
        />
      ) : (
        <div className="h-44 w-44 animate-pulse rounded-lg bg-background" aria-hidden />
      )}
      <p className="text-xs font-medium text-muted">@{handle}</p>
      <p className="text-center text-[11px] text-faint">
        Opens Venmo to pay <span className="font-medium text-foreground/70">{name}</span> — Venmo will show their
        name again before you send, so double-check it matches.
      </p>
    </div>
  );
}
