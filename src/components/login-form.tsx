import { useState, type FormEvent } from "react";
import { signIn, signInWithRedirect } from "aws-amplify/auth";
import { Bot, Building2, Cloud, LoaderCircle, LockKeyhole } from "lucide-react";
import type { RuntimeConfig } from "@/config";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function LoginForm({ config, onAuthenticated }: { config: RuntimeConfig; onAuthenticated: () => void }) {
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await signIn({ username: String(form.get("loginId")), password: String(form.get("password")) });
      if (!result.isSignedIn) throw new Error(`追加の認証手順が必要です: ${result.nextStep.signInStep}`);
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ログインに失敗しました。");
      setSubmitting(false);
    }
  }

  async function signInWithEntra() {
    if (!config.auth.entraEnabled || !config.auth.entraProviderName) throw new Error("Entra IDログインは有効ではありません");
    setError(undefined);
    try {
      await signInWithRedirect({ provider: { custom: config.auth.entraProviderName } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Microsoftでログインできませんでした");
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_top,var(--color-accent),transparent_55%)] p-4">
      <section className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-xl shadow-black/5 sm:p-8" aria-labelledby="login-title">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-agent text-white"><Bot className="size-6" /></span>
          <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-agent">Workmate</p><h1 id="login-title" className="text-xl font-semibold">アカウントにログイン</h1></div>
        </div>
        {config.auth.entraEnabled && (
          <><Button type="button" variant="outline" className="h-11 w-full" onClick={() => void signInWithEntra()}><Building2 className="size-4" />Microsoftで続ける</Button><div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />または<span className="h-px flex-1 bg-border" /></div></>
        )}
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2"><label htmlFor="login-id" className="text-sm font-medium">メールアドレス</label><Input id="login-id" name="loginId" type="email" autoComplete="username" required maxLength={256} disabled={submitting} /></div>
          <div className="space-y-2"><label htmlFor="password" className="text-sm font-medium">パスワード</label><Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256} disabled={submitting} /></div>
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="h-11 w-full" disabled={submitting}>{submitting ? <LoaderCircle className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />}{submitting ? "認証中…" : "ログイン"}</Button>
        </form>
        <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Cloud className="mt-0.5 size-4 shrink-0" />Amazon Cognitoで認証し、ブラウザからAgentCore Runtimeへ直接接続します。</p>
      </section>
    </main>
  );
}
