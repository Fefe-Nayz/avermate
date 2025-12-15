import dayjs from "dayjs";
import 'dayjs/locale/fr'

import { type DateTimeFormatOptions } from 'next-intl';

dayjs.locale('fr');

/**
 * Impact decimals places
 */
export const IMPACT_DECIMALS = 3;

/**
 * Average decimals places
 */
export const AVG_DECIMALS = 2;

/**
 * The out of value used for average calculations
 */
const AVG_CALCULATION_OUT_OF = 2000;

/**
 * Get display value for average
 */
export const formatAverageValue = (value: number, outOf: number): number => {
  // Get average on a scale of 0 to 1
  const normalizedValue = (value / AVG_CALCULATION_OUT_OF);
  // Scale it to the desired outOf value
  const formattedValue = normalizedValue * (outOf / 100);
  // Return value rounded to 2 decimal places
  return parseFloat(formattedValue.toFixed(AVG_DECIMALS));
}

/**
 * Get display value for average impact
 */
export const formatAverageImpactValue = (value: number, outOf: number): number => {
  // Get average on a scale of 0 to 1
  const normalizedValue = (value * 100 / AVG_CALCULATION_OUT_OF );
  // Scale it to the desired outOf value
  const formattedValue = normalizedValue * (outOf / 100);
  // Return value rounded to 2 decimal places
  return parseFloat(formattedValue.toFixed(IMPACT_DECIMALS));
}

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