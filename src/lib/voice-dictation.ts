export interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly [index: number]: { readonly transcript: string; readonly confidence?: number };
}

export interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

export interface SpeechRecognitionErrorLike {
  readonly error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives?: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export const MIN_TRANSCRIPT_CONFIDENCE = 0.55;

export function transcriptIfConfident(
  alternative: { transcript: string; confidence?: number } | undefined,
  minimumConfidence = MIN_TRANSCRIPT_CONFIDENCE,
): string | null {
  if (!alternative) return null;
  const confidence = alternative.confidence;
  if (
    typeof confidence === "number" &&
    (!Number.isFinite(confidence) || confidence < minimumConfidence)
  ) {
    return null;
  }
  const transcript = alternative.transcript.trim();
  return transcript || null;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

export interface SpeechRecognitionEnvironment {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

export function createSpeechRecognition(
  environment: SpeechRecognitionEnvironment,
  warn: (message: string) => void = (message) => console.warn(message),
): SpeechRecognitionLike | null {
  for (const property of ["SpeechRecognition", "webkitSpeechRecognition"] as const) {
    let candidate: unknown;
    try {
      candidate = environment[property];
    } catch {
      warn(`Could not inspect browser ${property}; trying the next speech API.`);
      continue;
    }
    if (typeof candidate !== "function") continue;

    try {
      return new (candidate as SpeechRecognitionConstructor)();
    } catch {
      // Presence on window is not proof that a host constructor is usable.
      warn(`Could not construct browser ${property}; trying the next speech API.`);
    }
  }
  return null;
}

export function appendTranscript(current: string, transcript: string): string {
  const addition = transcript.trim();
  if (!addition) return current;
  if (!current) return addition;
  if (!current.trim()) return `${current}${addition}`;
  return `${current}${/\s$/.test(current) ? "" : " "}${addition}`;
}
