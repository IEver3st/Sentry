import { useMemo, useRef, useState } from "react";
import { SlidersHorizontal, RotateCcw } from "lucide-react";
import { defaultOverview, type OverviewPreferences } from "../shared/contracts";
import { Button, Modal, Select, bytes, useApp } from "./ui";
import { backupInsights, outcomes } from "./overview-data";
import "./overview.css";

const sections: Array<{ id: OverviewPreferences["widgets"][number]; name: string; description: string }> = [
  { id: "activity", name: "Backup activity", description: "Daily runs, with every outcome kept separate." },
  { id: "outcomes", name: "Backup outcomes", description: "Complete, partial, failed, cancelled and interrupted runs." },
  { id: "data", name: "Processed data", description: "Bytes processed by complete backups each day." },
  { id: "ledger", name: "Protection ledger", description: "Sources, destinations and the last complete copy." },
  { id: "recent", name: "Recent activity", description: "The latest backup, restore and maintenance jobs." },
];
type Insights = ReturnType<typeof backupInsights>;
const dayLabel = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
const count = (value: number) => value.toLocaleString();

export function OverviewInsights() {
  const { state, perform, clearNotice } = useApp();
  const preferences = state.settings.overview ?? defaultOverview;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(preferences);
  const [saving, setSaving] = useState(false);
  const customize = useRef<HTMLButtonElement>(null);
  const today = new Date().toDateString();
  const insights = useMemo(() => backupInsights(state.jobs, preferences.days), [state.jobs, preferences.days, today]);
  const visible = (id: OverviewPreferences["widgets"][number]) => preferences.widgets.includes(id);
  const save = async (next: OverviewPreferences) => {
    setSaving(true);
    try {
      const result = await perform({ type: "settings", settings: { ...state.settings, overview: next } });
      if (result) { clearNotice(); return true; }
      return false;
    } finally { setSaving(false); }
  };
  const close = () => { setOpen(false); requestAnimationFrame(() => customize.current?.focus()); };
  return (
    <div className="overview-insights">
      <div className="insights-toolbar">
        <div><h2>Your backup insights</h2><p>Last {preferences.days} days · From your latest 100 jobs</p></div>
        <div className="button-group">
          <Select aria-label="Chart period" value={preferences.days} disabled={saving} onValueChange={(value) => { void save({ ...preferences, days: Number(value) as 7 | 30 }); }}>
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option>
          </Select>
          <button ref={customize} className="button" disabled={saving} onClick={() => { setDraft(preferences); setOpen(true); }}>
            <SlidersHorizontal size={14} aria-hidden="true" />Customize
          </button>
        </div>
      </div>
      <div className="insights-grid">
        {visible("activity") && <DailyChart insights={insights} kind="activity" />}
        {visible("outcomes") && <OutcomeChart insights={insights} />}
        {visible("data") && <DailyChart insights={insights} kind="data" />}
      </div>
      {preferences.widgets.length === 0 && <p className="insights-empty">Your overview is simplified. Choose sections in Customize to add insights and activity.</p>}
      <Modal open={open} onOpenChange={(next) => { if (!saving && !next) close(); }} title="Customize overview" description="Choose the details you want to see. Protection status and active jobs always stay visible.">
        <div className="dialog-body overview-options">
          {sections.map((section) => <label className="overview-option" key={section.id}>
            <input type="checkbox" checked={draft.widgets.includes(section.id)} disabled={saving} onChange={(event) => setDraft({ ...draft, widgets: event.target.checked ? [...draft.widgets, section.id] : draft.widgets.filter((id) => id !== section.id) })} />
            <span><strong>{section.name}</strong><small>{section.description}</small></span>
          </label>)}
        </div>
        <div className="dialog-footer overview-dialog-actions">
          <Button variant="ghost" disabled={saving} onClick={() => setDraft({ ...defaultOverview, days: preferences.days })}><RotateCcw size={14} aria-hidden="true" />Reset sections</Button>
          <div className="button-group"><Button disabled={saving} onClick={close}>Cancel</Button><Button variant="primary" disabled={saving} onClick={() => { void save(draft).then((saved) => { if (saved) close(); }); }}>{saving ? "Saving…" : "Save overview"}</Button></div>
        </div>
      </Modal>
    </div>
  );
}

