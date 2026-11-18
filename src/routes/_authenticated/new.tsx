import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Mic, Sparkles, Loader2 } from "lucide-react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { createDraftFromNote } from "@/lib/reports.functions";
import { toast } from "sonner";
import {
  clientDraftKeyForSubmit,
  generateClientDraftId,
  nextClientDraftKeyAfterSuccess,
} from "@/lib/draft-idempotency";
import {
  appendTranscript,
  createSpeechRecognition,
  transcriptIfConfident,
  type SpeechRecognitionEnvironment,
  type SpeechRecognitionLike,
} from "@/lib/voice-dictation";

export const Route = createFileRoute("/_authenticated/new")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "New call report — FieldIQ Pharma" },
      {
        name: "description",
        content: "Describe your doctor visit and let AI draft the call report.",
      },
      { property: "og:title", content: "New call report — FieldIQ Pharma" },
      {
        property: "og:description",
        content: "Describe your doctor visit and let AI draft the call report.",
      },
    ],
  }),
  component: NewCall,
});

const EXAMPLE =
  "Met Dr Sharma today at 11:15 at Heartline Clinic. Discussed Cardiovex for hypertensive patients. She asked about combination with diuretics. Requested the latest clinical summary. Follow up next Friday with the summary.";

function detachRecognitionHandlers(recognition: SpeechRecognitionLike) {
  try {
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
  } catch {
    // Some browser implementations can reject handler changes while shutting down.
  }
}

