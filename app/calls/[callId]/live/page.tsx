import { redirect } from "next/navigation";
import { LiveWorkspace } from "@/components/live/live-workspace";
import { getCurrentUserId } from "@/lib/auth/session";
import { loginRedirectUrl } from "@/lib/auth/guards";

export default async function LiveCallPage({
  params,
}: {
  params: Promise<{ callId: string }>;
}) {
  const { callId } = await params;
  // Defense in depth: proxy.ts already guards /calls for unauthenticated
  // users; every server action also derives the user from the session.
  try {
    await getCurrentUserId();
  } catch {
    redirect(loginRedirectUrl(`/calls/${callId}/live`));
  }
  return <LiveWorkspace callId={callId} />;
}
