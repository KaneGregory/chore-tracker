import { useState, type FormEvent } from 'react';
import { FormField } from '../common/FormField';
import type { Zone } from '../../types/zone';

interface CreateChoreFormProps {
  zoneTree: Zone;
  submitting: boolean;
  onSubmit: (name: string, zoneIds: number[]) => void;
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
    onSubmit(trimmed, [...selectedZoneIds]);
    setName('');
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
