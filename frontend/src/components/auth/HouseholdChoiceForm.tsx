import { useState } from 'react';
import { CreateHouseholdForm } from './CreateHouseholdForm';
import { JoinHouseholdForm } from './JoinHouseholdForm';
import type { HouseholdChoice } from '../../types/auth';

interface HouseholdChoiceFormProps {
  submitting: boolean;
  onSubmit: (choice: HouseholdChoice) => void;
  onBack: () => void;
}

export function HouseholdChoiceForm({ submitting, onSubmit, onBack }: HouseholdChoiceFormProps) {
  const [mode, setMode] = useState<'create' | 'join'>('create');

  return (
    <div>
      <div role="tablist" aria-label="Household choice">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'create'}
          disabled={submitting}
          onClick={() => setMode('create')}
        >
          Create a household
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'join'}
          disabled={submitting}
          onClick={() => setMode('join')}
        >
          Join a household
        </button>
      </div>

      {mode === 'create' ? (
        <CreateHouseholdForm
          submitting={submitting}
          onSubmit={(name) => onSubmit({ mode: 'create', name })}
        />
      ) : (
        <JoinHouseholdForm
          submitting={submitting}
          onSubmit={(joinCode) => onSubmit({ mode: 'join', joinCode })}
        />
      )}

      <button type="button" disabled={submitting} onClick={onBack}>
        Back
      </button>
    </div>
  );
}
