import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";
import { ProspectForm } from "@/components/prospects/prospect-form";
import { Button } from "@/components/ui/button";

export default async function NewProspectPage() {
  try {
    await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl("/prospects/new"));
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New prospect</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with what you know. Blank fields stay unknown — never guess.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/prospects">Back to prospects</Link>
        </Button>
      </div>
      <div className="mt-8">
        <ProspectForm mode="create" />
      </div>
    </div>
  );
}
