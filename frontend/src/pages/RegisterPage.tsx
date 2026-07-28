import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { RegistrationForm } from '../components/auth/RegistrationForm';
import { HouseholdChoiceForm } from '../components/auth/HouseholdChoiceForm';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/httpClient';
import type { HouseholdChoice } from '../types/auth';

export function RegisterPage() {
  const [step, setStep] = useState<'credentials' | 'household'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register } = useAuth();
  const navigate = useNavigate();

  function handleCredentialsNext(nextEmail: string, nextPassword: string) {
    setEmail(nextEmail);
    setPassword(nextPassword);
    setStep('household');
  }

  async function handleHouseholdSubmit(household: HouseholdChoice) {
    setSubmitting(true);
    setError(null);
    try {
      await register({ email, password, household });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      {step === 'credentials' ? (
        <div key="credentials" className="card-step">
          <h1>Let&rsquo;s get you set up</h1>
          <p className="card-eyebrow">You&rsquo;ll pick a household next.</p>
          <ErrorBanner message={error} />
          <RegistrationForm
            initialEmail={email}
            initialPassword={password}
            onNext={handleCredentialsNext}
          />
        </div>
      ) : (
        <div key="household" className="card-step">
          <h1>Now, your household</h1>
          <p className="card-eyebrow">Every chore belongs to one.</p>
          <ErrorBanner message={error} />
          <HouseholdChoiceForm
            submitting={submitting}
            onSubmit={handleHouseholdSubmit}
            onBack={() => setStep('credentials')}
          />
        </div>
      )}
      {step === 'credentials' && (
        <p className="card-footer">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      )}
    </div>
  );
}
