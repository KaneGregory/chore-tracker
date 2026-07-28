import { useState, type FormEvent } from 'react';
import { FormField } from '../common/FormField';

interface LoginFormProps {
  submitting: boolean;
  onSubmit: (email: string, password: string) => void;
}

export function LoginForm({ submitting, onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(email.trim().toLowerCase(), password);
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormField
        label="Email"
        name="email"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
        required
      />
      <FormField
        label="Password"
        name="password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
