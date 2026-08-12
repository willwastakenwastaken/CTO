import type { ReactNode } from "react";

export default function LiveCallLayout({ children }: { children: ReactNode }) {
  // Focused layout for the live-call workspace: intentionally NO app sidebar.
  // The live screen shows only the call header (prospect, PRACTICE status, timer,
  // End Session), one recommendation at a time, the transcript, and compact deal state.
  return <div className="flex min-h-full flex-col">{children}</div>;
}
