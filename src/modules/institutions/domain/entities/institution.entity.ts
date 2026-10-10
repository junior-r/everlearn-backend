import { InvalidTimezoneException } from '../exceptions/institution.exceptions.js';

export interface Institution {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  isActive: boolean;
}

/** Accepts only IANA zone names the runtime knows, e.g. "America/Caracas". */
export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    throw new InvalidTimezoneException();
  }
}
