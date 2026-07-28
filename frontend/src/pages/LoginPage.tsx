import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { LoginForm } from '../components/auth/LoginForm';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/httpClient';

export function LoginPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(email: string, password: string) {
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h1>Log in</h1>
      <ErrorBanner message={error} />
      <LoginForm submitting={submitting} onSubmit={handleSubmit} />
      <p>
        Need an account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
