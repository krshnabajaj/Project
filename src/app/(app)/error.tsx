"use client";

import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-10">
      <Alert tone="danger" title="Something went wrong loading this page">
        The error has been logged{error.digest ? ` (reference ${error.digest})` : ""}. Try again, or contact the administrator if it keeps happening.
      </Alert>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
