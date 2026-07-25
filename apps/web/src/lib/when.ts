// Plain-English timestamps (NFR-USE-03). An ISO string never reaches a user:
// students read "yesterday at 2:00 PM", not "2026-07-24T14:00:00.000Z".

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function timeOf(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const elapsed = now.getTime() - date.getTime();

  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) {
    const minutes = Math.round(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (date.toDateString() === now.toDateString()) return `today at ${timeOf(date)}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `yesterday at ${timeOf(date)}`;

  // Inside the last week a weekday is the most readable anchor there is.
  if (elapsed < 7 * DAY) {
    return `${date.toLocaleDateString(undefined, { weekday: 'long' })} at ${timeOf(date)}`;
  }
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
