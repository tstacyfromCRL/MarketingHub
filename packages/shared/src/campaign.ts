export interface CampaignSlotInput {
  /** ISO date (YYYY-MM-DD), inclusive. */
  startDate: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  endDate: string;
  /** 0 = Sunday ... 6 = Saturday. */
  postDays: number[];
  /** Local times of day, "HH:mm". One post per time per posting day. */
  postTimes: string[];
  /** Minutes offset to UTC for the team (e.g. -240 for EDT). Matches Date#getTimezoneOffset sign inverted. */
  utcOffsetMinutes: number;
}

export const CAMPAIGN_DURATIONS = { week: 7, month: 30, quarter: 91 } as const;
export type CampaignDuration = keyof typeof CAMPAIGN_DURATIONS;

export function endDateForDuration(startDate: string, duration: CampaignDuration): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + CAMPAIGN_DURATIONS[duration] - 1);
  return d.toISOString().slice(0, 10);
}

/** Returns the UTC instants at which campaign posts should go out. */
export function planCampaignSlots(input: CampaignSlotInput): Date[] {
  const days = new Set(input.postDays);
  const times = [...input.postTimes].sort();
  const slots: Date[] = [];
  const cursor = new Date(`${input.startDate}T00:00:00Z`);
  const end = new Date(`${input.endDate}T00:00:00Z`);
  while (cursor <= end) {
    if (days.has(cursor.getUTCDay())) {
      for (const t of times) {
        const [h, m] = t.split(':').map(Number);
        const local = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate(), h, m);
        slots.push(new Date(local - input.utcOffsetMinutes * 60_000));
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}
