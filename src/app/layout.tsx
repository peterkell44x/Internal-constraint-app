import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Internal Constraint",
  description: "Find the subconscious belief running underneath the part of your life that feels stuck.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
