/**
 * The records write local wall-clock times (`2026-09-07 13:20`) with no zone, because
 * they were written by a person in one place. The contract wants an offset, since "when"
 * without a zone cannot be ordered against a commit date.
 */

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Time zone the engagement records were written in. */
export const DEFAULT_TIME_ZONE = 'Europe/Prague';

/**
 * Turn a local timestamp into ISO 8601 with the offset that zone had at that moment,
 * so a summer record does not get a winter offset.
 */
export function toIsoWithZone(
  local: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string | undefined {
  const match = LOCAL_PATTERN.exec(local.trim());
  if (match === null) {
    // Already carries an offset, or is not a timestamp at all.
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      local.trim(),
    )
      ? local.trim()
      : undefined;
  }

  const [, year, month, day, hour, minute, second = '00'] = match;
  const asUtc = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  if (Number.isNaN(asUtc.getTime())) return undefined;

  // The offset is looked up at roughly the right instant, then once more at the instant
  // that offset implies - enough to land on the correct side of a daylight-saving change.
  const firstGuess = offsetAt(asUtc, timeZone);
  const instant = new Date(asUtc.getTime() - offsetMinutes(firstGuess) * 60_000);
  const offset = offsetAt(instant, timeZone);

  return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
}

/** A date with no time at all (`2026-09-15`) - noon local, so the day cannot slip. */
export function dateToIsoWithZone(
  date: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) return toIsoWithZone(date, timeZone);
  return toIsoWithZone(`${date.trim()} 12:00:00`, timeZone);
}

/** Calendar day of an ISO timestamp, for joining a record to a commit by date. */
export function isoDay(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function offsetAt(instant: Date, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;

  if (formatted === undefined) return '+00:00';
  const offset = formatted.replace('GMT', '').trim();
  return offset.length === 0 ? '+00:00' : offset;
}

function offsetMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (match === null) return 0;
  const [, sign, hours, minutes] = match;
  const total = Number(hours) * 60 + Number(minutes);
  return sign === '-' ? -total : total;
}
