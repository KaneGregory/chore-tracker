import type { Chore } from '../../types/chore';

interface ChoresListProps {
  chores: Chore[];
  zoneNameById: Map<number, string>;
}

export function ChoresList({ chores, zoneNameById }: ChoresListProps) {
  if (chores.length === 0) {
    return <p className="chores-empty">No chores yet.</p>;
  }

  return (
    <ul className="chores-list">
      {chores.map((chore) => (
        <li className="chore-row" key={chore.id}>
          <div className="chore-row-main">
            <span className="chore-name">{chore.name}</span>
            <span className={`chore-type-badge chore-type-${chore.type}`}>
              {chore.type === 'forever' ? 'Forever' : 'Single-time'}
            </span>
          </div>
          {chore.zoneIds.length > 0 && (
            <div className="zone-tags">
              {chore.zoneIds.map((zoneId) => (
                <span className="zone-tag" key={zoneId}>
                  {zoneNameById.get(zoneId) ?? 'Unknown zone'}
                </span>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
