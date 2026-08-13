import { z } from 'zod';

function isValidIanaTimeZone(value: string): boolean {
  try {
    // Throws RangeError for anything that isn't a real IANA zone name — the standard
    // way to validate one without hardcoding/maintaining a zone list.
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timeZoneSchema = z.string().min(1).refine(isValidIanaTimeZone, 'Invalid time zone');
