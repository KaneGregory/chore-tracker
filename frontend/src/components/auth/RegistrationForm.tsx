import { useState, type FormEvent } from 'react';
import { FormField } from '../common/FormField';
import * as authApi from '../../api/authApi';
import { ApiError } from '../../api/httpClient';

interface RegistrationFormProps {
  initialEmail: string;
  initialPassword: string;
  onNext: (email: string, password: string) => void;
}

export function RegistrationForm({ initialEmail, initialPassword, onNext }: RegistrationFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [checking, setChecking] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    setPasswordError(undefined);
    setEmailError(undefined);

    const normalizedEmail = email.trim().toLowerCase();
    setChecking(true);
    try {
      const available = await authApi.isEmailAvailable(normalizedEmail);
      if (!available) {
        setEmailError('That email is already registered.');
        return;
      }
      onNext(normalizedEmail, password);
    } catch (err) {
      setEmailError(
        err instanceof ApiError ? err.message : 'Could not verify that email. Please try again.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <FormField
        label="Email"
        name="email"
        type="email"
        value={email}
        onChange={setEmail}
        error={emailError}
        autoComplete="email"
        required
      />
      <FormField
        label="Password"
        name="password"
        type="password"
        value={password}
        onChange={setPassword}
        error={passwordError}
        autoComplete="new-password"
        required
      />
      <button type="submit" className="btn btn-primary btn-block" disabled={checking}>
        {checking ? 'Checking…' : 'Continue'}
      </button>
    </form>
  );
}
