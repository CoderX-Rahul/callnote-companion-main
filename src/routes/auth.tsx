import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lovable } from "@/integrations/lovable";
import { supabase } from "@/integrations/supabase/client";
import { getMasterData } from "@/lib/reports.functions";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Sign in — FieldIQ Pharma" },
    { name: "description", content: "Sign in to your FieldIQ Pharma demo reporting workspace." },
    { property: "og:title", content: "Sign in — FieldIQ Pharma" },
    { property: "og:description", content: "Sign in to your FieldIQ Pharma demo reporting workspace." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: SignIn,
});

export function SignIn() {
  const navigate = useNavigate();
  const verify = useServerFn(getMasterData);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [devError, setDevError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLocalDev, setIsLocalDev] = useState(false);
  useEffect(() => {
    setIsLocalDev(import.meta.env.DEV && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"));
  }, []);
  useEffect(() => {
    let active = true;
    async function check() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      try {
        await verify();
        if (active) await navigate({ to: "/", replace: true });
      } catch {
        if (active) setError("Your account is not provisioned for this workspace. Contact your administrator.");
      }
    }
    void check();
    return () => { active = false; };
  }, [navigate, verify]);

  async function signIn(provider: "google" | "lovable") {
    setBusy(true); setError("");
    setDevError("");
    try {
      const result = await lovable.auth.signInWithOAuth(provider, { redirect_uri: `${window.location.origin}/auth` });
      if (result.error) throw result.error;
      if (result.redirected) return;
      await verify();
      await navigate({ to: "/", replace: true });
    } catch {
      setError("Sign-in could not be completed, or your account is not provisioned. Contact your administrator.");
    } finally { setBusy(false); }
  }

  const signInWithPassword = import.meta.env.DEV ? async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setDevError("");
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      try {
        await verify();
      } catch (cause) {
        setError("Your account is not provisioned for this workspace. Contact your administrator.");
        setDevError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
      await navigate({ to: "/", replace: true });
    } catch (cause) {
      setError("Sign-in could not be completed, or your account is not provisioned. Contact your administrator.");
      setDevError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  } : undefined;

  return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6">
    <h1 className="font-display text-3xl font-semibold">FieldIQ Pharma</h1>
    <p className="text-muted-foreground">Demo MR · Sign in</p>
    <Button className="min-h-14 text-base" disabled={busy} onClick={() => signIn("google")}>Continue with Google</Button>
    <Button variant="outline" className="min-h-14 text-base" disabled={busy} onClick={() => signIn("lovable")}>Sign in with Lovable</Button>
    {import.meta.env.DEV && isLocalDev && <>
      <p className="text-center text-sm text-muted-foreground">Google and Lovable sign-in only work on the Lovable-hosted app. Use developer sign-in locally.</p>
      <form className="flex flex-col gap-3" onSubmit={signInWithPassword}>
        <h2 className="text-lg font-semibold">Developer sign-in</h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <Input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <Input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <Button type="submit" variant="outline" disabled={busy}>Sign in locally</Button>
      </form>
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {import.meta.env.DEV && devError && <p className="text-sm text-muted-foreground">Development detail: {devError}</p>}
    {error && <Button variant="ghost" onClick={async () => { await supabase.auth.signOut(); setError(""); }}>Use another account</Button>}
  </main>;
}
