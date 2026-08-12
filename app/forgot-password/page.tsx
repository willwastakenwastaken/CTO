import Link from "next/link";

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Password-reset request placeholder — Supabase auth lands in a later milestone.
      </p>
      <p className="mt-8 text-sm text-muted-foreground">
        <Link href="/login" className="underline underline-offset-4">Back to sign in</Link>
      </p>
    </main>
  );
}
