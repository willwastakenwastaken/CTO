// Transcript segment types (call_events reference segments; the intervention
// policy reads the recent transcript to decide LISTEN vs intervene).
// Shape matches migrations/001_initial_schema.sql (transcript_segments).

import type { SpeakerRole } from "@/domain/events/types";

export interface TranscriptSegment {
  id: string; // UUID string
  callId?: string;
  /** Strictly ordered per call (unique call_id + sequence in the DB). */
  sequence: number;
  speaker: SpeakerRole;
  text: string;
  /** Milliseconds from call start (non-negative). */
  relativeTimeMs: number;
  /** 0..1 transcription confidence. */
  confidence: number;
  isFinal: boolean;
}
