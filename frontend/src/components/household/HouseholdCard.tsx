import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MembersList } from './MembersList';
import { ZoneTree } from './ZoneTree';
import { CreateChoreForm } from './CreateChoreForm';
import { ChoresList } from './ChoresList';
import { ErrorBanner } from '../common/ErrorBanner';
import * as householdApi from '../../api/householdApi';
import * as zoneApi from '../../api/zoneApi';
import * as choreApi from '../../api/choreApi';
import { ApiError } from '../../api/httpClient';
import type { Household, HouseholdMember } from '../../types/auth';
import type { Zone } from '../../types/zone';
import type { Chore, ChoreType } from '../../types/chore';

function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function flattenZones(zone: Zone): { id: number; name: string }[] {
  return [{ id: zone.id, name: zone.name }, ...zone.children.flatMap(flattenZones)];
}

export function HouseholdCard({ household }: { household: Household }) {
  const { state } = useAuth();
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [zoneTree, setZoneTree] = useState<Zone | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [zoneBusy, setZoneBusy] = useState(false);
  const [chores, setChores] = useState<Chore[] | null>(null);
  const [choresError, setChoresError] = useState<string | null>(null);
  const [creatingChore, setCreatingChore] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  useEffect(() => {
    let cancelled = false;
    householdApi
      .listMembers(household.id)
      .then((result) => {
        if (!cancelled) setMembers(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setMembersError(err instanceof ApiError ? err.message : 'Could not load members.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [household.id]);

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

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatJoinCode(household.joinCode));
      setCopied(true);
    } catch {
      // Clipboard access can be denied or unavailable; the code is still visible to copy by hand.
    }
  }

  async function handlePromote(userId: number) {
    setPromotingId(userId);
    setMembersError(null);
    try {
      const updated = await householdApi.promoteMember(household.id, userId);
      setMembers(updated);
    } catch (err) {
      setMembersError(err instanceof ApiError ? err.message : 'Could not promote that person.');
    } finally {
      setPromotingId(null);
    }
  }

  async function handleCreateZone(parentZoneId: number, name: string) {
    setZoneBusy(true);
    setZoneError(null);
    try {
      setZoneTree(await zoneApi.createZone(household.id, name, parentZoneId));
    } catch (err) {
      setZoneError(err instanceof ApiError ? err.message : 'Could not create that zone.');
    } finally {
      setZoneBusy(false);
    }
  }

  async function handleRemoveZone(zoneId: number) {
    setZoneBusy(true);
    setZoneError(null);
    try {
      const updatedTree = await zoneApi.removeZone(household.id, zoneId);
      setZoneTree(updatedTree);

      // The backend cascades the zone deletion to any chore_zones rows for it (and
      // its removed descendants), but chores were fetched separately, so drop those
      // same ids here rather than waiting for a page reload to notice they're gone.
      const remainingZoneIds = new Set(flattenZones(updatedTree).map((zone) => zone.id));
      setChores(
        (prev) =>
          prev?.map((chore) => ({
            ...chore,
            zoneIds: chore.zoneIds.filter((id) => remainingZoneIds.has(id)),
          })) ?? null,
      );
    } catch (err) {
      setZoneError(err instanceof ApiError ? err.message : 'Could not remove that zone.');
    } finally {
      setZoneBusy(false);
    }
  }

  async function handleMoveZone(zoneId: number, newParentZoneId: number) {
    setZoneBusy(true);
    setZoneError(null);
    try {
      setZoneTree(await zoneApi.moveZone(household.id, zoneId, newParentZoneId));
    } catch (err) {
      setZoneError(err instanceof ApiError ? err.message : 'Could not move that zone.');
    } finally {
      setZoneBusy(false);
    }
  }

  async function handleCreateChore(name: string, type: ChoreType, zoneIds: number[]) {
    setCreatingChore(true);
    setChoresError(null);
    try {
      const created = await choreApi.createChore(household.id, name, type, zoneIds);
      setChores((prev) => [...(prev ?? []), created]);
    } catch (err) {
      setChoresError(err instanceof ApiError ? err.message : 'Could not create that chore.');
    } finally {
      setCreatingChore(false);
    }
  }

  if (state.status !== 'authenticated') return null;
  const isHead = household.role === 'head';

  return (
    <div className="household-card">
      <h2>{household.name}</h2>
      <div className="stamp-row">
        <div className="stamp">{formatJoinCode(household.joinCode)}</div>
        <button
          type="button"
          className={`btn btn-pill-outline${copied ? ' copied' : ''}`}
          onClick={() => void handleCopy()}
        >
          {copied ? 'Copied! ✓' : 'Copy'}
        </button>
      </div>
      <p className="stamp-caption">Share this code so someone else can join.</p>

      <p className="section-label">Members</p>
      <ErrorBanner message={membersError} />
      {members ? (
        <MembersList
          members={members}
          currentUserId={state.user.id}
          currentUserIsHead={isHead}
          promotingId={promotingId}
          onPromote={(userId) => void handlePromote(userId)}
        />
      ) : (
        !membersError && <p className="members-loading">Loading members…</p>
      )}

      <p className="section-label">Zones</p>
      <ErrorBanner message={zoneError} />
      {zoneTree ? (
        <ul className="zone-tree">
          <ZoneTree
            zone={zoneTree}
            allZones={flattenZones(zoneTree)}
            isHead={isHead}
            busy={zoneBusy}
            onCreate={(parentZoneId, name) => void handleCreateZone(parentZoneId, name)}
            onRemove={(zoneId) => void handleRemoveZone(zoneId)}
            onMove={(zoneId, newParentZoneId) => void handleMoveZone(zoneId, newParentZoneId)}
          />
        </ul>
      ) : (
        !zoneError && <p className="members-loading">Loading zones…</p>
      )}

      <p className="section-label">Chores</p>
      <ErrorBanner message={choresError} />
      {isHead && zoneTree && (
        <CreateChoreForm
          zoneTree={zoneTree}
          submitting={creatingChore}
          onSubmit={(name, type, zoneIds) => void handleCreateChore(name, type, zoneIds)}
        />
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
