"use client";

import { useEffect, useState } from "react";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Birthday as three independent scroll dropdowns (Month / Day / Year) — the same
 * on iPhone, iPad, Android, and desktop, instead of the native date input's
 * calendar (which makes you poke a day before month/year are reachable). Emits
 * "YYYY-MM-DD" once all three are chosen, "" while incomplete.
 */
export function BirthdayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const init = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  const [month, setMonth] = useState(init ? init[2] : "");
  const [day, setDay] = useState(init ? init[3] : "");
  const [year, setYear] = useState(init ? init[1] : "");

  const thisYear = new Date().getFullYear();
  const years: string[] = [];
  for (let y = thisYear; y >= thisYear - 110; y--) years.push(String(y));
  const daysInMonth = month ? new Date(year ? Number(year) : 2024, Number(month), 0).getDate() : 31;

  // If month/year change under a too-large day (e.g. 31 → Feb), drop the day.
  useEffect(() => {
    if (day && Number(day) > daysInMonth) setDay("");
  }, [daysInMonth, day]);

  // Emit the combined value (or "" while incomplete) when any part changes.
  useEffect(() => {
    onChange(month && day && year ? `${year}-${month}-${day}` : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, day, year]);

  const sel = "rounded-xl bg-background px-2 py-2 text-sm ring-1 ring-border outline-none focus:ring-2 focus:ring-primary";
  return (
    <div className="mt-1 grid grid-cols-3 gap-2">
      <select aria-label="Birth month" value={month} onChange={(e) => setMonth(e.target.value)} className={sel}>
        <option value="">Month</option>
        {MONTHS.map((nm, i) => <option key={nm} value={pad(i + 1)}>{nm}</option>)}
      </select>
      <select aria-label="Birth day" value={day} onChange={(e) => setDay(e.target.value)} className={sel}>
        <option value="">Day</option>
        {Array.from({ length: daysInMonth }, (_, i) => <option key={i} value={pad(i + 1)}>{i + 1}</option>)}
      </select>
      <select aria-label="Birth year" value={year} onChange={(e) => setYear(e.target.value)} className={sel}>
        <option value="">Year</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </div>
  );
}
