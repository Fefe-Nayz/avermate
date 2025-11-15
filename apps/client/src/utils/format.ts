import dayjs from "dayjs";
import 'dayjs/locale/fr'

import { type DateTimeFormatOptions } from 'next-intl';

dayjs.locale('fr');

export const formatGradeValue = (value: number) => {
  return parseFloat((value / 100).toFixed(2));
};

export const formatDiff = (value: number, decimals?: number) => {
  return value > 0
    ? `+${value.toFixed(decimals || 2)}`
    : `${value.toFixed(decimals || 2)}`;
};

export const formatDate = (date: Date) => {
  return dayjs(date).format("DD MMM YYYY");
};

const dateFormats: Record<string, DateTimeFormatOptions> = {
  short: { day: 'numeric', month: 'short' },
  intermediate: { day: 'numeric', month: 'short', year: 'numeric' },
  long: { day: 'numeric', weekday: 'long', month: 'short', year: 'numeric' },
  fullMonthYear: { month: 'long', year: 'numeric' },
  shortDay: { weekday: 'short' },
};

export const useFormatDates = (formatter: any) => {
  const setToNoon = (date: Date) => {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  return {
    formatShort: (date: Date) => formatter.dateTime(setToNoon(date), dateFormats.short),
    formatIntermediate: (date: Date) => formatter.dateTime(setToNoon(date), dateFormats.intermediate),
    formatLong: (date: Date) => formatter.dateTime(setToNoon(date), dateFormats.long),
    formatFullMonthYear: (date: Date) => formatter.dateTime(setToNoon(date), dateFormats.fullMonthYear),
    formatShortDay: (date: Date) => formatter.dateTime(setToNoon(date), dateFormats.shortDay),
    formatRelative: (date: Date, now: Date = new Date()) => formatter.relativeTime(date, now), // Keep original for relative time
    formatRange: (start: Date, end: Date) => formatter.dateTimeRange(setToNoon(start), setToNoon(end), dateFormats.intermediate),
    formatFromTo: (start: Date, end: Date) => `${formatter.dateTime(setToNoon(start), dateFormats.intermediate)} - ${formatter.dateTime(setToNoon(end), dateFormats.intermediate)}`,
    formatInDays: (days: number) => {
      const targetDate = dayjs().add(days, 'day').toDate();
      return `in ${days} days (${formatter.dateTime(setToNoon(targetDate), dateFormats.short)})`;
    },
  };
};