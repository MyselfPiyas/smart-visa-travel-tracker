const DATE_FORMAT = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const DATE_TIME_FORMAT = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function isValidTimeZone(value) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; }
  catch { return false; }
}

function partsToDateKey(parts) {
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function calendarDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

export function localDateKey(value, timeZone = 'UTC') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf()) || !isValidTimeZone(timeZone)) return null;
  return partsToDateKey(DATE_FORMAT(timeZone).formatToParts(date));
}

export function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || !Number.isInteger(days)) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDaysBetween(fromDateKey, toDateKey) {
  const from = Date.parse(`${fromDateKey}T00:00:00.000Z`);
  const to = Date.parse(`${toDateKey}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

/** Convert a user's local wall-clock send time to a UTC instant, including DST. */
export function localDateTimeToUtc(dateKey, hour = 9, timeZone = 'UTC') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !isValidTimeZone(timeZone)) return null;
  const [year, month, day] = dateKey.split('-').map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = wallClock;
  const formatter = DATE_TIME_FORMAT(timeZone);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(({ type, value }) => [type, Number(value)]));
    const represented = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
    // Compare against the requested wall-clock value. Comparing to `guess`
    // repeatedly applies the zone offset on every iteration.
    const correction = represented - wallClock;
    if (correction === 0) break;
    guess -= correction;
  }
  return new Date(guess);
}
