"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import * as z from "zod";

import { createSession, destroySession } from "@/lib/auth";
import { db } from "@/lib/db";

export type AuthFormState = { error?: string; email?: string } | undefined;

const SignupSchema = z.object({
  name: z.string().trim().max(80).optional(),
  email: z.email({ error: "Please enter a valid email." }).trim().toLowerCase(),
  password: z.string().min(8, { error: "Password must be at least 8 characters." }).max(200),
});

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
});

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = SignupSchema.safeParse({
    name: formData.get("name") || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input.", email };

  const existing = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) return { error: "An account with that email already exists.", email };

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const user = await db.user.create({
    data: { email: parsed.data.email, name: parsed.data.name || null, passwordHash },
  });
  await createSession(user.id);
  redirect("/dashboard");
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const email = String(formData.get("email") ?? "");
  if (!parsed.success) return { error: "Enter your email and password.", email };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  const ok = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
  if (!user || !ok) return { error: "Incorrect email or password.", email };

  await createSession(user.id);
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
