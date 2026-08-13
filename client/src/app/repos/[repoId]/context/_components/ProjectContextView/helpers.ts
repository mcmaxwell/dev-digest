import { MAX_DIR_CHARS } from "./constants";

/**
 * Split a repo-relative path into a middle-truncated directory part and a
 * WHOLE filename. The filename is the identity, so it is never abbreviated;
 * `insights/incident-2026-04-checkout.md` crowds a row on its own.
 */
export function splitPath(path: string): { dir: string; file: string } {
  const at = path.lastIndexOf("/");
  if (at === -1) return { dir: "", file: path };
  return { dir: middleTruncate(path.slice(0, at + 1)), file: path.slice(at + 1) };
}

export function middleTruncate(text: string, max: number = MAX_DIR_CHARS): string {
  if (text.length <= max) return text;
  const keep = Math.floor((max - 1) / 2);
  return `${text.slice(0, keep)}…${text.slice(text.length - keep)}`;
}

/** "5m ago" / "2h ago" / "3d ago" — a scan time is only ever read as an age. */
export function relativeTime(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Thousands separator for the footer's token total. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
