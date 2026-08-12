// Transcription provider boundary — future vendor adapter (placeholder).
// Phase 1 uses deterministic adapters returning the structured shapes later
// providers will use. No microphone capture in Phase 1.

export interface TranscriptionProvider {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  // TODO(Phase 1): typed segment stream — speaker (rep | prospect | system),
  // text, relative timing, confidence, final flag.
}
