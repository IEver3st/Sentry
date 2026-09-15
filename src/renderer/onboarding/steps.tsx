import { FolderOpen, HardDrive, KeyRound, Plus, ShieldCheck, History } from "lucide-react";
import type { Plan } from "../../shared/contracts";
import { Button, Field, lines, Select, useApp } from "../ui";
import { DestinationForm } from "../PlanEditor";

export interface DraftProps { plan: Plan; onChange: (plan: Plan) => void }

export function WelcomeStep() {
  return <ul className="setup-promises">
    <li><ShieldCheck size={17} aria-hidden="true" />Encrypted copies</li>
    <li><HardDrive size={17} aria-hidden="true" />Your own storage</li>
    <li><History size={17} aria-hidden="true" />Recoverable versions</li>
  </ul>;
}

export function SourcesStep({ plan, onChange }: DraftProps) {
  const { perform } = useApp();
  return <div className="setup-fields">
    <Field label="Plan name"><input aria-label="Plan name" maxLength={120} value={plan.name} onChange={(e) => onChange({ ...plan, name: e.target.value })} placeholder="My important files" /></Field>
    <Field label="Files and folders" hint="One full path per line. Everything inside these folders is included."><textarea aria-label="Files and folders" rows={4} value={plan.sources.join("\n")} onChange={(e) => onChange({ ...plan, sources: e.target.value.split("\n") })} placeholder="C:\Users\you\Documents" /></Field>
    <Button onClick={async () => {
      const paths = await perform({ type: "choose-path", kind: "sources" });
      if (paths?.length) onChange({ ...plan, sources: [...new Set([...lines(plan.sources.join("\n")), ...paths])] });
    }}><Plus size={15} />Choose files or folders</Button>
    <p className="setup-note">Original files stay where they are. Advanced file filters are available in Backup Plans after setup.</p>
  </div>;
}

export function DestinationStep({ plan, onChange, creating, setCreating }: DraftProps & { creating: boolean; setCreating: (creating: boolean) => void }) {
  const { state } = useApp();
  if (creating) return <DestinationForm onDone={(destination) => { onChange({ ...plan, destinationIds: [destination.id] }); setCreating(false); }} onCancel={() => setCreating(false)} />;
  return <div className="setup-fields">
    {state.destinations.length ? <fieldset className="setup-destinations"><legend>Connected destinations</legend>{state.destinations.map((destination) => <label className="setup-destination" key={destination.id} data-selected={plan.destinationIds.includes(destination.id)}>
      <input type="radio" name="setup-destination" checked={plan.destinationIds.includes(destination.id)} disabled={destination.status !== "ready"} onChange={() => onChange({ ...plan, destinationIds: [destination.id] })} />
      <HardDrive size={21} /><span><strong>{destination.name}</strong><span className="setup-path">{destination.location}</span><small>{destination.status === "ready" ? "Connected" : destination.error || "Unavailable. Reconnect this destination in Settings."}</small></span>
    </label>)}</fieldset> : <div className="setup-no-destination"><HardDrive size={26} /><strong>No destination connected yet</strong><p>Use a separate drive when possible. A copy on the same disk won’t protect against that disk failing.</p></div>}
    <Button onClick={() => setCreating(true)}><Plus size={15} />Add a destination</Button>
    <p className="setup-note"><KeyRound size={15} />Keep your recovery password somewhere outside Sentry. It cannot be recovered for you.</p>
  </div>;
}

export function ScheduleStep({ plan, onChange }: DraftProps) {
  return <div className="setup-fields">
    <Field label="Backup schedule"><Select aria-label="Backup schedule" value={plan.schedule.kind} onValueChange={(kind) => onChange({ ...plan, schedule: { ...plan.schedule, kind: kind as "daily" | "manual" } })}><option value="daily">Every day</option><option value="manual">Only when I start a backup</option></Select></Field>
    {plan.schedule.kind === "daily" && <Field label="Backup time" hint="Uses your computer’s local time."><input aria-label="Backup time" type="time" value={plan.schedule.time} onChange={(e) => onChange({ ...plan, schedule: { ...plan.schedule, time: e.target.value } })} /></Field>}
    <div className="setup-retention"><h2>A history you can return to</h2><p>Keep the latest backup from each of the last:</p><dl><div><dt>Days</dt><dd>{plan.retention.daily}</dd></div><div><dt>Weeks</dt><dd>{plan.retention.weekly}</dd></div><div><dt>Months</dt><dd>{plan.retention.monthly}</dd></div></dl><p>You can change the schedule and retention in Backup Plans.</p></div>
  </div>;
}

export function ReviewStep({ plan, onEdit }: { plan: Plan; onEdit: (step: number) => void }) {
  const { state } = useApp();
  const destination = state.destinations.find((d) => plan.destinationIds.includes(d.id));
  return <div className="setup-review">
    <div><header><h2>{plan.name}</h2><Button variant="ghost" size="small" onClick={() => onEdit(1)}>Edit files</Button></header><ul>{plan.sources.map((source, i) => <li key={i}><FolderOpen size={15} /><span>{source}</span></li>)}</ul></div>
    <div><header><h2>Destination</h2><Button variant="ghost" size="small" onClick={() => onEdit(2)}>Edit destination</Button></header><strong>{destination?.name ?? "No destination selected"}</strong><p className="setup-path">{destination?.location}</p></div>
    <div><header><h2>Schedule & history</h2><Button variant="ghost" size="small" onClick={() => onEdit(3)}>Edit schedule</Button></header><p>{plan.schedule.kind === "manual" ? "Only when you start a backup" : `Daily at ${plan.schedule.time}, local time`}</p><p>Keep {plan.retention.daily} daily, {plan.retention.weekly} weekly and {plan.retention.monthly} monthly backups.</p></div>
    {state.policy && <p className="setup-note">{state.policy}</p>}
  </div>;
}
