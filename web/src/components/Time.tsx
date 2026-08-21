'use client';

import { useEffect, useState } from 'react';

const UNITS: [limit: number, seconds: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60, 1, 'second'],
  [3600, 60, 'minute'],
  [86400, 3600, 'hour'],
  [604800, 86400, 'day'],
  [2629800, 604800, 'week'],
  [31557600, 2629800, 'month'],
  [Infinity, 31557600, 'year'],
];

function relative(iso: string): string {
  const elapsed = (Date.now() - new Date(iso).getTime()) / 1000;
  if (elapsed < 45) return 'just now';

  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [limit, seconds, unit] of UNITS) {
    if (Math.abs(elapsed) < limit) return format.format(-Math.round(elapsed / seconds), unit);
  }
  return iso.slice(0, 10);
}

/**
 * Renders the absolute date on the server and switches to "3 hours ago" once
 * mounted. Computing the relative form during render would produce different
 * markup on the server and the client and trip a hydration mismatch.
 */
export function Time({ iso }: { iso: string }) {
  const [label, setLabel] = useState(() => iso.slice(0, 10));

  useEffect(() => {
    setLabel(relative(iso));
    // Fresh comments read "just now" for a while; re-checking each minute
    // keeps an open tab from lying about how old the thread is.
    const timer = setInterval(() => setLabel(relative(iso)), 60_000);
    return () => clearInterval(timer);
  }, [iso]);

  return (
    <time className="comment-time" dateTime={iso} title={new Date(iso).toLocaleString()}>
      {label}
    </time>
  );
}
