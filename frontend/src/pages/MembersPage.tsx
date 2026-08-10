import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { MembersList } from '../components/household/MembersList';
import { ErrorBanner } from '../components/common/ErrorBanner';
import * as householdApi from '../api/householdApi';
import { ApiError } from '../api/httpClient';
import type { HouseholdMember } from '../types/auth';

function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function MembersPage() {
  const { householdId: householdIdParam } = useParams();
  const householdId = Number(householdIdParam);
  const { state } = useAuth();

  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [demotingId, setDemotingId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [newMemberUsername, setNewMemberUsername] = useState('');
  const [creatingMember, setCreatingMember] = useState(false);
  const [resolvingPendingKey, setResolvingPendingKey] = useState<string | null>(null);

  const household =
    state.status === 'authenticated'
      ? state.households.find((candidate) => candidate.id === householdId)
      : undefined;

  useEffect(() => {
    if (!household) return;
    let cancelled = false;
    householdApi
      .listMembers(householdId)
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
  }, [householdId, household]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timeout);
  }, [copied]);

  async function handleCopy() {
    if (!household) return;
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
      const updated = await householdApi.promoteMember(householdId, userId);
      setMembers(updated);
    } catch (err) {
      setMembersError(err instanceof ApiError ? err.message : 'Could not promote that person.');
    } finally {
      setPromotingId(null);
    }
  }

  async function handleDemote(userId: number) {
    setDemotingId(userId);
    setMembersError(null);
    try {
      const updated = await householdApi.demoteMember(householdId, userId);
      setMembers(updated);
    } catch (err) {
      setMembersError(err instanceof ApiError ? err.message : 'Could not demote that person.');
    } finally {
      setDemotingId(null);
    }
  }

  async function handleApprove(userId: number) {
    setResolvingPendingKey(`${userId}:approve`);
    setMembersError(null);
    try {
      setMembers(await householdApi.approveMember(householdId, userId));
    } catch (err) {
      setMembersError(err instanceof ApiError ? err.message : 'Could not approve that person.');
    } finally {
      setResolvingPendingKey(null);
    }
  }

  async function handleDecline(userId: number) {
    setResolvingPendingKey(`${userId}:decline`);
    setMembersError(null);
    try {
      setMembers(await householdApi.declineMember(householdId, userId));
    } catch (err) {
      setMembersError(
        err instanceof ApiError ? err.message : 'Could not decline that application.',
      );
    } finally {
      setResolvingPendingKey(null);
    }
  }

  async function handleAssign(userId: number, targetMemberId: number) {
    setResolvingPendingKey(`${userId}:assign`);
    setMembersError(null);
    try {
      setMembers(await householdApi.assignPendingMember(householdId, userId, targetMemberId));
    } catch (err) {
      setMembersError(err instanceof ApiError ? err.message : 'Could not assign that applicant.');
    } finally {
      setResolvingPendingKey(null);
    }
  }

  async function handleCreateMember(event: FormEvent) {
    event.preventDefault();
    const trimmed = newMemberUsername.trim();
    if (!trimmed) return;
    setCreatingMember(true);
    setMembersError(null);
    try {
      const updated = await householdApi.createMember(householdId, trimmed);
      setMembers(updated);
      setNewMemberUsername('');
      setAddingMember(false);
    } catch (err) {
      setMembersError(err instanceof ApiError ? err.message : 'Could not create that member.');
    } finally {
      setCreatingMember(false);
    }
  }

  if (state.status === 'loading') return null;
  if (state.status !== 'authenticated' || !household) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="card">
      <h1>Members</h1>
      <p className="card-eyebrow">For {household.name}</p>
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
      <ErrorBanner message={membersError} />
      {members ? (
        <MembersList
          members={members}
          currentUserId={state.user.id}
          currentUserIsHead={household.role === 'head'}
          promotingId={promotingId}
          onPromote={(userId) => void handlePromote(userId)}
          demotingId={demotingId}
          onDemote={(userId) => void handleDemote(userId)}
          resolvingPendingKey={resolvingPendingKey}
          onApprove={(userId) => void handleApprove(userId)}
          onDecline={(userId) => void handleDecline(userId)}
          onAssign={(userId, targetMemberId) => void handleAssign(userId, targetMemberId)}
        />
      ) : (
        !membersError && <p className="members-loading">Loading members…</p>
      )}
      {household.role === 'head' &&
        (addingMember ? (
          <form className="zone-inline-form" onSubmit={(event) => void handleCreateMember(event)}>
            <input
              autoFocus
              value={newMemberUsername}
              onChange={(event) => setNewMemberUsername(event.target.value)}
              placeholder="e.g. Grandma"
            />
            <button type="submit" className="btn btn-pill-outline" disabled={creatingMember}>
              {creatingMember ? 'Adding…' : 'Add'}
            </button>
            <button type="button" className="btn btn-text" onClick={() => setAddingMember(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn-text" onClick={() => setAddingMember(true)}>
            + Add member
          </button>
        ))}
      <p className="card-footer">
        <Link to="/">Back</Link>
      </p>
    </div>
  );
}
