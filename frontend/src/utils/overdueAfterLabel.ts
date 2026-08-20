import type { OverdueAfterUnit } from '../types/schedule';

export function formatOverdueAfter(
  overdueAfter: { amount: number; unit: OverdueAfterUnit } | null,
): string {
  if (!overdueAfter) return '';
  const unitLabel = overdueAfter.amount === 1 ? overdueAfter.unit.slice(0, -1) : overdueAfter.unit;
  return `Overdue after ${overdueAfter.amount} ${unitLabel}`;
}
