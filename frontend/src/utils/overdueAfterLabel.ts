import type { OverdueAfterUnit } from '../types/schedule';

export function formatOverdueAfter(
  overdueAfter: { amount: number; unit: OverdueAfterUnit } | null,
): string {
  if (!overdueAfter) return '';
  const unitLabel = overdueAfter.amount === 1 ? overdueAfter.unit.slice(0, -1) : overdueAfter.unit;
  return `Overdue after ${overdueAfter.amount} ${unitLabel}`;
}

// Appends the overdue-timer suffix to a recurrence summary line when a timer is
// configured, e.g. "Scheduled for 2026-08-25 · Overdue after 2 days" — shared by
// ChoreScheduleControl.tsx's schedule pill and SchedulesPage.tsx's summary line.
export function composeScheduleSummary(
  base: string,
  overdueAfter: { amount: number; unit: OverdueAfterUnit } | null,
): string {
  const overdueSuffix = formatOverdueAfter(overdueAfter);
  return overdueSuffix ? `${base} · ${overdueSuffix}` : base;
}
