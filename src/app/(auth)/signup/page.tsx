import { signup } from "@/app/actions/auth";
import AuthForm from "@/components/AuthForm";
import Header from "@/components/Header";

export const metadata = { title: "Sign up · Internal Constraint" };

export default function SignupPage() {
  return (
    <>
      <Header title="Internal constraint diagnostic" subtitle="Create your account" />
      <AuthForm mode="signup" action={signup} />
    </>
  );
}
