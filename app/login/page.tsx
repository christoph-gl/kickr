"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  // Only follow same-site paths, never "//other.host".
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Login failed");
      }
      window.location.assign(nextPath());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md border bg-card p-6 shadow-sm"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">iamnotadoctor</h1>
          <p className="text-sm text-muted-foreground">
            Enter the access token (<code className="font-mono text-xs">APP_AUTH_TOKEN</code>) from the server&apos;s
            <code className="font-mono text-xs"> .env.local</code>. This browser stays signed in for 30 days.
          </p>
        </div>
        <input
          type="password"
          autoComplete="current-password"
          aria-label="Access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={!token.trim() || isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
