"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import type { UI_TEXT } from "@/lib/diagnostic/v2/prompts";
import type { ArchitectReport as Report } from "@/lib/diagnostic/v2/schema";

interface Props {
  report: Omit<Report, "hidden_tie">;
  /** The section labels from the config. They replace the stored names, so earlier reports show the current labels. */
  sectionNames: string[];
  /** A reaction came back with the crisis flag: the support line shows on the first card. */
  crisis: boolean;
  text: typeof UI_TEXT;
}

/** One section: its cards side by side, swiped (or scrolled) one at a time. */
function CardTrack({ cards, supportLine }: { cards: string[]; supportLine: string | null }) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  return (
    <>
      <div
        className="card-track"
        ref={track}
        onScroll={(e) => setActive(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}
      >
        {cards.map((c, i) => (
          <div key={i} className="report-card">
            <p>{c}</p>
            {i === 0 && supportLine && <p className="support-line">{supportLine}</p>}
          </div>
        ))}
      </div>
      {cards.length > 1 && (
        <div className="card-dots">
          {cards.map((_, i) => (
            <button key={i} aria-label={"Card " + (i + 1)} className={i === active ? "dot active" : "dot"} onClick={() => go(i)} />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The Architect report: four sections of three swipeable cards, a Continue
 * button between sections, then the old pattern next to the new one.
 */
export default function ArchitectReport({ report, sectionNames, crisis, text }: Props) {
  const [section, setSection] = useState(0);
  const sections = report.sections.map((s, i) => ({ name: sectionNames[i] ?? s.name, cards: s.cards.filter((c) => c.trim()) }));
  const finalScreen = section >= sections.length;

  return (
    <div className="architect-report">
      <div className="section-steps muted small">
        {sections.map((s, i) => (
          <span key={i} className={i === section ? "current" : ""}>{s.name}</span>
        ))}
      </div>

      {!finalScreen ? (
        <>
          <h2 className="report-section-name">{sections[section].name}</h2>
          <CardTrack
            key={section}
            cards={sections[section].cards}
            supportLine={crisis && section === 0 ? text.supportLine : null}
          />
          <div className="report-nav">
            {section > 0 ? <button onClick={() => setSection(section - 1)}>Back</button> : <span />}
            <button className="primary" onClick={() => setSection(section + 1)}>{text.continue}</button>
          </div>
        </>
      ) : (
        <>
          <div className="pattern-columns">
            <div className="pattern-col old">
              <h3>{text.oldPattern}</h3>
              <ul>{report.old_bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
            <div className="pattern-col new">
              <h3>{text.newPattern}</h3>
              <ul>{report.new_bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
          </div>
          <div className="report-nav">
            <button onClick={() => setSection(sections.length - 1)}>Back</button>
            <Link href="/dashboard" className="button primary">{text.startBuilding}</Link>
          </div>
        </>
      )}
    </div>
  );
}
