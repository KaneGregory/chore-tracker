import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { MembersList } from '../components/household/MembersList';
import { ErrorBanner } from '../components/common/ErrorBanner';
import * as householdApi from '../api/householdApi';
import { ApiError } from '../api/httpClient';
import type { HouseholdMember } from '../types/auth';

export function MembersPage() {
  const { householdId: householdIdParam } = useParams();
  const householdId = Number(householdIdParam);
  const { state } = useAuth();

  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<number | null>(null);

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

  if (state.status === 'loading') return null;
  if (state.status !== 'authenticated' || !household) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="card">
      <h1>Members</h1>
      <p className="card-eyebrow">For {household.name}</p>
      <ErrorBanner message={membersError} />
      {members ? (
        <MembersList
          members={members}
          currentUserId={state.user.id}
          currentUserIsHead={household.role === 'head'}
          promotingId={promotingId}
          onPromote={(userId) => void handlePromote(userId)}
        />
      ) : (
        !membersError && <p className="members-loading">Loading members…</p>
      )}
      <p className="card-footer">
        <Link to="/">Back</Link>
      </p>
    </div>
  );
}
