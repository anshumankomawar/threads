// Shared date and time formatting for threads.

export const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// "5m", "3h", "2d", "1mo" since the given time.
export function formatRelativeTime(atMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.floor((nowMs - atMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDue(dueAtMs: number, nowMs: number): { label: string; overdue: boolean } {
  if (dueAtMs < nowMs) return { label: "Overdue", overdue: true };
  const days = Math.round((startOfDay(dueAtMs) - startOfDay(nowMs)) / DAY);
  if (days === 0) return { label: "Due today", overdue: false };
  if (days === 1) return { label: "Due tomorrow", overdue: false };
  const date = new Date(dueAtMs);
  const formatted =
    days < 7
      ? date.toLocaleDateString(undefined, { weekday: "short" })
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { label: `Due ${formatted}`, overdue: false };
}
