import Link from "next/link";

import { logout } from "@/app/actions/auth";

export default function AppNav({ email }: { email: string }) {
  return (
    <nav className="app-nav">
      <Link href="/dashboard">My reports</Link>
      <span className="app-nav-right">
        <span className="muted small">{email}</span>
        <form action={logout}>
          <button type="submit" className="small-btn">Log out</button>
        </form>
      </span>
    </nav>
  );
}
