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
    <div className="card">
      <h1>Welcome back</h1>
      <p className="card-eyebrow">Your chores missed you.</p>
      <ErrorBanner message={error} />
      <LoginForm submitting={submitting} onSubmit={handleSubmit} />
      <p className="card-footer">
        New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}
