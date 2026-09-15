import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Pause, Play } from "lucide-react";
import { Button, lines, Modal, Notice, useApp } from "../ui";
import { newPlan } from "../PlanEditor";
import { setupError, setupSteps } from "./model";
import { SetupBackground, SetupIllustration } from "./SetupIllustration";
import { DestinationStep, ReviewStep, ScheduleStep, SourcesStep, WelcomeStep } from "./steps";
import "./onboarding.css";

export function Onboarding({ onExit }: { onExit: (page: "Overview" | "Settings" | "Activity") => void }) {
  const { state, perform, notice, clearNotice } = useApp();
  const [index, setIndex] = useState(0);
  const [plan, setPlan] = useState(() => ({ ...newPlan(), name: "My important files" }));
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  const [exitTarget, setExitTarget] = useState<"Overview" | "Settings">();
  const heading = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const step = setupSteps[index];
  useEffect(() => {
    heading.current?.focus();
    content.current?.scrollTo({ top: 0 });
  }, [index, saved]);
  useEffect(() => {
    if (error || notice?.error) errorRef.current?.focus();
  }, [error, notice]);
  function go(next: number) {
    clearNotice();
    setError("");
    setIndex(next);
  }
  async function leave(page: "Overview" | "Settings") {
    setBusy(true);
    clearNotice();
    try {
      const result = await perform({ type: "settings", settings: { ...state.settings, onboardingDismissed: true } });
      if (result) onExit(page);
    } finally { setBusy(false); setExitTarget(undefined); }
  }
  async function next() {
    clearNotice();
    const candidate = { ...plan, name: plan.name.trim(), sources: lines(plan.sources.join("\n")) };
    const problem = setupError(step.id, candidate, state);
    if (problem) { setError(problem); return; }
    setPlan(candidate);
    if (step.id !== "review") { go(index + 1); return; }
    setError("");
    setBusy(true);
    try {
      const result = await perform({ type: "save-plan", plan: candidate });
      if (result) { setPlan(result); setSaved(true); }
    } finally { setBusy(false); }
  }
  async function startBackup() {
    setBusy(true);
    clearNotice();
    try {
      const result = await perform({ type: "run", planId: plan.id }, "Backup requested. Check Activity for its outcome.");
      if (result !== undefined) onExit("Activity");
    } finally { setBusy(false); }
  }
  const draft = { plan, onChange: setPlan };
  return <main className="setup" data-paused={paused} data-step={saved ? "saved" : step.id} aria-label="Sentry setup">
    <SetupBackground />
    <header className="setup-topbar"><div>
      <Button variant="ghost" size="icon" aria-label={paused ? "Resume setup animations" : "Pause setup animations"} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={15} /> : <Pause size={15} />}</Button>
      {!saved && <Button variant="ghost" disabled={busy || creating} onClick={() => index === 0 ? void leave("Overview") : setExitTarget("Overview")}>Set up later</Button>}
    </div></header>
    <div className="setup-layout" ref={content}>
      <section className="setup-panel" aria-labelledby="setup-heading">
        <nav aria-label="Setup progress"><ol className="setup-progress">{setupSteps.map((item, i) => <li key={item.id} aria-current={!saved && index === i ? "step" : undefined} data-complete={saved || i < index}><span>{saved || i < index ? <Check size={11} /> : i + 1}</span><span>{item.label}</span></li>)}</ol></nav>
        <div className="setup-content">
          <div className="setup-step" key={saved ? "saved" : step.id}>
            <div className="setup-art"><SetupIllustration step={saved ? "saved" : step.id} /></div>
            <h1 id="setup-heading" tabIndex={-1} ref={heading}>{saved ? "Your plan is ready." : step.title}</h1>
            <p className="setup-description">{saved ? "Your backup plan is saved. Start the first copy when you’re ready, then follow its progress in Activity." : step.description}</p>
            {(error || notice?.error) && <div className="setup-error" tabIndex={-1} ref={errorRef}><Notice error>{error || notice?.message}</Notice></div>}
            {saved ? <div className="setup-saved"><span className="setup-saved-icon"><Check size={22} /></span><div><strong>{plan.name}</strong><p>{plan.sources.length} {plan.sources.length === 1 ? "source" : "sources"} · {plan.schedule.kind === "manual" ? "Manual backups" : `Daily at ${plan.schedule.time}`}</p><p>Files aren’t protected until a backup completes.</p></div></div> : <>
              {step.id === "welcome" && <WelcomeStep />}
              {step.id === "sources" && <SourcesStep {...draft} />}
              {step.id === "destination" && <DestinationStep {...draft} creating={creating} setCreating={setCreating} />}
              {step.id === "schedule" && <ScheduleStep {...draft} />}
              {step.id === "review" && <ReviewStep plan={plan} onEdit={go} />}
            </>}
          </div>
        </div>
        {!creating && <footer className="setup-footer">
          {saved ? <><Button disabled={busy} variant="ghost" onClick={() => onExit("Overview")}>Go to Overview</Button><Button variant="primary" disabled={busy} onClick={() => void startBackup()}>{busy ? "Requesting backup…" : "Start first backup"}<ArrowRight size={15} /></Button></> : <>
            {index > 0 && <Button variant="ghost" disabled={busy || creating} onClick={() => go(index - 1)}><ArrowLeft size={15} />Back</Button>}
            <Button variant="primary" disabled={busy || creating} onClick={() => void next()}>{busy ? "Saving plan…" : step.id === "welcome" ? "Get started" : step.id === "review" ? "Save backup plan" : "Continue"}<ArrowRight size={15} /></Button>
          </>}
        </footer>}
        {!saved && step.id === "welcome" && <button className="setup-recovery" disabled={busy} onClick={() => void leave("Settings")}>Already have a backup? <span>Connect it here</span></button>}
      </section>
    </div>
    {exitTarget && <Modal open title="Leave setup?" description="Your unsaved plan will be discarded. Any destination you created stays connected. You can start setup again from Overview." onOpenChange={(open) => { if (!open && !busy) setExitTarget(undefined); }}><div className="dialog-footer"><Button disabled={busy} onClick={() => setExitTarget(undefined)}>Keep setting up</Button><Button disabled={busy} onClick={() => void leave(exitTarget)}>{busy ? "Leaving…" : "Leave setup"}</Button></div></Modal>}
  </main>;
}
