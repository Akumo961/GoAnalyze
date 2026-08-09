import { AlertTriangle, CheckCircle2, FileSearch, ShieldCheck, Workflow } from "lucide-react";

const queues = [
  { name: "Admissibility", count: 42, sla: "91%" },
  { name: "Technical review", count: 118, sla: "86%" },
  { name: "Legal review", count: 17, sla: "94%" },
  { name: "Awaiting information", count: 63, sla: "78%" }
];

const findings = [
  "12 cases require missing-document requests",
  "7 protected records accessed under legal-review purpose",
  "4 high-risk discharge applications escalated"
];

export default function Page() {
  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Ministry document intelligence</p>
          <h1>GoAnalyze Government</h1>
        </div>
        <button className="iconButton" aria-label="Security posture">
          <ShieldCheck size={22} />
        </button>
        <a className="setupLink" href="/setup">
          Configuration Wizard
        </a>
      </header>

      <section className="summaryGrid">
        <article>
          <FileSearch />
          <span>Documents today</span>
          <strong>104,382</strong>
        </article>
        <article>
          <Workflow />
          <span>Active cases</span>
          <strong>2,418</strong>
        </article>
        <article>
          <CheckCircle2 />
          <span>Grounded AI answers</span>
          <strong>98.7%</strong>
        </article>
        <article>
          <AlertTriangle />
          <span>SLA risk</span>
          <strong>23</strong>
        </article>
      </section>

      <section className="workSurface">
        <div>
          <h2>Review Queues</h2>
          <div className="queueList">
            {queues.map((queue) => (
              <article key={queue.name} className="queueRow">
                <span>{queue.name}</span>
                <strong>{queue.count}</strong>
                <meter min="0" max="100" value={Number(queue.sla.replace("%", ""))} />
                <small>{queue.sla} SLA</small>
              </article>
            ))}
          </div>
        </div>
        <aside>
          <h2>Operational Signals</h2>
          {findings.map((finding) => (
            <p key={finding}>{finding}</p>
          ))}
        </aside>
      </section>
    </main>
  );
}

