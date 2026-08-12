import Link from "next/link";

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Email/password sign-in placeholder — Supabase auth lands in a later milestone.
      </p>
      <p className="mt-8 text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">Back to home</Link>
      </p>
    </main>
  );
}
