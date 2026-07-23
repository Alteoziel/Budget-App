export function FlashError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mb-4 rounded-xl bg-coral-400/15 px-3 py-2 text-sm text-coral-500">
      {message}
    </p>
  );
}
