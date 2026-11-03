"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { appPath } from "@/lib/base-path";
import type { ReportBody } from "@/lib/knowledge-types";

type History = { jobId: string; state: "queued" | "running" | "ready" | "failed"; reportId: string | null; startDate: string; endDate: string; language: "en" | "zh-CN"; createdAt: string; errorCode: string | null; attempts: number };
type SavedReport = { id: string; markdown: string; report: ReportBody; startDate: string; endDate: string; language: "en" | "zh-CN"; createdAt: string };
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const r = await fetch(appPath(path), { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message ?? "The request failed. Try again.");
  return data;
}
const labels = { queued: "Queued", running: "Generating", ready: "Ready", failed: "Failed" };
function generationDate(date: string) { return new Intl.DateTimeFormat("en-MY", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" }).format(new Date(date)); }
export default function ReportsView({ defaults }: { defaults: { startDate: string; endDate: string } }) {
  const [startDate, setStartDate] = useState(defaults.startDate), [endDate, setEndDate] = useState(defaults.endDate);
  const [language, setLanguage] = useState<"en" | "zh-CN">("en");
  const [history, setHistory] = useState<History[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<SavedReport | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [copied, setCopied] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const loadHistory = useCallback(async () => {
    const result = await request<{ history: History[]; nextOffset: number | null }>("/api/reports");
    setHistory((old) => [...result.history, ...old.filter((h) => !result.history.some((n) => n.jobId === h.jobId))]);
    setHasMore(result.nextOffset !== null);
    setSelected((old) => old ?? result.history[0]?.jobId ?? null);
    setLoading(false);
  }, []);
  useEffect(() => {
    request<{ history: History[]; nextOffset: number | null }>("/api/reports").then((result) => {
      setHistory(result.history); setHasMore(result.nextOffset !== null); setSelected(result.history[0]?.jobId ?? null); setLoading(false);
    }).catch((e) => { setError(e.message); setLoading(false); });
  }, []);
  const active = history.find((h) => h.jobId === selected);
  useEffect(() => {
    if (!history.some((h) => h.state === "queued" || h.state === "running")) return;
    const timer = setInterval(() => loadHistory().catch((e) => setError(e.message)), 3000);
    return () => clearInterval(timer);
  }, [history, loadHistory]);
  useEffect(() => {
    let cancelled = false;
    if (active?.state === "ready" && active.reportId) request<{ report: SavedReport }>(`/api/reports?reportId=${active.reportId}`).then((data) => { if (!cancelled) setReport(data.report); }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [active?.state, active?.reportId]);
  async function generate(values = { startDate, endDate, language }) {
    setBusy(true); setError("");
    const signature = JSON.stringify(values);
    if (!pending.current || pending.current.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    try {
      const job = await request<{ id: string }>("/api/reports", { method: "POST", body: JSON.stringify({ ...values, idempotencyKey: pending.current.key }) });
      pending.current = null; setSelected(job.id); setReport(null); await loadHistory();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function submit(event: FormEvent) { event.preventDefault(); await generate(); }
  async function older() {
    try {
      const data = await request<{ history: History[]; nextOffset: number | null }>(`/api/reports?offset=${history.length}`);
      setHistory((old) => [...old, ...data.history.filter((h) => !old.some((o) => o.jobId === h.jobId))]); setHasMore(data.nextOffset !== null);
    } catch (e) { setError((e as Error).message); }
  }
  const visibleReport = active?.state === "ready" && active.reportId === report?.id ? report : null;
  const zh = visibleReport?.language === "zh-CN";
  return <div className="reports-workspace">
    <form className="report-controls" onSubmit={submit}>
      <label>From<input type="date" value={startDate} max={endDate} required onChange={(e) => setStartDate(e.target.value)} /></label>
      <label>Through<input type="date" value={endDate} min={startDate} max={defaults.endDate} required onChange={(e) => setEndDate(e.target.value)} /></label>
      <label>Report language<select value={language} onChange={(e) => setLanguage(e.target.value as "en" | "zh-CN")}><option value="en">English</option><option value="zh-CN">简体中文</option></select></label>
      <button className="button button-primary" disabled={busy}>{busy ? "Submitting…" : "Generate report"}</button>
      <p className="report-timezone">Dates include the full day in Malaysia time.</p>
    </form>
    {error && <div className="alert alert-error no-print" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    <div className="report-layout">
      <aside className="report-history"><h2>Report history</h2>{loading ? <p className="muted" role="status">Loading saved reports…</p> : !history.length ? <p className="muted">Generated reports will appear here.</p> : <ol>{history.map((h) => <li key={h.jobId}><button className={selected === h.jobId ? "history-selected" : ""} onClick={() => { setSelected(h.jobId); setReport(null); }} aria-pressed={selected === h.jobId}><strong>{h.startDate} — {h.endDate}</strong><span>{h.language === "en" ? "English" : "简体中文"} · {generationDate(h.createdAt)}</span><span className={`job-state job-${h.state}`}>{labels[h.state]}</span></button></li>)}</ol>}{hasMore && <button className="button button-ghost" onClick={older}>Load older reports</button>}</aside>
      <section className="report-paper" aria-label="Selected report" aria-busy={active?.state === "running" || active?.state === "queued"}>
        {!active ? <div className="report-empty"><h2>Your team’s week, in one place</h2><p>Select a date range and generate a report. Work is grouped by project and employee, with missing submissions and external blockers made visible.</p><p className="muted">Reports reflect progress submitted through Codex.</p></div> : active.state === "failed" ? <div className="report-empty" role="alert"><h2>This report could not be generated</h2><p>No partial report was published. Your team’s submitted work is still saved.</p><p className="muted">{["REPORT_TOO_LARGE", "PROCESSING_INPUT_TOO_LARGE"].includes(active.errorCode ?? "") ? "Choose a shorter date range." : "The model may be unavailable or returned incomplete output."}</p><button className="button button-primary" disabled={busy} onClick={() => generate({ startDate: active.startDate, endDate: active.endDate, language: active.language })}>Retry report</button></div> : active.state !== "ready" ? <div className="report-empty" role="status"><h2>{active.state === "queued" ? "Your report is queued" : "Putting your team’s work together"}</h2><p>{active.startDate} — {active.endDate}</p><p className="muted">The report uses a saved snapshot. Your team can keep submitting updates.</p></div> : !visibleReport ? <p role="status">Opening report…</p> : <>
          <div className="report-document-actions no-print"><span>Saved {generationDate(visibleReport.createdAt)}</span><div className="button-row"><button className="button button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(visibleReport.markdown); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError("Copy was unavailable. Use Print to save this report instead."); } }}>{copied ? "Copied" : "Copy Markdown"}</button><button className="button button-secondary" onClick={() => window.print()}>Print</button></div></div>
          <article className="report-document" lang={zh ? "zh-CN" : "en"}><header><h2>{zh ? "工作报告" : "Work report"}</h2><p>{visibleReport.startDate} — {visibleReport.endDate}</p><p className="muted">{zh ? "所有项目与部门 · 马来西亚时间" : "All projects and departments · Malaysia time"}</p></header>
            {visibleReport.report.projects.map((project) => <section className="report-project" key={project.id}><h3>{project.name}</h3>{!project.employees.length && <p className="muted">{zh ? "此期间未提交工作进展。" : "No progress submitted in this period."}</p>}{project.employees.map((employee) => <div className="report-employee" key={employee.id}><h4>{employee.name}</h4><ul>{employee.bullets.map((b, i) => <li key={i}>{b.text}</li>)}</ul></div>)}</section>)}
            <section className="report-project"><h3>{zh ? "提交覆盖情况" : "Submission coverage"}</h3><p>{zh ? "未提交进展的项目" : "Projects without submissions"}: {visibleReport.report.coverage.projectsWithoutSubmissions.join(", ") || (zh ? "无" : "None")}</p><p>{zh ? "未提交进展的员工" : "Employees without submissions"}: {visibleReport.report.coverage.employeesWithoutSubmissions.join(", ") || (zh ? "无" : "None")}</p><p className="muted">{zh ? "未提交进展不代表未开展工作。" : "Missing submissions do not imply that no work was performed."}</p></section>
            <section className="report-project"><h3>{zh ? "外部阻碍" : "Blockers"}</h3>{!visibleReport.report.blockers.length ? <p>{zh ? "截至所选结束日期，没有报告尚未解决的外部阻碍。" : "No unresolved external blockers reported as of the selected end date."}</p> : <ul>{visibleReport.report.blockers.map((b, i) => <li key={i}><strong>{b.project} — {b.employees.join(", ")}</strong>: {b.summary}<br />{zh ? "外部相关方" : "Outside party"}: {b.outsideParty}. {zh ? "所需行动" : "Action needed"}: {b.actionNeeded}</li>)}</ul>}</section>
          </article>
        </>}
      </section>
    </div>
  </div>;
}
