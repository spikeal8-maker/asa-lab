import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * School time.
 *
 * Every date a teacher reads about a class — when a learner signed in, when
 * they saved, when the class was made — is a fact about a room in a particular
 * place. Rendering it in whatever zone the current device happens to be set to
 * is how a register comes to say a lesson happened at four in the morning: a
 * teacher checking work from a phone abroad, a laptop whose clock was never
 * corrected, a shared computer in a lab.
 *
 * So the zone is a property of the teacher, stored with their account, and
 * every date on a class page is formatted in it. When nothing is stored yet the
 * device's own zone stands in, which is the same answer the old code gave — the
 * difference is that it stops changing once the account has one.
 */

const SchoolTimeZone = createContext<string | null>(null);

export function SchoolTimeProvider({
  timeZone,
  children,
}: {
  readonly timeZone: string | null;
  readonly children: ReactNode;
}): JSX.Element {
  return <SchoolTimeZone.Provider value={timeZone}>{children}</SchoolTimeZone.Provider>;
}

/** The zone in force, falling back to this device while the account has none. */
export function useTimeZone(): string {
  const stored = useContext(SchoolTimeZone);
  return stored ?? deviceTimeZone();
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Formatters, keyed by zone so a page that prints thirty rows builds one each
 * rather than thirty. `Intl.DateTimeFormat` is expensive enough for that to
 * show on a long register.
 */
export interface SchoolTimeFormats {
  /** 17 авг. — for a list where the year is obvious. */
  readonly shortDate: (value: string | null | undefined) => string;
  /** 17 авг. 2026 г. — for anything that outlives a school year. */
  readonly date: (value: string | null | undefined) => string;
  /** 17 авг., 16:05 — a moment in the record. */
  readonly dateTime: (value: string | null | undefined) => string;
  /** 17 августа в 16:05 — a moment being spoken about. */
  readonly longDateTime: (value: string | null | undefined) => string;
  readonly timeZone: string;
}

function safe(
  format: Intl.DateTimeFormat,
  value: string | null | undefined,
  absent: string,
): string {
  if (!value) return absent;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? absent : format.format(date);
}

const cache = new Map<string, SchoolTimeFormats>();

export function schoolTimeFormats(timeZone: string): SchoolTimeFormats {
  const cached = cache.get(timeZone);
  if (cached) return cached;
  // A zone the platform cannot resolve must not take the page down with it: a
  // stored name can outlive a browser's data, and a register that throws is
  // worse than one an hour out.
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: zone });
  } catch {
    zone = deviceTimeZone();
  }
  const shortDate = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    timeZone: zone,
  });
  const date = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: zone,
  });
  const dateTime = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  });
  const longDateTime = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: zone,
  });
  const formats: SchoolTimeFormats = {
    shortDate: (value) => safe(shortDate, value, '—'),
    date: (value) => safe(date, value, '—'),
    dateTime: (value) => safe(dateTime, value, '—'),
    longDateTime: (value) => safe(longDateTime, value, '—'),
    timeZone: zone,
  };
  cache.set(timeZone, formats);
  return formats;
}

export function useSchoolTime(): SchoolTimeFormats {
  const zone = useTimeZone();
  return useMemo(() => schoolTimeFormats(zone), [zone]);
}

/**
 * How the zone reads in settings: the name plus the offset in force today,
 * because "Europe/Moscow" means nothing to most teachers and "UTC+3" does.
 */
export function timeZoneLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('ru-RU', {
      timeZone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const offset = parts.find((part) => part.type === 'timeZoneName')?.value;
    return offset ? `${timeZone} (${offset})` : timeZone;
  } catch {
    return timeZone;
  }
}
