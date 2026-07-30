import { useState, type FormEvent } from 'react';
import { FormField } from '../common/FormField';
import { ErrorBanner } from '../common/ErrorBanner';
import * as authApi from '../../api/authApi';
import { ApiError } from '../../api/httpClient';

interface RegistrationFormProps {
  initialUsername: string;
  initialEmail: string;
  initialPassword: string;
  onNext: (username: string, email: string, password: string) => void;
}

export function RegistrationForm({
  initialUsername,
  initialEmail,
  initialPassword,
  onNext,
}: RegistrationFormProps) {
  const [username, setUsername] = useState(initialUsername);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedUsername = username.trim();
    if (trimmedUsername.length === 0) {
      setUsernameError('Username is required');
      return;
    }
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    setUsernameError(undefined);
    setEmailError(undefined);
    setPasswordError(undefined);
    setFormError(null);

    const normalizedEmail = email.trim().toLowerCase();
    setChecking(true);
    try {
      const [usernameAvailable, emailAvailable] = await Promise.all([
        authApi.isUsernameAvailable(trimmedUsername),
        authApi.isEmailAvailable(normalizedEmail),
      ]);

      let hasError = false;
      if (!usernameAvailable) {
        setUsernameError('That username is already taken.');
        hasError = true;
      }
      if (!emailAvailable) {
        setEmailError('That email is already registered.');
        hasError = true;
      }
      if (hasError) return;

      onNext(trimmedUsername, normalizedEmail, password);
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Could not verify those details. Please try again.',
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <ErrorBanner message={formError} />
      <FormField
        label="Username"
        name="username"
        value={username}
        onChange={setUsername}
        error={usernameError}
        autoComplete="username"
        required
      />
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
