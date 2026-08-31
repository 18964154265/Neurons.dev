"use client";

import { ArrowLeft, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  authCredentialsSchema,
  authErrorMessage,
  emailSchema,
} from "@/lib/auth/credentials";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createAppUrl } from "@/lib/urls/app-url";

type AuthMode = "login" | "register";
type FormState = "idle" | "submitting" | "sent" | "error";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setPassword("");
    setPasswordConfirmation("");
    setState("idle");
    setMessage("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const credentials = authCredentialsSchema.safeParse({ email, password });
    if (!credentials.success) {
      setState("error");
      setMessage(credentials.error.issues[0]?.message ?? "请检查邮箱和密码。");
      return;
    }
    if (mode === "register" && password !== passwordConfirmation) {
      setState("error");
      setMessage("两次输入的密码不一致。");
      return;
    }

    setState("submitting");
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword(
          credentials.data,
        );
        if (error) throw error;
        router.replace("/dashboard");
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        ...credentials.data,
        options: {
          emailRedirectTo: createAppUrl(
            "/auth/callback",
            window.location.origin,
          ),
        },
      });
      if (error) throw error;
      if (data.session) {
        router.replace("/dashboard");
        router.refresh();
        return;
      }
      setState("error");
      setMessage(
        "注册成功但未建立登录会话，请确认 Supabase 已关闭 Confirm Email 后重试。",
      );
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error &&
          error.message === "SUPABASE_CONFIGURATION_MISSING"
          ? "Supabase 登录配置尚未完成。"
          : authErrorMessage(error instanceof Error ? error.message : ""),
      );
    }
  }

  async function requestPasswordReset() {
    const validEmail = emailSchema.safeParse(email);
    if (!validEmail.success) {
      setState("error");
      setMessage(validEmail.error.issues[0]?.message ?? "请先输入邮箱。");
      return;
    }
    setState("submitting");
    setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        validEmail.data,
        {
          redirectTo: createAppUrl(
            "/auth/callback?next=/reset-password",
            window.location.origin,
          ),
        },
      );
      if (error) throw error;
      setState("sent");
      setMessage("如果该邮箱已注册，密码设置链接会发送到你的邮箱。");
    } catch (error) {
      setState("error");
      setMessage(authErrorMessage(error instanceof Error ? error.message : ""));
    }
  }

  const isSubmitting = state === "submitting";

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
        <h1 id="login-title">
          {mode === "login" ? "继续你的项目" : "创建你的账户"}
        </h1>
        <p className="muted">
          {mode === "login"
            ? "登录后会恢复同一账户下的项目、对话与运行记录。"
            : "使用邮箱和密码注册；根据项目配置，你可能需要先确认邮箱。"}
        </p>

        <div className="auth-mode-switch" role="tablist" aria-label="账户操作">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "active" : ""}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "register"}
            className={mode === "register" ? "active" : ""}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>

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
          <label htmlFor="password">密码</label>
          <div className="input-shell">
            <LockKeyhole size={17} aria-hidden="true" />
            <input
              id="password"
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength={8}
              maxLength={72}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 个字符"
            />
          </div>
          {mode === "register" ? (
            <>
              <label htmlFor="password-confirmation">确认密码</label>
              <div className="input-shell">
                <LockKeyhole size={17} aria-hidden="true" />
                <input
                  id="password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={72}
                  required
                  value={passwordConfirmation}
                  onChange={(event) =>
                    setPasswordConfirmation(event.target.value)
                  }
                  placeholder="再次输入密码"
                />
              </div>
            </>
          ) : null}
          <button
            className="primary-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? <LoaderCircle className="spin" size={17} /> : null}
            {mode === "login" ? "登录" : "注册"}
          </button>
        </form>

        {mode === "login" ? (
          <button
            type="button"
            className="auth-link-button"
            onClick={requestPasswordReset}
            disabled={isSubmitting}
          >
            忘记密码或从登录链接账户设置密码
          </button>
        ) : null}
        {message ? <p className={`form-message ${state}`}>{message}</p> : null}
      </section>
    </main>
  );
}
