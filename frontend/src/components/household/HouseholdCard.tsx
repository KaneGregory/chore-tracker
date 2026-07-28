import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { MembersList } from './MembersList';
import { ErrorBanner } from '../common/ErrorBanner';
import * as householdApi from '../../api/householdApi';
import { ApiError } from '../../api/httpClient';
import type { Household, HouseholdMember } from '../../types/auth';

function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function HouseholdCard({ household }: { household: Household }) {
  const { state } = useAuth();
  const [copied, setCopied] = useState(false);
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<number | null>(null);

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

  if (state.status !== 'authenticated') return null;

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
    </div>
  );
}
