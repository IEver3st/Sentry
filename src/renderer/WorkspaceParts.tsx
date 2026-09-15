import type { ReactNode } from "react";
import { ArrowRight, Check, Circle } from "lucide-react";

export function WorkspaceIntro({ icon, eyebrow, title, children, action }: {
  icon: ReactNode; eyebrow: string; title: string; children: ReactNode; action?: ReactNode;
}) {
  return <div className="workspace-intro">
    <div className="workspace-symbol" aria-hidden="true">{icon}</div>
    <div className="workspace-intro-copy"><span className="workspace-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{children}</p></div>
    {action && <div className="workspace-intro-action">{action}</div>}
  </div>;
}

export function WorkflowSteps({ steps, current }: { steps: { title: string; detail: string }[]; current: number }) {
  return <ol className="workflow-steps" aria-label="Recovery steps">{steps.map((step, index) => <li key={step.title} aria-current={index === current ? "step" : undefined} className={index < current ? "is-complete" : ""}>
    <span className="workflow-number" aria-hidden="true">{index < current ? <Check size={14} /> : index + 1}</span>
    <div><strong>{step.title}</strong><small>{step.detail}</small></div>
    {index < steps.length - 1 && <ArrowRight className="workflow-arrow" size={15} aria-hidden="true" />}
  </li>)}</ol>;
}

export function PreparationList({ title, items }: { title: string; items: { title: string; detail: string; ready?: boolean }[] }) {
  return <section className="preparation-list"><h3>{title}</h3>{items.map(item => <div className="preparation-row" key={item.title}>
    {item.ready ? <Check size={16} aria-label="Ready" /> : <Circle size={15} aria-hidden="true" />}
    <div><strong>{item.title}</strong><p>{item.detail}</p></div>
  </div>)}</section>;
}
