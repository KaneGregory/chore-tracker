import { useState, type FormEvent } from 'react';
import { FormField } from '../common/FormField';

interface CreateHouseholdFormProps {
  submitting: boolean;
  onSubmit: (name: string) => void;
}

export function CreateHouseholdForm({ submitting, onSubmit }: CreateHouseholdFormProps) {
  const [name, setName] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(name.trim());
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormField
        label="Household name"
        name="householdName"
        value={name}
        onChange={setName}
        required
      />
      <button type="submit" disabled={submitting || name.trim().length === 0}>
        {submitting ? 'Creating account…' : 'Create household'}
      </button>
    </form>
  );
}
