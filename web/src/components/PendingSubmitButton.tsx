"use client";

import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export function PendingSubmitButton({
  children,
  pendingLabel = "Working…",
  className = "",
  disabled,
  type = "submit",
  onClick,
}: Props) {
  const { pending } = useFormStatus();
  const isDisabled = Boolean(disabled || pending);

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      aria-busy={pending || undefined}
      className={`touch-manipulation min-h-11 disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
