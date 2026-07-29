import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { ZoneTree } from '../components/household/ZoneTree';
import { ErrorBanner } from '../components/common/ErrorBanner';
import * as zoneApi from '../api/zoneApi';
import { ApiError } from '../api/httpClient';
import { flattenZones } from '../utils/zoneTree';
import type { Zone } from '../types/zone';

export function ZonesPage() {
  const { householdId: householdIdParam } = useParams();
  const householdId = Number(householdIdParam);
  const { state } = useAuth();

  const [zoneTree, setZoneTree] = useState<Zone | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const household =
    state.status === 'authenticated'
      ? state.households.find((candidate) => candidate.id === householdId)
      : undefined;

  useEffect(() => {
    if (!household) return;
    let cancelled = false;
    zoneApi
      .getZoneTree(householdId)
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
  }, [householdId, household]);

  async function handleCreateZone(parentZoneId: number, name: string) {
    setBusy(true);
    setZoneError(null);
    try {
      setZoneTree(await zoneApi.createZone(householdId, name, parentZoneId));
    } catch (err) {
      setZoneError(err instanceof ApiError ? err.message : 'Could not create that zone.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveZone(zoneId: number) {
    setBusy(true);
    setZoneError(null);
    try {
      setZoneTree(await zoneApi.removeZone(householdId, zoneId));
    } catch (err) {
      setZoneError(err instanceof ApiError ? err.message : 'Could not remove that zone.');
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveZone(zoneId: number, newParentZoneId: number) {
    setBusy(true);
    setZoneError(null);
    try {
      setZoneTree(await zoneApi.moveZone(householdId, zoneId, newParentZoneId));
    } catch (err) {
      setZoneError(err instanceof ApiError ? err.message : 'Could not move that zone.');
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') return null;
  if (!household) {
    return <Navigate to="/" replace />;
  }
  const isHead = household.role === 'head';

  return (
    <div className="card">
      <h1>Zones</h1>
      <p className="card-eyebrow">For {household.name}</p>
      <ErrorBanner message={zoneError} />
      {zoneTree ? (
        <ul className="zone-tree">
          <ZoneTree
            zone={zoneTree}
            allZones={flattenZones(zoneTree)}
            isHead={isHead}
            busy={busy}
            onCreate={(parentZoneId, name) => void handleCreateZone(parentZoneId, name)}
            onRemove={(zoneId) => void handleRemoveZone(zoneId)}
            onMove={(zoneId, newParentZoneId) => void handleMoveZone(zoneId, newParentZoneId)}
          />
        </ul>
      ) : (
        !zoneError && <p className="members-loading">Loading zones…</p>
      )}
      <p className="card-footer">
        <Link to="/">Back</Link>
      </p>
    </div>
  );
}
