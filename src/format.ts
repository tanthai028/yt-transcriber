/** 75_000 → "1:15", 3_725_000 → "1:02:05". Uses h:mm:ss when `forceHours` (keeps a long list aligned). */
export function formatTimestamp(ms: number, forceHours = false): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0 || forceHours) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}
