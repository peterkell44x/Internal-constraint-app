"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { AuthFormState } from "@/app/actions/auth";

interface Props {
  mode: "login" | "signup";
  /** Show the sign-up passcode field. */
  requirePasscode?: boolean;
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}

export default function AuthForm({ mode, action, requirePasscode = false }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="card auth-form">
      {isSignup && (
        <label>
          Name <span className="muted">(optional)</span>
          <input name="name" type="text" autoComplete="name" />
        </label>
      )}
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required defaultValue={state?.email} />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          minLength={isSignup ? 8 : undefined}
          required
        />
      </label>
      {isSignup && requirePasscode && (
        <label>
          Sign-up passcode
          <input name="passcode" type="password" autoComplete="off" required />
        </label>
      )}
      {state?.error && <p className="form-error">{state.error}</p>}
      <button type="submit" className="primary" disabled={pending}>
        {pending ? "One moment..." : isSignup ? "Create account" : "Log in"}
      </button>
      <p className="muted small">
        {isSignup ? (
          <>Already have an account? <Link href="/login">Log in</Link></>
        ) : (
          <>New here? <Link href="/signup">Create an account</Link></>
        )}
      </p>
    </form>
  );
}
