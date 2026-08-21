import type { OverdueAfterUnit } from '../../types/schedule';

interface OverdueAfterFieldProps {
  amount: string;
  unit: OverdueAfterUnit;
  onAmountChange: (value: string) => void;
  onUnitChange: (unit: OverdueAfterUnit) => void;
}

// Empty amount means "no timer" — mirrors how the rest of the schedule/schedule
// template forms already treat an empty required field as "not configured".
export function buildOverdueAfter(
  amountString: string,
  unit: OverdueAfterUnit,
): { amount: number; unit: OverdueAfterUnit } | undefined {
  const trimmed = amountString.trim();
  if (!trimmed) return undefined;
  const amount = Number(trimmed);
  if (!Number.isInteger(amount) || amount < 1) return undefined;
  return { amount, unit };
}

// Controlled: the parent form owns amount/unit state (other logic in those forms
// already depends on it), this component only owns the JSX.
export function OverdueAfterField({ amount, unit, onAmountChange, onUnitChange }: OverdueAfterFieldProps) {
  return (
    <label className="schedule-field">
      Become overdue if still to-do after
      <div className="overdue-after-inputs">
        <input
          type="number"
          min={1}
          max={999}
          placeholder="No timer"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
        />
        <select value={unit} onChange={(event) => onUnitChange(event.target.value as OverdueAfterUnit)}>
          <option value="minutes">Minutes</option>
          <option value="hours">Hours</option>
          <option value="days">Days</option>
        </select>
      </div>
    </label>
  );
}
