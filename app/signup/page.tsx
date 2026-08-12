import Link from "next/link";

import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <Link href="/" className="text-sm font-semibold">
        SignalDesk
      </Link>
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">
        Create your account
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set up your account, then we&apos;ll ask about what you sell.
      </p>
      <div className="mt-8">
        <SignupForm />
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-4">
          Sign in
        </Link>
      </p>
      <p className="mt-8 text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4">
          Back to home
        </Link>
      </p>
    </main>
  );
}
