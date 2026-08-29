"use client";

import { ArrowLeft, LoaderCircle, Mail } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setState("sent");
      setMessage("登录链接已发送，请检查邮箱。此页面可以保持打开。 ");
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error && error.message === "SUPABASE_CONFIGURATION_MISSING"
          ? "Supabase 登录配置尚未完成。"
          : "登录链接发送失败，请稍后重试。",
      );
    }
  }

  return (
    <main className="auth-page">
      <Link className="text-button auth-back" href="/dashboard">
        <ArrowLeft size={16} /> 返回
      </Link>
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand-lockup compact">
          <span className="brand-mark">N</span>
          <span>Neurons</span>
        </div>
        <p className="eyebrow">YOUR BUILD SPACE</p>
        <h1 id="login-title">继续你的项目</h1>
        <p className="muted">输入邮箱，我们会发送一个安全登录链接。</p>
        <form onSubmit={submit} className="auth-form">
          <label htmlFor="email">邮箱</label>
          <div className="input-shell">
            <Mail size={17} aria-hidden="true" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <button className="primary-button" disabled={state === "sending" || state === "sent"}>
            {state === "sending" ? <LoaderCircle className="spin" size={17} /> : null}
            {state === "sent" ? "已发送" : "发送登录链接"}
          </button>
        </form>
        {message ? <p className={`form-message ${state}`}>{message}</p> : null}
      </section>
    </main>
  );
}
