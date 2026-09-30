import type { ReactNode } from "react";

// The avatar + title header from the prototype.
export default function Header({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="header">
      <div className="avatar">&#10022;</div>
      <div className="header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
}
