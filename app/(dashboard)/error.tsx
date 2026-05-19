"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center">
      <AlertTriangle size={36} className="text-warning" />
      <div>
        <p className="font-semibold text-primary">Something went wrong</p>
        <p className="text-sm text-muted mt-1 max-w-sm">{error.message}</p>
      </div>
      <button
        onClick={reset}
        className="px-4 py-2 rounded-xl bg-surface border border-border text-sm font-medium text-primary hover:bg-surface-2 transition"
      >
        Try again
      </button>
    </div>
  );
}
