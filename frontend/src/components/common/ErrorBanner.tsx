export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div role="alert" className="error-banner">
      <span aria-hidden="true">⚠</span>
      <span>{message}</span>
    </div>
  );
}
