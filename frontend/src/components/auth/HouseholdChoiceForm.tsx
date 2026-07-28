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
      <div className="choice-grid" role="radiogroup" aria-label="Household choice">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'create'}
          disabled={submitting}
          className={`choice-card mode-create${mode === 'create' ? ' selected' : ''}`}
          onClick={() => setMode('create')}
        >
          <span className="choice-card-icon" aria-hidden="true">
            🏠
          </span>
          <span className="choice-card-title">Start a household</span>
          <span className="choice-card-desc">Give it a name, invite everyone else</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'join'}
          disabled={submitting}
          className={`choice-card mode-join${mode === 'join' ? ' selected' : ''}`}
          onClick={() => setMode('join')}
        >
          <span className="choice-card-icon" aria-hidden="true">
            🔑
          </span>
          <span className="choice-card-title">Join a household</span>
          <span className="choice-card-desc">Use the code someone shared with you</span>
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

      <div className="card-footer">
        <button type="button" className="btn btn-text" disabled={submitting} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
