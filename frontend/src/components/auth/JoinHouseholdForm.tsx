import { useState, type FormEvent } from 'react';
import { FormField } from '../common/FormField';

interface JoinHouseholdFormProps {
  submitting: boolean;
  onSubmit: (joinCode: string) => void;
}

export function JoinHouseholdForm({ submitting, onSubmit }: JoinHouseholdFormProps) {
  const [joinCode, setJoinCode] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(joinCode.trim());
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormField
        label="Household join code"
        name="joinCode"
        value={joinCode}
        onChange={setJoinCode}
        required
      />
      <button type="submit" disabled={submitting || joinCode.trim().length === 0}>
        {submitting ? 'Joining household…' : 'Join household'}
      </button>
    </form>
  );
}
