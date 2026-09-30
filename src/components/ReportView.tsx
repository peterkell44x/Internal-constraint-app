// The profile report, laid out like the prototype: narrative, then the
// constraint block, then the counter belief block.

interface Props {
  reportTitle: string;
  report: { narrative: string; constraint: string; counterBelief: string };
  completedAt: string | null;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

export default function ReportView({ reportTitle, report, completedAt }: Props) {
  return (
    <div className="report">
      <h2>
        Your {reportTitle} profile
        {completedAt && <span className="muted small"> · {dateFmt.format(new Date(completedAt))}</span>}
      </h2>
      <div>{report.narrative}</div>
      {report.constraint && (
        <div className="constraint-block">
          <p className="block-label">The constraint</p>
          {report.constraint}
        </div>
      )}
      {report.counterBelief && (
        <div className="solution-block">
          <p className="block-label">The counter belief</p>
          {report.counterBelief}
        </div>
      )}
    </div>
  );
}
