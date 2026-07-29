import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../context/AuthContext';
import { ChoresList } from './ChoresList';
import { ErrorBanner } from '../common/ErrorBanner';
import * as zoneApi from '../../api/zoneApi';
import * as choreApi from '../../api/choreApi';
import { ApiError } from '../../api/httpClient';
import { flattenZones } from '../../utils/zoneTree';
import type { Household } from '../../types/auth';
import type { Zone } from '../../types/zone';
import type { Chore } from '../../types/chore';

export function HouseholdCard({ household }: { household: Household }) {
  const { state } = useAuth();
  const [zoneTree, setZoneTree] = useState<Zone | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [chores, setChores] = useState<Chore[] | null>(null);
  const [choresError, setChoresError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    zoneApi
      .getZoneTree(household.id)
      .then((result) => {
        if (!cancelled) setZoneTree(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setZoneError(err instanceof ApiError ? err.message : 'Could not load zones.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [household.id]);

  useEffect(() => {
    let cancelled = false;
    choreApi
      .listChores(household.id)
      .then((result) => {
        if (!cancelled) setChores(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setChoresError(err instanceof ApiError ? err.message : 'Could not load chores.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [household.id]);

  if (state.status !== 'authenticated') return null;
  const isHead = household.role === 'head';

  return (
    <div className="household-card">
      <h2>{household.name}</h2>
      <ErrorBanner message={zoneError ?? choresError} />
      {isHead && (
        <Link
          to={`/households/${household.id}/chores/new`}
          className="btn btn-primary section-action"
        >
          + Add chore
        </Link>
      )}
      {chores && zoneTree ? (
        <ChoresList
          chores={chores}
          zoneNameById={new Map(flattenZones(zoneTree).map((zone) => [zone.id, zone.name]))}
        />
      ) : (
        !choresError && <p className="members-loading">Loading chores…</p>
      )}
    </div>
  );
}
