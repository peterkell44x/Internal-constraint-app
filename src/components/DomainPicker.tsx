"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DomainKey } from "@/lib/diagnostic/domains";

interface Option {
  key: DomainKey;
  label: string;
  blurb: string;
}

export default function DomainPicker({ options }: { options: Option[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(domain: DomainKey) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start.");
      router.push("/diagnostic/" + data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start.");
      setPending(false);
    }
  }

  return (
    <div className="card">
      <p className="prompt">Which part of your life do you want to diagnose right now?</p>
      <div className="domain-grid">
        {options.map((o) => (
          <button key={o.key} className="domain-btn" disabled={pending} onClick={() => choose(o.key)}>
            {o.label}
            <span>{o.blurb}</span>
          </button>
        ))}
      </div>
      {error && <p className="form-error" style={{ marginTop: 14 }}>{error}</p>}
    </div>
  );
}
