"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import styles from "./Kit.module.css";

// THE ONE KIT (Oscar, 8 Oct 2026: "design components are falling to pieces",
// "we want the apple and world app feeling"). DESIGN-SYSTEM.md, "The system".
//
// Every product surface draws with these and nothing else: one screen shell,
// one top bar, one heading, one primary button and one quiet pill, one row, one
// lead card, one picture with its fallback, one field, one note for loading,
// empty and error, and one row of counts.
//
// The kit knows nothing about a product, a route or a reward. It holds no colour
// that means points or money: amber and green are written by the surface that
// knows what the number is. It holds no keyframe. A press scales to 0.98 and
// nothing else moves.

/** The page: one column, 512 wide, centred, on the page colour. A div, because
 *  the app's layout already wraps every page in <main>. */
export function Screen({ children, label }: { children: ReactNode; label?: string }) {
  return <div className={styles.screen} aria-label={label}>{children}</div>;
}

/** Back on the left, always the same corner. A title only when the screen needs one. */
export function TopBar({ back, title, onBack }: { back?: string; title?: string; onBack?: () => void }) {
  const chevron = (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
  return (
    <div className={styles.topBar}>
      {onBack ? (
        <button type="button" className={`${styles.back} min-h-[44px]`} onClick={onBack} aria-label="Back">{chevron}</button>
      ) : (
        <Link href={back ?? "/"} className={styles.back} aria-label="Back">{chevron}</Link>
      )}
      {title && <span className={styles.topTitle}>{title}</span>}
    </div>
  );
}

/** One heading and at most one line under it. */
export function Heading({ children, line, size = "heading" }: { children: ReactNode; line?: ReactNode; size?: "display" | "title" | "heading" }) {
  return (
    <>
      <h1 className={styles[size]}>{children}</h1>
      {line && <p className={styles.line}>{line}</p>}
    </>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <p className={styles.caption}>{children}</p>;
}

export function Group({ children }: { children: ReactNode }) {
  return <p className={styles.group}>{children}</p>;
}

/** The primary button (one per screen) or the quiet pill. A link when `href` is given. */
export function Button({
  kind = "primary", href, onClick, disabled, wide, children, label,
}: {
  kind?: "primary" | "quiet";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  wide?: boolean;
  children: ReactNode;
  label?: string;
}) {
  const cls = `${kind === "primary" ? styles.primary : styles.quiet} ${wide ? styles.wide : ""}`;
  if (href && !disabled) return <Link href={href} className={`${cls} min-h-[44px]`} aria-label={label}>{children}</Link>;
  return <button type="button" className={`${cls} min-h-[44px]`} onClick={onClick} disabled={disabled} aria-label={label}>{children}</button>;
}

/** A small label pill inside a row or a card. Not a button. */
export function Pill({ tone = "on", children }: { tone?: "on" | "off" | "dark"; children: ReactNode }) {
  const t = tone === "dark" ? styles.pillDark : tone === "off" ? styles.pillOff : styles.pillOn;
  return <span className={`${styles.pill} ${t}`}>{children}</span>;
}

/** A product's picture, or its initial. A picture that fails to load becomes the initial. */
export function Picture({ src, name, hue, initial, wide = false, framed = false, alt = "" }: {
  src: string | null | undefined;
  name: string;
  hue?: number;
  initial?: string | null;
  wide?: boolean;
  framed?: boolean;
  alt?: string;
}) {
  const [broken, setBroken] = useState(false);
  const shape = `${wide ? styles.wideIcon : styles.icon} ${framed ? styles.framed : ""}`;
  if (src && !broken) {
    // The product's own picture, from its own server. No referrer is sent.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={shape} onError={() => setBroken(true)} />;
  }
  const letter = initial ?? Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span className={`${shape} ${styles.initial}`} style={hue === undefined ? undefined : { backgroundColor: `hsl(${hue} 12% 92%)` }} aria-hidden="true">
      {letter}
    </span>
  );
}

/** The row: 72 tall, one tap target. A picture, a name, one caption, one pill. */
export function Row({
  picture, name, sub, pill, pillTone = "on", label, disabled, last, onClick, href,
}: {
  picture: ReactNode;
  name: string;
  sub: ReactNode;
  pill: ReactNode;
  pillTone?: "on" | "off" | "dark";
  label: string;
  disabled?: boolean;
  last: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const inner = (
    <>
      {picture}
      <span className={styles.rowText}>
        <span className={styles.rowName}>{name}</span>
        <span className={styles.rowSub}>{sub}</span>
      </span>
      <Pill tone={pillTone}>{pill}</Pill>
    </>
  );
  return (
    <li>
      {href && !disabled ? (
        <Link href={href} className={`${styles.row} min-h-[72px]`} aria-label={label}>{inner}</Link>
      ) : (
        <button type="button" className={`${styles.row} min-h-[72px] disabled:opacity-100`} onClick={onClick} disabled={disabled} aria-label={label}>{inner}</button>
      )}
      {!last && <div className={styles.rule} />}
    </li>
  );
}

/** The lead card: the picture across the top, then the name, one line, one pill.
 *  The only card that may carry the dark pill. `empty` draws the frame with a line in it. */
export function LeadCard({
  picture, name, line, pill, pillTone = "dark", label, onClick, disabled, empty,
}: {
  picture: ReactNode;
  name: string;
  line: ReactNode;
  pill: ReactNode;
  pillTone?: "on" | "off" | "dark";
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
  empty?: string;
}) {
  const body = (
    <>
      {empty ? <span className={styles.leadEmpty}>{empty}</span> : picture}
      <span className={styles.leadFoot}>
        <span className={styles.rowText}>
          <span className={styles.leadName}>{name}</span>
          <span className={styles.leadLine}>{line}</span>
        </span>
        {pill && <Pill tone={pillTone}>{pill}</Pill>}
      </span>
    </>
  );
  if (!onClick) return <div className={styles.lead} aria-label={label}>{body}</div>;
  return <button type="button" className={`${styles.lead} min-h-[72px] disabled:opacity-100`} onClick={onClick} disabled={disabled} aria-label={label}>{body}</button>;
}

export function Card({ children, label }: { children: ReactNode; label?: string }) {
  return <section className={styles.card} aria-label={label}>{children}</section>;
}

export function Body({ children }: { children: ReactNode }) {
  return <p className={styles.body}>{children}</p>;
}

/** One field. `area` makes it a text area. The count line goes under it. */
export function Field({
  id, label, value, onChange, area, count, ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  area?: boolean;
  count?: ReactNode;
  type?: string;
  inputMode?: "url" | "text";
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  rows?: number;
}) {
  return (
    <>
      <label className={styles.label} htmlFor={id}>{label}</label>
      {area ? (
        <textarea id={id} className={`${styles.field} ${styles.area}`} value={value} onChange={(e) => onChange(e.target.value)} maxLength={rest.maxLength} disabled={rest.disabled} placeholder={rest.placeholder} rows={rest.rows ?? 5} />
      ) : (
        <input id={id} className={styles.field} value={value} onChange={(e) => onChange(e.target.value)} type={rest.type} inputMode={rest.inputMode} autoComplete={rest.autoComplete} placeholder={rest.placeholder} maxLength={rest.maxLength} disabled={rest.disabled} />
      )}
      {count && <p className={styles.count}>{count}</p>}
    </>
  );
}

/** One pattern for loading, empty and error. An error may carry one quiet action. */
export function Note({ kind = "empty", children, action, onAction, quiet }: {
  kind?: "loading" | "empty" | "error";
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  quiet?: boolean;
}) {
  const role = kind === "error" ? "alert" : kind === "loading" ? "status" : undefined;
  return (
    <div role={role} className={`${styles.note} ${kind === "error" ? styles.noteError : ""} ${quiet ? styles.noteQuiet : ""}`}>
      {children}
      {action && onAction && <Button kind="quiet" wide onClick={onAction}>{action}</Button>}
    </div>
  );
}

/** Up to three counts side by side. Each label says whose or when. */
export function Counts({ items }: { items: Array<{ n: number; label: string }> }) {
  return (
    <div className={styles.counts}>
      {items.map((c) => (
        <div key={c.label} className={styles.count3}>
          <span className={styles.countN}>{c.n}</span>
          <span className={styles.countL}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}
