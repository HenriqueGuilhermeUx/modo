import { useEffect, useState } from "react";
import "./UsLanding.css";

type Task = { id: number; title: string; channel: string; status: "Draft" | "Approved" };
const initialTasks: Task[] = [
  { id: 1, title: "Introduce our new service", channel: "Instagram", status: "Draft" },
  { id: 2, title: "Share a customer story", channel: "LinkedIn", status: "Draft" },
  { id: 3, title: "Plan next week's campaign", channel: "Campaign", status: "Approved" },
];

/** English-only interactive product walkthrough. All content stays in browser memory. */
export default function UsWorkspace() {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filter, setFilter] = useState<"All" | "Draft" | "Approved">("All");
  const [title, setTitle] = useState("");
  useEffect(() => {
    const originalLang = document.documentElement.lang;
    const originalTitle = document.title;
    document.documentElement.lang = "en-US";
    document.title = "MODO USA | Interactive workspace walkthrough";
    return () => { document.documentElement.lang = originalLang; document.title = originalTitle; };
  }, []);
  const shown = tasks.filter(task => filter === "All" || task.status === filter);
  const pending = tasks.filter(task => task.status === "Draft").length;
  return (
    <div className="av-us-landing av-us-demo">
      <header className="av-us-header"><a href="/us" className="av-us-brand"><img src="/logo.svg" alt="MODO" /><span>USA walkthrough</span></a><nav><a href="/us">Product overview</a><a href="/us/smartbots">SmartBots</a></nav></header>
      <main className="av-us-section">
        <p className="av-us-eyebrow">Interactive product experience · Sample data</p>
        <h1>Organize work before you publish.</h1>
        <p className="av-us-intro">Explore how a marketing workspace can manage creative drafts, review and approvals in US English. Every action below is local to this preview — nothing is sent, published, saved to an account or charged.</p>
        <section aria-label="Sample marketing performance" className="av-us-feature-grid">
          <article><span className="av-us-number">WORK ITEMS</span><h3>{tasks.length}</h3><p>Sample tasks in this session</p></article>
          <article><span className="av-us-number">NEEDS REVIEW</span><h3>{pending}</h3><p>Drafts awaiting your review</p></article>
          <article><span className="av-us-number">APPROVED</span><h3>{tasks.length - pending}</h3><p>Demo approvals only</p></article>
        </section>
        <div className="av-us-demo-panel">
          <h2>Marketing work queue</h2>
          <form onSubmit={event => { event.preventDefault(); const trimmed = title.trim(); if (!trimmed) return; setTasks(current => [...current, { id: Math.max(0, ...current.map(item => item.id)) + 1, title: trimmed, channel: "Manual", status: "Draft" }]); setTitle(""); }}>
            <label htmlFor="demo-task">New content idea</label>
            <div className="av-us-demo-actions"><input id="demo-task" value={title} maxLength={90} placeholder="e.g. Announce a new product" onChange={event => setTitle(event.target.value)}/><button className="av-us-primary" type="submit" disabled={!title.trim()}>Add idea</button></div>
          </form>
          <div className="av-us-demo-filters" aria-label="Task status filter">{(["All","Draft","Approved"] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div>
          <div className="av-us-demo-list">{shown.length ? shown.map(task => <article key={task.id}><div><small>{task.channel} · {task.status}</small><strong>{task.title}</strong></div><button type="button" onClick={() => setTasks(current => current.map(item => item.id === task.id ? { ...item, status: item.status === "Draft" ? "Approved" : "Draft" } : item))}>{task.status === "Draft" ? "Approve sample" : "Return to draft"}</button></article>) : <p>No sample items match this filter.</p>}</div>
          <button type="button" className="av-us-demo-reset" onClick={() => { setTasks(initialTasks); setFilter("All"); setTitle(""); }}>Reset walkthrough</button>
        </div>
        <p className="av-us-preview-note">This is an English interaction prototype, not the authenticated Brazilian MODO application. US integration, pricing, publisher access and onboarding remain disabled.</p>
      </main>
    </div>
  );
}
