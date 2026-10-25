import { useEffect, useState, type FormEvent } from "react";
import "./USWorkspace.css";

type Product = "modo" | "smartbots";
type Task = { id: number; title: string; detail: string; reviewed: boolean };
type Lead = { id: number; name: string; interest: string; stage: "New" | "Contacted" | "Follow-up" };

const sampleTasks: Task[] = [
  { id: 1, title: "Clarify your offer", detail: "Explain what the business does and who it serves.", reviewed: false },
  { id: 2, title: "Draft your first post", detail: "Choose a message and a call to action.", reviewed: false },
  { id: 3, title: "Review your campaign", detail: "Approve content before publishing or spending.", reviewed: false },
];
const sampleLeads: Lead[] = [
  { id: 1, name: "Sample: Jordan", interest: "Service package", stage: "New" },
  { id: 2, name: "Sample: Taylor", interest: "Consultation", stage: "Follow-up" },
];

function usePreviewMetadata(product: Product) {
  useEffect(() => {
    const previousLang = document.documentElement.lang;
    const previousTitle = document.title;
    const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const robots = existing || document.createElement("meta");
    const previousRobots = robots.content;
    if (!existing) { robots.name = "robots"; document.head.appendChild(robots); }
    document.documentElement.lang = "en-US";
    document.title = product === "modo" ? "MODO USA | Planning demo" : "SmartBots USA | Lead demo";
    robots.content = "noindex,nofollow";
    return () => {
      document.documentElement.lang = previousLang;
      document.title = previousTitle;
      if (existing) robots.content = previousRobots;
      else robots.remove();
    };
  }, [product]);
}

function ModoPlanner() {
  const [business, setBusiness] = useState("Sample neighborhood studio");
  const [audience, setAudience] = useState("Local customers looking for a simpler experience");
  const [goal, setGoal] = useState("More consultations");
  const [channel, setChannel] = useState("Instagram");
  const [tasks, setTasks] = useState<Task[]>(sampleTasks);
  const [notice, setNotice] = useState("");
  const [generated, setGenerated] = useState(false);

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!business.trim() || !audience.trim()) return;
    setTasks([
      { id: 1, title: "Position your offer", detail: "Explain why " + business.trim() + " is useful to " + audience.trim() + ".", reviewed: false },
      { id: 2, title: "Draft content for " + channel, detail: "Create a message aligned with the goal: " + goal.toLowerCase() + ".", reviewed: false },
      { id: 3, title: "Review the next step", detail: "Invite people to ask questions. Approve content before publishing or spending.", reviewed: false },
    ]);
    setGenerated(true);
    setNotice("Sample plan generated locally with predefined rules. No AI request was made.");
  }
  const summary = ["MODO USA - sample campaign brief", "Business: " + business, "Audience: " + audience, "Goal: " + goal, "Channel: " + channel, ""]
    .concat(tasks.map(task => task.title + ": " + task.detail + (task.reviewed ? " [Reviewed]" : " [Draft]")))
    .concat(["", "Demonstration only; no campaign was published or stored."]).join("\n");

  return <div className="usw-columns">
    <section className="usw-card">
      <h2>Campaign brief</h2><p>Use fictional or public information only.</p>
      <form className="usw-form" onSubmit={generate}>
        <label>Business name<input value={business} required maxLength={80} onChange={e => setBusiness(e.target.value)} /></label>
        <label>Target audience<textarea value={audience} required maxLength={160} rows={3} onChange={e => setAudience(e.target.value)} /></label>
        <label>Business goal<select value={goal} onChange={e => setGoal(e.target.value)}><option>More consultations</option><option>More website inquiries</option><option>Introduce a new service</option><option>Grow local awareness</option></select></label>
        <label>Marketing channel<select value={channel} onChange={e => setChannel(e.target.value)}><option>Instagram</option><option>Google Search</option><option>LinkedIn</option><option>Email</option></select></label>
        <button type="submit" className="usw-primary">Build sample plan</button>
      </form>
    </section>
    <section className="usw-card">
      <h2>Marketing checklist</h2>
      <p>{generated ? "Review the sample plan below." : "Begin with a sample plan or create your own."}</p>
      <span className="usw-count">{tasks.filter(t => t.reviewed).length} of {tasks.length} reviewed</span>
      <div className="usw-list">{tasks.map(task => <article key={task.id} className="usw-item">
        <h3>{task.title}</h3><p>{task.detail}</p>
        <label className="usw-inline"><input type="checkbox" checked={task.reviewed} onChange={e => setTasks(old => old.map(t => t.id === task.id ? { ...t, reviewed: e.target.checked } : t))} /> Reviewed</label>
      </article>)}</div>
      <button type="button" className="usw-primary" onClick={async () => {
        try { await navigator.clipboard.writeText(summary); setNotice("Draft copied. Nothing was published."); }
        catch { setNotice("Clipboard unavailable. Copy the text shown below instead."); }
      }}>Copy draft brief</button>
      <button type="button" className="usw-outline" onClick={() => { setTasks(sampleTasks); setGenerated(false); setNotice(""); }}>Reset demo</button>
      <p role="status">{notice}</p>
      <details><summary>Plain-text brief</summary><pre>{summary}</pre></details>
    </section>
  </div>;
}

