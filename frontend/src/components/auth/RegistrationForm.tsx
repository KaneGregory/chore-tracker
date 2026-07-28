import { useState, type FormEvent } from 'react';
import { FormField } from '../common/FormField';

interface RegistrationFormProps {
  initialEmail: string;
  initialPassword: string;
  onNext: (email: string, password: string) => void;
}

export function RegistrationForm({ initialEmail, initialPassword, onNext }: RegistrationFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState(initialPassword);
  const [passwordError, setPasswordError] = useState<string | undefined>();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    setPasswordError(undefined);
    onNext(email.trim().toLowerCase(), password);
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
        error={passwordError}
        autoComplete="new-password"
        required
      />
      <button type="submit" className="btn btn-primary btn-block">
        Continue
      </button>
    </form>
  );
}