function DailyChart({ insights, kind }: { insights: Insights; kind: "activity" | "data" }) {
  const [selected, setSelected] = useState<string>();
  const isData = kind === "data";
  const bucket = insights.buckets.find((day) => day.key === selected) ?? insights.buckets.at(-1)!;
  const maximum = Math.max(1, ...insights.buckets.map((day) => isData ? day.bytes : day.total));
  const ceiling = isData ? maximum : Math.max(2, Math.ceil(maximum / 2) * 2);
  const format = isData ? bytes : count;
  const hasData = isData ? insights.totals.success > 0 : insights.total > 0;
  const title = isData ? "Processed data" : "Backup activity";
  const detail = (day: typeof bucket) => isData
    ? `${bytes(day.bytes)} · ${day.counts.success} complete backups`
    : outcomes.map((outcome) => `${day.counts[outcome.status]} ${outcome.label.toLowerCase()}`).join(" · ");
  return (
    <section className={`insight-panel daily-panel ${isData ? "data-panel" : ""}`} aria-label={title}>
      <div className="insight-heading"><h3>{title}</h3><span>{isData ? "Complete backups only" : "Runs per destination"}</span></div>
      <div className="insight-total"><strong>{isData ? bytes(insights.processed) : count(insights.total)}</strong><span>{isData ? "processed" : "finished runs"}</span></div>
      {hasData ? <>
        <div className="daily-chart">
          <div className="chart-scale" aria-hidden="true"><span>{format(ceiling)}</span><span>{format(ceiling / 2)}</span><span>{format(0)}</span></div>
          <div className="chart-plot">
            <div className="chart-gridlines" aria-hidden="true"><i /><i /><i /></div>
            <div className="chart-bars">
              {insights.buckets.map((day) => <button key={day.key} className="chart-day" aria-label={`${dayLabel(day.date)}: ${detail(day)}`} aria-pressed={bucket.key === day.key} onClick={() => setSelected(day.key)} onFocus={() => setSelected(day.key)} onMouseEnter={() => setSelected(day.key)}>
                <span className="chart-stack" aria-hidden="true">
                  {isData ? <span style={{ height: `${day.bytes / ceiling * 100}%`, background: "var(--accent)" }} /> : outcomes.map((outcome) => <span key={outcome.status} style={{ height: `${day.counts[outcome.status] / ceiling * 100}%`, background: outcome.color }} />)}
                </span>
              </button>)}
            </div>
          </div>
        </div>
        <div className="chart-dates" aria-hidden="true"><span>{dayLabel(insights.buckets[0].date)}</span><span>{dayLabel(insights.buckets[Math.floor(insights.buckets.length / 2)].date)}</span><span>{dayLabel(insights.buckets.at(-1)!.date)}</span></div>
        <div className="chart-readout"><strong>{dayLabel(bucket.date)}</strong><span className="chart-readout-values">{isData ? detail(bucket) : outcomes.map((outcome) => <span key={outcome.status}><i style={{ background: outcome.color }} aria-hidden="true" />{bucket.counts[outcome.status]} {outcome.label.toLowerCase()}</span>)}</span></div>
      </> : <div className="chart-no-data"><span className="empty-chart-lines" aria-hidden="true" /><strong>{isData ? "No complete backups in this period" : "No finished backups in this period"}</strong><p>{isData ? "Processed bytes appear after a backup completes." : "Run a plan or choose a longer period to see activity."}</p></div>}
      {isData && <p className="chart-footnote">Counts files again for each run and destination. This is not storage used.</p>}
      {hasData && <details className="chart-table"><summary>View daily values</summary><div className="chart-table-scroll"><table><caption>{title} · local completion dates</caption><thead><tr><th scope="col">Date</th>{isData ? <th scope="col">Processed</th> : outcomes.map((outcome) => <th scope="col" key={outcome.status}>{outcome.label}</th>)}</tr></thead><tbody>{insights.buckets.map((day) => <tr key={day.key}><th scope="row">{dayLabel(day.date)}</th>{isData ? <td>{bytes(day.bytes)}</td> : outcomes.map((outcome) => <td key={outcome.status}>{day.counts[outcome.status]}</td>)}</tr>)}</tbody></table></div></details>}
    </section>
  );
}

function OutcomeChart({ insights }: { insights: Insights }) {
  const total = insights.total;
  let offset = 0;
  const segments = outcomes.map((outcome) => {
    const size = total ? insights.totals[outcome.status] / total * 100 : 0;
    const segment = { ...outcome, size, offset };
    offset += size;
    return segment;
  });
  return <section className="insight-panel outcome-panel" aria-label="Backup outcomes">
    <div className="insight-heading"><h3>Backup outcomes</h3></div>
    <div className="outcome-ring">
      <svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="64" fill="none" stroke="var(--border)" strokeWidth="12" />{segments.filter((segment) => segment.size > 0).map((segment) => <circle key={segment.status} cx="80" cy="80" r="64" fill="none" stroke={segment.color} strokeWidth="12" pathLength="100" strokeDasharray={`${segment.size} ${100 - segment.size}`} strokeDashoffset={-segment.offset} transform="rotate(-90 80 80)" />)}</svg>
      <div><strong>{total ? `${Math.round(insights.totals.success / total * 100)}%` : "—"}</strong><span>{total ? "complete" : "No runs yet"}</span></div>
    </div>
    <dl className="outcome-legend">{outcomes.map((outcome) => <div key={outcome.status}><dt><i style={{ background: outcome.color }} aria-hidden="true" />{outcome.label}</dt><dd>{count(insights.totals[outcome.status])}</dd></div>)}</dl>
    <p className="chart-footnote">{insights.totals.success} of {total} finished backup runs. Active jobs are excluded.</p>
  </section>;
}
