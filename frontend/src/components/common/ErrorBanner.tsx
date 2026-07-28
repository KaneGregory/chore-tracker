export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div role="alert" className="error-banner">
      {message}
    </div>
  );
}
