import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";

// Value format: "yyyy-MM-dd" (local date), same as <input type="date">

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]; // week starts on Monday

const pad = (n: number) => n.toString().padStart(2, "0");
const toValue = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseValue(v: string): Date | null {
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function ordinal(n: number) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
// "November 11th, 2026"
function formatLongDate(d: Date) {
  return `${MONTHS[d.getMonth()]} ${ordinal(d.getDate())}, ${d.getFullYear()}`;
}

export default function DatePicker({
  value, onChange, label,
}: { value: string; onChange: (v: string) => void; label: string }) {
  const selected = parseValue(value);
  const [open, setOpen] = useState(false);
  // Always opens above the field. position: fixed so the scrolling panel can't clip it.
  const [pos, setPos] = useState<{ left: number; bottom: number }>({ left: 0, bottom: 0 });
  // month shown in the calendar, and the day that has keyboard focus
  const [view, setView] = useState(() => selected ?? new Date());
  const [focusDay, setFocusDay] = useState(() => selected ?? new Date());
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  function place() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const POPOVER_W = 320, GAP = 8, MARGIN = 8;
    setPos({
      left: Math.max(MARGIN, Math.min(rect.left, window.innerWidth - POPOVER_W - MARGIN)),
      bottom: window.innerHeight - rect.top + GAP,
    });
  }

  function openCalendar() {
    place();
    const start = selected ?? new Date();
    setView(start);
    setFocusDay(start);
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function pick(d: Date) {
    onChange(toValue(d));
    close();
  }

  // Close when clicking outside
  // Follow the field when the window is resized or anything scrolls
  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep keyboard focus on the focused day
  useEffect(() => {
    if (!open) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${toValue(focusDay)}"]`)
      ?.focus();
  }, [open, focusDay]);

  function moveFocus(d: Date) {
    setFocusDay(d);
    if (d.getMonth() !== view.getMonth() || d.getFullYear() !== view.getFullYear()) setView(d);
  }

  function onGridKey(e: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      moveFocus(addDays(focusDay, moves[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const step = e.key === "PageUp" ? -1 : 1;
      moveFocus(new Date(focusDay.getFullYear(), focusDay.getMonth() + step, Math.min(focusDay.getDate(), 28)));
    }
  }

  // 6 weeks × 7 days, starting on the Monday on/before the 1st of the month
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i - offset));
  const today = new Date();

  const shiftMonth = (n: number) => {
    const next = new Date(view.getFullYear(), view.getMonth() + n, 1);
    setView(next);
    setFocusDay(next);
  };

  return (
    <div
      className="datepicker"
      ref={rootRef}
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`rd-input datepicker-trigger${open ? " open" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${selected ? formatLongDate(selected) : "not set"}`}
        onClick={() => (open ? close() : openCalendar())}
      >
        <Calendar size={20} />
        <span className="datepicker-value">{selected ? formatLongDate(selected) : "Pick a date"}</span>
        <ChevronDown size={18} className="datepicker-chevron" />
      </button>

      {open && (
        <div className="datepicker-popover" role="dialog" aria-label="Choose date" style={pos}>
          <div className="datepicker-head">
            <button type="button" className="datepicker-nav" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={18} />
            </button>
            <span className="datepicker-title" aria-live="polite">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </span>
            <button type="button" className="datepicker-nav" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="datepicker-grid" role="grid" ref={gridRef} onKeyDown={onGridKey}>
            {WEEKDAYS.map((w) => (
              <span key={w} className="datepicker-weekday" role="columnheader">{w}</span>
            ))}
            {days.map((d) => {
              const outside = d.getMonth() !== view.getMonth();
              const isSelected = !!selected && sameDay(d, selected);
              const isToday = sameDay(d, today);
              const cls = [
                "datepicker-day",
                outside && "outside",
                isToday && "today",
                isSelected && "selected",
              ].filter(Boolean).join(" ");
              return (
                <button
                  key={toValue(d)}
                  type="button"
                  role="gridcell"
                  data-day={toValue(d)}
                  className={cls}
                  tabIndex={sameDay(d, focusDay) ? 0 : -1}
                  aria-selected={isSelected}
                  aria-label={formatLongDate(d)}
                  onClick={() => pick(d)}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="datepicker-foot">
            <button type="button" className="datepicker-link" onClick={() => pick(addDays(today, -1))}>
              Yesterday
            </button>
            <button type="button" className="datepicker-link" onClick={() => pick(today)}>
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
