import { useState, type FormEvent } from 'react';
import type { Zone } from '../../types/zone';

interface FlatZone {
  id: number;
  name: string;
}

interface ZoneTreeProps {
  zone: Zone;
  allZones: FlatZone[];
  isHead: boolean;
  busy: boolean;
  onCreate: (parentZoneId: number, name: string) => void;
  onRemove: (zoneId: number) => void;
  onMove: (zoneId: number, newParentZoneId: number) => void;
}

type Mode = 'idle' | 'adding' | 'moving' | 'removing';

function collectIds(zone: Zone): Set<number> {
  const ids = new Set<number>([zone.id]);
  for (const child of zone.children) {
    for (const id of collectIds(child)) ids.add(id);
  }
  return ids;
}

export function ZoneTree({
  zone,
  allZones,
  isHead,
  busy,
  onCreate,
  onRemove,
  onMove,
}: ZoneTreeProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const [newZoneName, setNewZoneName] = useState('');
  const [moveTargetId, setMoveTargetId] = useState<number | ''>('');

  function handleAddSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = newZoneName.trim();
    if (!trimmed) return;
    onCreate(zone.id, trimmed);
    setNewZoneName('');
    setMode('idle');
  }

  function handleMoveSubmit(event: FormEvent) {
    event.preventDefault();
    if (moveTargetId === '') return;
    onMove(zone.id, moveTargetId);
    setMode('idle');
  }

  const excludedFromMove = collectIds(zone);
  const moveOptions = allZones.filter((candidate) => !excludedFromMove.has(candidate.id));

  return (
    <li className="zone-item">
      <div className="zone-row">
        <span className="zone-name">{zone.name}</span>
        {isHead && mode === 'idle' && (
          <span className="zone-actions">
            <button
              type="button"
              className="btn btn-text"
              disabled={busy}
              onClick={() => setMode('adding')}
            >
              + Add
            </button>
            {!zone.isRoot && (
              <>
                <button
                  type="button"
                  className="btn btn-text"
                  disabled={busy}
                  onClick={() => setMode('moving')}
                >
                  Move
                </button>
                <button
                  type="button"
                  className="btn btn-text"
                  disabled={busy}
                  onClick={() => setMode('removing')}
                >
                  Remove
                </button>
              </>
            )}
          </span>
        )}
      </div>

      {mode === 'adding' && (
        <form className="zone-inline-form" onSubmit={handleAddSubmit}>
          <input
            autoFocus
            value={newZoneName}
            onChange={(event) => setNewZoneName(event.target.value)}
            placeholder="e.g. Pantry"
          />
          <button type="submit" className="btn btn-pill-outline" disabled={busy}>
            Add
          </button>
          <button type="button" className="btn btn-text" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      )}

      {mode === 'moving' && (
        <form className="zone-inline-form" onSubmit={handleMoveSubmit}>
          <select
            value={moveTargetId}
            onChange={(event) => setMoveTargetId(Number(event.target.value))}
          >
            <option value="" disabled>
              Move into…
            </option>
            {moveOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="btn btn-pill-outline"
            disabled={busy || moveTargetId === ''}
          >
            Move here
          </button>
          <button type="button" className="btn btn-text" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      )}

      {mode === 'removing' && (
        <div className="zone-inline-form">
          <span>Remove this zone and everything inside it?</span>
          <button
            type="button"
            className="btn btn-pill-outline"
            disabled={busy}
            onClick={() => {
              onRemove(zone.id);
              setMode('idle');
            }}
          >
            Yes, remove
          </button>
          <button type="button" className="btn btn-text" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </div>
      )}

      {zone.children.length > 0 && (
        <ul className="zone-children">
          {zone.children.map((child) => (
            <ZoneTree
              key={child.id}
              zone={child}
              allZones={allZones}
              isHead={isHead}
              busy={busy}
              onCreate={onCreate}
              onRemove={onRemove}
              onMove={onMove}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
