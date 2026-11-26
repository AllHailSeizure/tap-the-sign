/**
 * Minimal 5-field cron matcher (minute hour day-of-month month day-of-week), UTC.
 * Supports `*`, numbers, ranges `a-b`, lists `a,b`, and steps `*\/n` / `a-b/n`.
 * Devvit also accepts a 6-field form with seconds; a leading seconds field is
 * ignored here (tasks fire once per matching minute).
 */
function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  return field.split(',').some((part) => {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    let lo = min;
    let hi = max;
    if (rangePart && rangePart !== '*') {
      const [a, b] = rangePart.split('-');
      lo = Number(a);
      hi = b === undefined ? (stepPart ? max : lo) : Number(b);
    }
    if ([lo, hi, step].some((n) => Number.isNaN(n))) {
      throw new Error(`Unsupported cron field "${field}"`);
    }
    return value >= lo && value <= hi && (value - lo) % step === 0;
  });
}

export function cronMatches(expr: string, date: Date): boolean {
  const fields = expr.trim().split(/\s+/);
  const five = fields.length === 6 ? fields.slice(1) : fields;
  if (five.length !== 5) throw new Error(`Unsupported cron expression "${expr}"`);
  const [minute, hour, dom, month, dow] = five as [string, string, string, string, string];
  const dowValue = date.getUTCDay();
  return (
    fieldMatches(minute, date.getUTCMinutes(), 0, 59) &&
    fieldMatches(hour, date.getUTCHours(), 0, 23) &&
    fieldMatches(dom, date.getUTCDate(), 1, 31) &&
    fieldMatches(month, date.getUTCMonth() + 1, 1, 12) &&
    (fieldMatches(dow, dowValue, 0, 7) || (dowValue === 0 && fieldMatches(dow, 7, 0, 7)))
  );
}
