import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted">This page does not exist, or you do not have access to it.</p>
      <Link href="/" className="mt-2 text-sm text-accent hover:underline">
        Go to your dashboard
      </Link>
    </main>
  );
}
