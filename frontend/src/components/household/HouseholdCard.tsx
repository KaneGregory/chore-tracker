import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ChoresList } from './ChoresList';
import { ErrorBanner } from '../common/ErrorBanner';
import * as zoneApi from '../../api/zoneApi';
import * as choreApi from '../../api/choreApi';
import * as householdApi from '../../api/householdApi';
import { ApiError } from '../../api/httpClient';
import { flattenZones } from '../../utils/zoneTree';
import type { Household, HouseholdMember } from '../../types/auth';
import type { Zone } from '../../types/zone';
import type { Chore } from '../../types/chore';

export function HouseholdCard({ household }: { household: Household }) {
  const { state } = useAuth();
  const [zoneTree, setZoneTree] = useState<Zone | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [chores, setChores] = useState<Chore[] | null>(null);
  const [choresError, setChoresError] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [unassigningId, setUnassigningId] = useState<number | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    householdApi
      .listMembers(household.id)
      .then((result) => {
        if (!cancelled) setMembers(result);
      })
      .catch(() => {
        // Only needed for the head's assignment picker; failing here shouldn't block
        // viewing chores, so it's swallowed rather than surfaced via ErrorBanner.
      });
    return () => {
      cancelled = true;
    };
  }, [household.id]);

  async function handleAssign(choreId: number, userId: number, zoneId: number | null) {
    const key = `${choreId}:${zoneId ?? 'none'}`;
    setAssigningKey(key);
    setAssignError(null);
    try {
      const updated = await choreApi.assignChore(household.id, choreId, userId, zoneId);
      setChores((prev) => prev?.map((chore) => (chore.id === choreId ? updated : chore)) ?? prev);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not assign that chore.');
    } finally {
      setAssigningKey(null);
    }
  }

  async function handleUnassign(choreId: number, assignmentId: number) {
    setUnassigningId(assignmentId);
    setAssignError(null);
    try {
      const updated = await choreApi.unassignChore(household.id, choreId, assignmentId);
      setChores((prev) => prev?.map((chore) => (chore.id === choreId ? updated : chore)) ?? prev);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not unassign that chore.');
    } finally {
      setUnassigningId(null);
    }
  }

  if (state.status !== 'authenticated') return null;
  const isHead = household.role === 'head';

  return (
    <>
      <ErrorBanner message={zoneError ?? choresError ?? assignError} />
      {chores && zoneTree ? (
        <ChoresList
          chores={chores}
          zoneNameById={new Map(flattenZones(zoneTree).map((zone) => [zone.id, zone.name]))}
          members={members}
          currentUserId={state.user.id}
          isHead={isHead}
          assigningKey={assigningKey}
          onAssign={(choreId, userId, zoneId) => void handleAssign(choreId, userId, zoneId)}
          unassigningId={unassigningId}
          onUnassign={(choreId, assignmentId) => void handleUnassign(choreId, assignmentId)}
        />
      ) : (
        !choresError && <p className="members-loading">Loading chores…</p>
      )}
    </>
  );
}
