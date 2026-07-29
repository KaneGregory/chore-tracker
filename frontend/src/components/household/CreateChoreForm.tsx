import { useState, type FormEvent } from 'react';
import { FormField } from '../common/FormField';
import type { ChoreType } from '../../types/chore';
import type { Zone } from '../../types/zone';

interface CreateChoreFormProps {
  zoneTree: Zone;
  submitting: boolean;
  onSubmit: (name: string, type: ChoreType, zoneIds: number[]) => void;
}

function ZoneCheckboxes({
  zone,
  selected,
  onToggle,
}: {
  zone: Zone;
  selected: Set<number>;
  onToggle: (zoneId: number) => void;
}) {
  return (
    <li>
      <label className="zone-picker-option">
        <input type="checkbox" checked={selected.has(zone.id)} onChange={() => onToggle(zone.id)} />
        {zone.name}
      </label>
      {zone.children.length > 0 && (
        <ul className="zone-children">
          {zone.children.map((child) => (
            <ZoneCheckboxes key={child.id} zone={child} selected={selected} onToggle={onToggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function CreateChoreForm({ zoneTree, submitting, onSubmit }: CreateChoreFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<ChoreType>('single-time');
  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<number>>(new Set());

  function toggleZone(zoneId: number) {
    setSelectedZoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) {
        next.delete(zoneId);
      } else {
        next.add(zoneId);
      }
      return next;
    });
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed, type, [...selectedZoneIds]);
    setName('');
    setType('single-time');
    setSelectedZoneIds(new Set());
  }

  return (
    <form className="create-chore-form" onSubmit={handleSubmit}>
      <FormField
        label="Chore name"
        name="choreName"
        value={name}
        onChange={setName}
        placeholder="e.g. Take out trash"
        required
      />

      <fieldset className="form-field">
        <legend>Type</legend>
        <div className="type-toggle" role="radiogroup" aria-label="Chore type">
          <button
            type="button"
            role="radio"
            aria-checked={type === 'single-time'}
            className={`btn btn-pill-outline${type === 'single-time' ? ' selected' : ''}`}
            onClick={() => setType('single-time')}
          >
            Single-time
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={type === 'forever'}
            className={`btn btn-pill-outline${type === 'forever' ? ' selected' : ''}`}
            onClick={() => setType('forever')}
          >
            Forever
          </button>
        </div>
      </fieldset>

      <fieldset className="zone-picker">
        <legend>Zones (optional)</legend>
        <ul className="zone-tree">
          <ZoneCheckboxes zone={zoneTree} selected={selectedZoneIds} onToggle={toggleZone} />
        </ul>
      </fieldset>

      <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add chore'}
      </button>
    </form>
  );
}
