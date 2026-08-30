"use client";

import { LoaderCircle, LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authErrorMessage, passwordSchema } from "@/lib/auth/credentials";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validPassword = passwordSchema.safeParse(password);
    if (!validPassword.success) {
      setMessage(validPassword.error.issues[0]?.message ?? "请输入有效密码。");
      return;
    }
    if (password !== confirmation) {
      setMessage("两次输入的密码不一致。");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({
        password: validPassword.data,
      });
      if (error) throw error;
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error &&
          error.message.toLowerCase().includes("session")
          ? "密码设置链接已失效，请返回登录页重新发送。"
          : authErrorMessage(error instanceof Error ? error.message : ""),
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="reset-title">
        <div className="brand-lockup compact">
          <span className="brand-mark">N</span>
          <span>Neurons</span>
        </div>
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1 id="reset-title">设置新密码</h1>
        <p className="muted">设置完成后会保持当前账户登录，并返回你的项目。</p>
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="new-password">新密码</label>
          <div className="input-shell">
            <LockKeyhole size={17} aria-hidden="true" />
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <label htmlFor="new-password-confirmation">确认新密码</label>
          <div className="input-shell">
            <LockKeyhole size={17} aria-hidden="true" />
            <input
              id="new-password-confirmation"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={72}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          <button className="primary-button" disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={17} /> : null}
            保存新密码
          </button>
        </form>
        {message ? <p className="form-message error">{message}</p> : null}
      </section>
    </main>
  );
}