function NewCall() {
  const [note, setNote] = useState("");
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [voiceSupportChecked, setVoiceSupportChecked] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState(false);
  const [clientDraftId, setClientDraftId] = useState(() => generateClientDraftId());
  const lastSubmittedNote = useRef<string | null>(null);
  const noteRef = useRef(note);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const preparedRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const dictationRequestedRef = useRef(false);
  const mountedRef = useRef(false);
  const pending = useRef(false);
  const create = useServerFn(createDraftFromNote);
  const nav = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    mountedRef.current = true;
    if (typeof window !== "undefined") {
      const prepared = createSpeechRecognition(window as unknown as SpeechRecognitionEnvironment);
      if (prepared) {
        preparedRecognitionRef.current = prepared;
        setVoiceAvailable(true);
      }
    }
    setVoiceSupportChecked(true);
    return () => {
      mountedRef.current = false;
      dictationRequestedRef.current = false;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      const prepared = preparedRecognitionRef.current;
      preparedRecognitionRef.current = null;
      for (const instance of [recognition, prepared]) {
        if (!instance) continue;
        detachRecognitionHandlers(instance);
        try {
          instance.abort();
        } catch {
          // The browser may already have ended or disposed of this recognition session.
        }
      }
    };
  }, []);

  function toggleVoiceInput() {
    const currentRecognition = recognitionRef.current;
    if (currentRecognition) {
      dictationRequestedRef.current = false;
      setVoiceMessage("Finishing voice input…");
      try {
        currentRecognition.stop();
      } catch {
        recognitionRef.current = null;
        detachRecognitionHandlers(currentRecognition);
        setVoiceActive(false);
        setVoiceMessage("Voice input stopped. You can continue typing your note.");
      }
      return;
    }
    let recognition: SpeechRecognitionLike | null = preparedRecognitionRef.current;
    preparedRecognitionRef.current = null;
    try {
      if (!recognition && typeof window !== "undefined") {
        recognition = createSpeechRecognition(window as unknown as SpeechRecognitionEnvironment);
      }
      if (!recognition) {
        setVoiceAvailable(false);
        setVoiceMessage(
          "Voice dictation is not available in this browser. You can type your note instead.",
        );
        return;
      }
      const instance = recognition;
      instance.lang = "en-IN";
      instance.interimResults = true;
      instance.continuous = true;
      instance.maxAlternatives = 1;
      instance.onresult = (event) => {
        if (!mountedRef.current || recognitionRef.current !== instance) return;
        let updated = noteRef.current;
        let skippedUnclearSpeech = false;
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          if (result?.isFinal) {
            const alternative = result[0];
            const transcript = transcriptIfConfident(alternative);
            if (!transcript) {
              skippedUnclearSpeech ||= !!alternative?.transcript.trim();
              continue;
            }
            const appended = appendTranscript(updated, transcript);
            if (appended.length > 5000) {
              setVoiceMessage("The note reached 5,000 characters. Edit it before adding more.");
              continue;
            }
            updated = appended;
          }
        }
        if (updated !== noteRef.current) {
          noteRef.current = updated;
          setNote(updated);
        }
        if (skippedUnclearSpeech) {
          setVoiceMessage(
            "Some unclear speech was skipped. Speak clearly or edit the note as needed.",
          );
        }
      };
      instance.onerror = (event) => {
        if (!mountedRef.current || recognitionRef.current !== instance) return;
        if (event.error === "no-speech" && dictationRequestedRef.current) {
          setVoiceMessage(
            "No clear speech detected; still listening. You can continue when ready.",
          );
          return;
        }
        const message =
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "Microphone access was not allowed. Check your browser permission and try again."
            : "Voice input stopped. You can continue typing your note.";
        recognitionRef.current = null;
        dictationRequestedRef.current = false;
        detachRecognitionHandlers(instance);
        try {
          instance.abort();
        } catch {
          // The recognition service may already have ended after reporting an error.
        }
        setVoiceMessage(message);
        setVoiceActive(false);
      };
      instance.onend = () => {
        if (!mountedRef.current || recognitionRef.current !== instance) return;
        if (dictationRequestedRef.current) {
          try {
            instance.start();
            setVoiceMessage(
              "Listening… pause whenever you need; tap Stop voice input when finished.",
            );
            return;
          } catch {
            setVoiceMessage("Voice input paused unexpectedly. Tap to restart or continue typing.");
          }
        }
        recognitionRef.current = null;
        dictationRequestedRef.current = false;
        detachRecognitionHandlers(instance);
        setVoiceActive(false);
      };
      recognitionRef.current = instance;
      dictationRequestedRef.current = true;
      setVoiceMessage("Listening… speak your note, then review and edit it below.");
      instance.start();
      setVoiceActive(true);
    } catch {
      dictationRequestedRef.current = false;
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      if (recognition) {
        detachRecognitionHandlers(recognition);
        try {
          recognition.abort();
        } catch {
          // The browser may have rejected construction or start before a session existed.
        }
      }
      setVoiceAvailable(false);
      setVoiceActive(false);
      setVoiceMessage("Voice input could not start. You can continue typing your note.");
    }
  }

  async function submit() {
    if (pending.current) return;
    const requestKey = clientDraftKeyForSubmit(note, lastSubmittedNote.current, clientDraftId);
    if (requestKey !== clientDraftId) setClientDraftId(requestKey);
    lastSubmittedNote.current = note;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    setInProgress(false);
    setSlow(false);
    const slowTimer = window.setTimeout(() => setSlow(true), 8_000);
    try {
      const result = await create({ data: { note, clientDraftId: requestKey } });
      if (result.status === "done") {
        if (result.reused) toast.info("Opened your existing draft.");
        setClientDraftId(nextClientDraftKeyAfterSuccess());
        lastSubmittedNote.current = null;
        qc.invalidateQueries();
        nav({ to: "/review/$id", params: { id: result.id } });
        return;
      }
      if (result.status === "in_progress") {
        setInProgress(true);
        return;
      }
      if (result.error.kind === "key_reuse_conflict") {
        setClientDraftId(generateClientDraftId());
        lastSubmittedNote.current = note;
      }
      setFailure(result.error.message);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      setFailure(
        message === "Notes must be 5,000 characters or fewer."
          ? message
          : "The draft could not be created. Your note is safe; please retry.",
      );
    } finally {
      window.clearTimeout(slowTimer);
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="New call report"
        subtitle="Describe the visit in your own words. No patient details."
      />
      <textarea
        value={note}
        onChange={(e) => {
          noteRef.current = e.target.value;
          setNote(e.target.value);
          if (e.target.value !== lastSubmittedNote.current) setInProgress(false);
        }}
        rows={9}
        maxLength={5000}
        disabled={busy}
        placeholder="Who you met, when, products discussed, what the doctor said, materials requested, next step…"
        className="w-full rounded-2xl border bg-card p-4 text-base shadow-card outline-none focus:ring-2 focus:ring-ring"
      />
      <div className="mt-3 grid grid-cols-2 gap-3">
        {voiceAvailable && (
          <Button
            variant="outline"
            className="h-14 rounded-2xl text-base"
            disabled={busy}
            aria-pressed={voiceActive}
            onClick={toggleVoiceInput}
          >
            <Mic className="h-5 w-5" /> {voiceActive ? "Stop voice input" : "Start voice input"}
          </Button>
        )}
        <Button
          variant="outline"
          className="h-14 rounded-2xl text-base"
          disabled={busy || voiceActive}
          onClick={() => {
            noteRef.current = EXAMPLE;
            setNote(EXAMPLE);
          }}
        >
          Use example
        </Button>
      </div>
      {voiceAvailable && (
        <>
          <p className="mt-3 rounded-xl border bg-card p-3 text-xs text-muted-foreground">
            Browser dictation may send audio to the browser vendor’s speech service. Microphone
            access requires HTTPS or localhost; it will not work at http://192.168.x.x.
          </p>
          {voiceMessage && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {voiceMessage}
            </p>
          )}
        </>
      )}
      {voiceSupportChecked && !voiceAvailable && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Voice dictation is not available in this browser. You can type your note instead.
        </p>
      )}
      <Button
        className="mt-3 h-14 w-full rounded-2xl text-base"
        disabled={busy || voiceActive || inProgress || note.trim().length < 10}
        onClick={submit}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        {busy ? "Reading your note…" : "Create draft"}
      </Button>
      {busy && slow && (
        <p role="status" className="mt-3 text-center text-sm text-muted-foreground">
          Still working, the AI service is slow right now.
        </p>
      )}
      {inProgress && !busy && (
        <div role="status" className="mt-3 rounded-xl border bg-card p-4 text-sm">
          <p>This note is already being processed.</p>
          <Button className="mt-3 min-h-11 w-full" disabled={busy} onClick={submit}>
            Check again
          </Button>
        </div>
      )}
      {failure && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-destructive/30 bg-card p-4 text-sm"
        >
          <p>{failure}</p>
          <Button
            className="mt-3 min-h-11 w-full"
            disabled={busy || note.trim().length < 10}
            onClick={submit}
          >
            Retry
          </Button>
        </div>
      )}
      <p className="mt-3 text-center text-xs text-muted-foreground">
        AI only uses what you wrote. Anything missing is marked unknown for you to confirm.
      </p>
    </AppShell>
  );
}
