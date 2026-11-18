import { describe, expect, it } from "vitest";
import {
  appendTranscript,
  createSpeechRecognition,
  MIN_TRANSCRIPT_CONFIDENCE,
  transcriptIfConfident,
  type SpeechRecognitionLike,
} from "@/lib/voice-dictation";

class MockRecognition implements SpeechRecognitionLike {
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  start() {}
  stop() {}
  abort() {}
}

describe("appendTranscript", () => {
  it("adds trimmed final text to an empty note", () => {
    expect(appendTranscript("", "  Met Dr Rao.  ")).toBe("Met Dr Rao.");
  });

  it("adds one separating space unless whitespace already exists", () => {
    expect(appendTranscript("Existing note", "next words")).toBe("Existing note next words");
    expect(appendTranscript("Existing note\n", "next words")).toBe("Existing note\nnext words");
  });

  it("preserves a whitespace-only note prefix and ignores empty segments", () => {
    expect(appendTranscript("  ", "spoken text")).toBe("  spoken text");
    expect(appendTranscript("Existing note", "  ")).toBe("Existing note");
  });
});

describe("transcriptIfConfident", () => {
  it("keeps clear results and drops low-confidence or empty alternatives", () => {
    expect(transcriptIfConfident({ transcript: "  Clear speech  ", confidence: 0.82 })).toBe(
      "Clear speech",
    );
    expect(transcriptIfConfident({ transcript: "background murmur", confidence: 0.3 })).toBeNull();
    expect(transcriptIfConfident({ transcript: "noise", confidence: 0 })).toBeNull();
    expect(transcriptIfConfident({ transcript: "  ", confidence: 0.9 })).toBeNull();
  });

  it("uses the configured threshold and accepts browsers without confidence scores", () => {
    expect(MIN_TRANSCRIPT_CONFIDENCE).toBe(0.55);
    expect(transcriptIfConfident({ transcript: "clear", confidence: 0.55 })).toBe("clear");
    expect(transcriptIfConfident({ transcript: "speech" })).toBe("speech");
  });
});

describe("createSpeechRecognition", () => {
  it("safely constructs standard and prefixed browser APIs", () => {
    expect(createSpeechRecognition({ SpeechRecognition: MockRecognition })).toBeInstanceOf(
      MockRecognition,
    );
    expect(createSpeechRecognition({ webkitSpeechRecognition: MockRecognition })).toBeInstanceOf(
      MockRecognition,
    );
  });

  it("returns null when the API is missing or not constructible", () => {
    expect(createSpeechRecognition({})).toBeNull();
    expect(createSpeechRecognition({ SpeechRecognition: "unavailable" })).toBeNull();
  });

  it("catches an illegal standard constructor and falls back to WebKit", () => {
    class IllegalConstructor {
      constructor() {
        throw new TypeError("Illegal constructor");
      }
    }
    const warn = vi.fn();
    const recognition = createSpeechRecognition(
      { SpeechRecognition: IllegalConstructor, webkitSpeechRecognition: MockRecognition },
      warn,
    );
    expect(recognition).toBeInstanceOf(MockRecognition);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("treats throwing browser feature getters as unsupported", () => {
    const environment = Object.defineProperty({}, "SpeechRecognition", {
      get() {
        throw new Error("restricted browser host object");
      },
    });
    expect(createSpeechRecognition(environment)).toBeNull();
  });

  it("warns and returns null when every available constructor throws", () => {
    class IllegalConstructor {
      constructor() {
        throw new TypeError("Illegal constructor");
      }
    }
    const warn = vi.fn();
    expect(
      createSpeechRecognition(
        { SpeechRecognition: IllegalConstructor, webkitSpeechRecognition: IllegalConstructor },
        warn,
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
