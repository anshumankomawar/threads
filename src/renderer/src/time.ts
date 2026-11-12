const DAY = 86_400_000;
const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

export function stamp(ms: number) {
  const days = (startOfDay(Date.now()) - startOfDay(ms)) / DAY;
  if (days === 0)
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function ago(ms: number) {
  const minutes = Math.floor((Date.now() - ms) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 60 / 24)}d ago`;
}