function SmartBotsInbox() {
  const [leads, setLeads] = useState<Lead[]>(sampleLeads);
  const [name, setName] = useState("");
  const [interest, setInterest] = useState("");
  const [selectedId, setSelectedId] = useState(1);
  const [notice, setNotice] = useState("");
  const selected = leads.find(lead => lead.id === selectedId);
  const draft = selected
    ? "Hi " + selected.name.replace(/^Sample: /, "") + ", thanks for asking about " + selected.interest.toLowerCase() + ". Would you like more details?"
    : "Select a sample lead.";

  function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !interest.trim()) return;
    const id = Math.max(0, ...leads.map(item => item.id)) + 1;
    setLeads(old => old.concat({ id, name: name.trim(), interest: interest.trim(), stage: "New" }));
    setSelectedId(id);
    setName("");
    setInterest("");
  }

  return <div className="usw-columns">
    <section className="usw-card">
      <h2>Lead inbox</h2><p>Fictional records only. Refreshing clears all changes.</p>
      <div className="usw-list">{leads.map(lead => <button type="button" key={lead.id} className={"usw-lead" + (lead.id === selectedId ? " selected" : "")} aria-pressed={lead.id === selectedId} onClick={() => { setSelectedId(lead.id); setNotice(""); }}>
        <strong>{lead.name}</strong><span>{lead.interest} · {lead.stage}</span>
      </button>)}</div>
      <form className="usw-form" onSubmit={addLead}>
        <h3>Add a fictional sample</h3>
        <label>Name or alias<input value={name} required maxLength={60} onChange={e => setName(e.target.value)} placeholder="Sample: Alex" /></label>
        <label>Area of interest<input value={interest} required maxLength={120} onChange={e => setInterest(e.target.value)} placeholder="Service quote" /></label>
        <button type="submit" className="usw-primary">Add sample lead</button>
      </form>
    </section>
    <section className="usw-card">
      <h2>Assisted follow-up</h2>
      {selected && <>
        <h3>{selected.name}</h3><p>{selected.interest}</p>
        <label className="usw-form">Lead stage<select value={selected.stage} onChange={e => setLeads(old => old.map(lead => lead.id === selected.id ? { ...lead, stage: e.target.value as Lead["stage"] } : lead))}><option>New</option><option>Contacted</option><option>Follow-up</option></select></label>
        <h3>Suggested message (editable after copying)</h3>
        <div className="usw-message">{draft}</div>
        <button className="usw-primary" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(draft); setNotice("Message copied. You decide whether to send it."); }
          catch { setNotice("Clipboard unavailable. Copy the message above manually."); }
        }}>Copy draft reply</button>
      </>}
      <button type="button" className="usw-outline" onClick={() => { setLeads(sampleLeads); setSelectedId(1); setNotice(""); }}>Reset demo</button>
      <p role="status">{notice || "No automatic SMS, email or WhatsApp sending is enabled."}</p>
    </section>
  </div>;
}

export default function USWorkspace({ product }: { product: Product }) {
  usePreviewMetadata(product);
  const isSmartBots = product === "smartbots";
  return <div className="usw">
    <header className="usw-header"><a href={isSmartBots ? "/us/smartbots" : "/us"} className="usw-brand">{isSmartBots ? "SmartBots" : "MODO"} <span>USA DEMO</span></a><nav><a href="/us">MODO</a><a href="/us/smartbots">SmartBots</a><a href={isSmartBots ? "/us/smartbots" : "/us"}>Back to overview</a></nav></header>
    <main className="usw-main">
      <div className="usw-banner" role="note"><strong>Local interactive demonstration.</strong> Do not enter personal or confidential information. No account, checkout, API calls, automated messages or data storage.</div>
      <div className="usw-hero"><small>Alternative Ventures · United States</small><h1>{isSmartBots ? "Keep conversations moving." : "Make marketing easier to plan."}</h1><p>{isSmartBots ? "Try a lightweight lead inbox and manual follow-up flow." : "Create and review a rule-based marketing checklist."}</p></div>
      {isSmartBots ? <SmartBotsInbox /> : <ModoPlanner />}
    </main>
    <footer className="usw-footer">Alternative Ventures USA · Not a live commercial US service</footer>
  </div>;
}
