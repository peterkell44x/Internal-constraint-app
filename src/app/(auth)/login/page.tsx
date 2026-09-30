import { login } from "@/app/actions/auth";
import AuthForm from "@/components/AuthForm";
import Header from "@/components/Header";

export const metadata = { title: "Log in · Internal Constraint" };

export default function LoginPage() {
  return (
    <>
      <Header title="Internal constraint diagnostic" subtitle="Log in to continue" />
      <AuthForm mode="login" action={login} />
    </>
  );
}
