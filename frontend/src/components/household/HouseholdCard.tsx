import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ChoresList } from './ChoresList';
import { ErrorBanner } from '../common/ErrorBanner';
import * as zoneApi from '../../api/zoneApi';
import * as choreApi from '../../api/choreApi';
import * as householdApi from '../../api/householdApi';
import * as scheduleApi from '../../api/scheduleApi';
import * as scheduleTemplateApi from '../../api/scheduleTemplateApi';
import { ApiError } from '../../api/httpClient';
import { flattenZones } from '../../utils/zoneTree';
import { filterChores } from '../../utils/choreFilter';
import { BulkScheduleBar } from './BulkScheduleBar';
import type { Household, HouseholdMember } from '../../types/auth';
import type { Zone } from '../../types/zone';
import type { Chore, ChoreFilter, SettableChoreStatus } from '../../types/chore';
import type { Schedule, ScheduleInput, ScheduleWithTarget } from '../../types/schedule';
import type { CreateScheduleTemplateInput, ScheduleTemplate } from '../../types/scheduleTemplate';

export function HouseholdCard({
  household,
  filter,
}: {
  household: Household;
  filter: ChoreFilter;
}) {
  const { state } = useAuth();
  const [zoneTree, setZoneTree] = useState<Zone | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [chores, setChores] = useState<Chore[] | null>(null);
  const [choresError, setChoresError] = useState<string | null>(null);
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [unassigningId, setUnassigningId] = useState<number | null>(null);
  const [statusUpdatingKey, setStatusUpdatingKey] = useState<string | null>(null);
  const [removingChoreId, setRemovingChoreId] = useState<number | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [schedules, setSchedules] = useState<ScheduleWithTarget[]>([]);
  const [scheduleSubmittingKey, setScheduleSubmittingKey] = useState<string | null>(null);
  const [scheduleTemplates, setScheduleTemplates] = useState<ScheduleTemplate[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResultMessage, setBulkResultMessage] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    scheduleApi
      .listSchedules(household.id)
      .then((result) => {
        if (!cancelled) setSchedules(result);
      })
      .catch(() => {
        // Same rationale as the members fetch above: schedules are secondary to
        // viewing chores, so a failure here shouldn't block the page.
      });
    return () => {
      cancelled = true;
    };
  }, [household.id]);

  useEffect(() => {
    let cancelled = false;
    scheduleTemplateApi
      .listScheduleTemplates(household.id)
      .then((result) => {
        if (!cancelled) setScheduleTemplates(result);
      })
      .catch(() => {
        // Same rationale as members/schedules above: schedule templates are a
        // convenience for setting up a schedule faster, not required to view or
        // manage chores.
      });
    return () => {
      cancelled = true;
    };
  }, [household.id]);

  useEffect(() => {
    // Best-effort, silent, same rationale as resyncPushSubscription: captures the
    // household's timezone (used to evaluate chore schedules — see
    // choreScheduler.ts) without surfacing anything to the user if it fails. Only the
    // first sync from any household actually writes the column server-side
    // (householdService.setTimezone) — later calls here are harmless no-ops.
    householdApi
      .syncTimezone(household.id, Intl.DateTimeFormat().resolvedOptions().timeZone)
      .catch(() => {});
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

  async function handleSetStatus(
    choreId: number,
    zoneId: number | null,
    status: SettableChoreStatus,
  ) {
    const key = `${choreId}:${zoneId ?? 'none'}`;
    setStatusUpdatingKey(key);
    setAssignError(null);
    try {
      const updated =
        zoneId === null
          ? await choreApi.setChoreStatus(household.id, choreId, status)
          : await choreApi.setChoreZoneStatus(household.id, choreId, zoneId, status);
      setChores((prev) => prev?.map((chore) => (chore.id === choreId ? updated : chore)) ?? prev);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not update that status.');
    } finally {
      setStatusUpdatingKey(null);
    }
  }

  async function handleRemoveChore(choreId: number) {
    setRemovingChoreId(choreId);
    setAssignError(null);
    try {
      setChores(await choreApi.removeChore(household.id, choreId));
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not remove that chore.');
    } finally {
      setRemovingChoreId(null);
    }
  }

  async function handleSetSchedule(choreId: number, zoneId: number | null, input: ScheduleInput) {
    const key = `${choreId}:${zoneId ?? 'none'}`;
    setScheduleSubmittingKey(key);
    setAssignError(null);
    try {
      const updated =
        zoneId === null
          ? await scheduleApi.setChoreSchedule(household.id, choreId, input)
          : await scheduleApi.setChoreZoneSchedule(household.id, choreId, zoneId, input);
      setSchedules((prev) => [
        ...prev.filter((schedule) => !(schedule.choreId === choreId && schedule.zoneId === zoneId)),
        { ...updated, choreId, zoneId },
      ]);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not save that schedule.');
    } finally {
      setScheduleSubmittingKey(null);
    }
  }

  async function handleRemoveSchedule(choreId: number, zoneId: number | null) {
    const key = `${choreId}:${zoneId ?? 'none'}`;
    setScheduleSubmittingKey(key);
    setAssignError(null);
    try {
      if (zoneId === null) {
        await scheduleApi.removeChoreSchedule(household.id, choreId);
      } else {
        await scheduleApi.removeChoreZoneSchedule(household.id, choreId, zoneId);
      }
      setSchedules((prev) => prev.filter((schedule) => !(schedule.choreId === choreId && schedule.zoneId === zoneId)));
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not remove that schedule.');
    } finally {
      setScheduleSubmittingKey(null);
    }
  }

  async function handleSaveAsScheduleTemplate(input: CreateScheduleTemplateInput) {
    try {
      const created = await scheduleTemplateApi.createScheduleTemplate(household.id, input);
      setScheduleTemplates((prev) => [...prev, created]);
    } catch (err) {
      setAssignError(err instanceof ApiError ? err.message : 'Could not save that schedule template.');
    }
  }

  function handleToggleTarget(choreId: number, zoneId: number | null) {
    const key = `${choreId}:${zoneId ?? 'none'}`;
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setBulkResultMessage(null);
  }

  // Backs a zoned chore's tri-state header checkbox: unlike handleToggleTarget
  // (which flips one target), this sets every one of the chore's zones to the same
  // selected state in one go, so "select all"/"deselect all" doesn't depend on each
  // zone's prior individual state.
  function handleSetZoneGroupSelected(choreId: number, zoneIds: number[], selected: boolean) {
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      for (const zoneId of zoneIds) {
        const key = `${choreId}:${zoneId}`;
        if (selected) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
      return next;
    });
    setBulkResultMessage(null);
  }

  async function handleBulkApplySchedule(input: ScheduleInput) {
    setBulkSubmitting(true);
    setBulkResultMessage(null);

    const targets = [...selectedTargets].map((key) => {
      const [choreIdText, zoneIdText] = key.split(':');
      return {
        choreId: Number(choreIdText),
        zoneId: zoneIdText === 'none' ? null : Number(zoneIdText),
      };
    });

    const results = await Promise.allSettled(
      targets.map((target) =>
        target.zoneId === null
          ? scheduleApi.setChoreSchedule(household.id, target.choreId, input)
          : scheduleApi.setChoreZoneSchedule(household.id, target.choreId, target.zoneId, input),
      ),
    );

    const updates = results
      .map((result, index) =>
        result.status === 'fulfilled' ? { ...targets[index], schedule: result.value } : null,
      )
      .filter((update): update is { choreId: number; zoneId: number | null; schedule: Schedule } => update !== null);

    setSchedules((prev) => {
      const remaining = prev.filter(
        (schedule) =>
          !updates.some((update) => update.choreId === schedule.choreId && update.zoneId === schedule.zoneId),
      );
      return [
        ...remaining,
        ...updates.map((update) => ({ ...update.schedule, choreId: update.choreId, zoneId: update.zoneId })),
      ];
    });

    const succeeded = updates.length;
    const failed = results.length - succeeded;
    setBulkResultMessage(
      failed === 0
        ? `Applied to all ${succeeded} selected.`
        : `Applied to ${succeeded} of ${results.length} — ${failed} failed.`,
    );
    setBulkSubmitting(false);
    setSelectedTargets(new Set());
  }

  if (state.status !== 'authenticated') return null;
  const isHead = household.role === 'head';
  const scheduleByTarget = new Map<string, Schedule>(
    schedules.map((schedule) => [`${schedule.choreId}:${schedule.zoneId ?? 'none'}`, schedule]),
  );
  const selectedTargetsIncludeExistingSchedule = [...selectedTargets].some((key) =>
    scheduleByTarget.has(key),
  );

  return (
    <>
      <ErrorBanner message={zoneError ?? choresError ?? assignError} />
      {chores && zoneTree ? (
        <>
          <BulkScheduleBar
            isHead={isHead}
            selectedCount={selectedTargets.size}
            hasExistingSchedule={selectedTargetsIncludeExistingSchedule}
            scheduleTemplates={scheduleTemplates}
            submitting={bulkSubmitting}
            resultMessage={bulkResultMessage}
            // Deliberately not void-wrapped, unlike every other async handler here:
            // BulkScheduleBar awaits this promise to keep its inline form mounted
            // until the batch actually resolves (see BulkScheduleBar.tsx).
            onApply={(input) => handleBulkApplySchedule(input)}
            onSaveAsScheduleTemplate={(input) => void handleSaveAsScheduleTemplate(input)}
          />
          <ChoresList
            chores={filterChores(chores, filter, state.user.id)}
            allChoresCount={chores.length}
            zoneNameById={new Map(flattenZones(zoneTree).map((zone) => [zone.id, zone.name]))}
            members={members}
            currentUserId={state.user.id}
            isHead={isHead}
            assigningKey={assigningKey}
            onAssign={(choreId, userId, zoneId) => void handleAssign(choreId, userId, zoneId)}
            unassigningId={unassigningId}
            onUnassign={(choreId, assignmentId) => void handleUnassign(choreId, assignmentId)}
            statusUpdatingKey={statusUpdatingKey}
            onSetStatus={(choreId, zoneId, status) =>
              void handleSetStatus(choreId, zoneId, status)
            }
            removingChoreId={removingChoreId}
            onRemove={(choreId) => void handleRemoveChore(choreId)}
            scheduleByTarget={scheduleByTarget}
            scheduleSubmittingKey={scheduleSubmittingKey}
            onSetSchedule={(choreId, zoneId, input) => void handleSetSchedule(choreId, zoneId, input)}
            onRemoveSchedule={(choreId, zoneId) => void handleRemoveSchedule(choreId, zoneId)}
            scheduleTemplates={scheduleTemplates}
            onSaveAsScheduleTemplate={(input) => void handleSaveAsScheduleTemplate(input)}
            selectedTargets={selectedTargets}
            onToggleTarget={handleToggleTarget}
            onSetZoneGroupSelected={handleSetZoneGroupSelected}
          />
        </>
      ) : (
        !choresError && <p className="members-loading">Loading chores…</p>
      )}
    </>
  );
}
