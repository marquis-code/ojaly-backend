import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { BookingSettings } from '../businesses/business.schema';

export interface ScheduleDay {
  day: number;
  isWorking: boolean;
  start: string;
  end: string;
  breaks: { start: string; end: string }[];
}

export function businessDefaultSchedule(settings?: Partial<BookingSettings> | null): ScheduleDay[] {
  const configured = settings?.weeklyHours;
  if (configured?.length) {
    return configured.map((d) => ({
      day: d.day,
      isWorking: d.isOpen,
      start: d.start,
      end: d.end,
      breaks: [],
    }));
  }
  return [
    { day: 1, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 2, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 3, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 4, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 5, isWorking: true, start: '09:00', end: '18:00', breaks: [] },
    { day: 6, isWorking: true, start: '10:00', end: '16:00', breaks: [] },
    { day: 0, isWorking: false, start: '00:00', end: '00:00', breaks: [] },
  ];
}

export function minutesFromTime(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function timeFromMinutes(total: number): string {
  const normalized = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

export function localDateKey(date: Date, timezone: string): string {
  const local = toZonedTime(date, timezone);
  return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
}

export function isoDateParts(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

export function zonedDate(date: string, time: string, timezone: string): Date {
  return fromZonedTime(`${date}T${time}:00`, timezone);
}

export function weekdayForDate(date: string, timezone: string): number {
  const midday = fromZonedTime(`${date}T12:00:00`, timezone);
  return toZonedTime(midday, timezone).getDay();
}

export function timeOffContains(dayStart: Date, dayEnd: Date, timeOff: { startAt: Date; endAt: Date }[]): boolean {
  return timeOff.some((off) => off.startAt < dayEnd && off.endAt > dayStart);
}

export function isValidLocalDate(date: string): boolean {
  const parts = isoDateParts(date);
  if (!parts) return false;
  const d = new Date(Date.UTC(parts.year, parts.month, parts.day));
  return d.getUTCFullYear() === parts.year && d.getUTCMonth() === parts.month && d.getUTCDate() === parts.day;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

/**
 * Calculates worker compensation per person according to the service type and worker count:
 * 1.) 1 person steaming a Full (empty or not) 4 man room gets 10k (1,000,000 kobo)
 * 2.) 2 people steaming a Full (empty or not) 4 man room together get 5k each (500,000 kobo)
 * 3.) 1 person steaming a Full (empty or not) 6 man room gets 12k (1,200,000 kobo)
 * 4.) 2 people steaming a Full (empty or not) 6 man room together get 6k each (600,000 kobo)
 * 5.) Basic double bunk package: 2k (200,000 kobo)
 * 6.) Premium package double bunk: 3k (300,000 kobo)
 * 7.) Basic single bunk package: 1k (100,000 kobo)
 * 8.) Premium package single bunk: 1,500 (150,000 kobo)
 */
export function calculateWorkerPayout(serviceName: string, workerCount: 1 | 2 = 1): number {
  const norm = (serviceName || '').toLowerCase();
  // Full 4-man room (empty or not)
  if (norm.includes('4-man') || norm.includes('4 man')) {
    return workerCount === 2 ? 500000 : 1000000;
  }
  // Full 6-man room (empty or not)
  if (norm.includes('6-man') || norm.includes('6 man')) {
    return workerCount === 2 ? 600000 : 1200000;
  }
  // Premium double bunk
  if (norm.includes('premium') && norm.includes('double bunk')) {
    return 300000;
  }
  // Basic double bunk
  if (norm.includes('double bunk')) {
    return 200000;
  }
  // Premium single bunk
  if (norm.includes('premium') && norm.includes('single bunk')) {
    return 150000;
  }
  // Basic single bunk
  if (norm.includes('single bunk')) {
    return 100000;
  }
  return 0;
}
