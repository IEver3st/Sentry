import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { AlertCircle, Check, X } from "lucide-react";
import type { Request, ResponseMap, State } from "../shared/contracts";

export const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button-default",
      primary: "button-primary",
      ghost: "button-ghost",
      danger: "button-danger",
    },
    size: { default: "", icon: "button-icon", small: "button-small" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  variant = "default",
  size = "default",
  asChild = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "default" | "icon" | "small";
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={clsx(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
interface AppContextValue {
  state: State;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  notice?: { message: string; error: boolean };
  clearNotice: () => void;
  perform: <T extends Request>(
    request: T,
    success?: string,
  ) => Promise<ResponseMap[T["type"]] | undefined>;
}
export const AppContext = createContext<AppContextValue | null>(null);
export function useApp() {
  const app = useContext(AppContext);
  if (!app) throw new Error("Application context is unavailable");
  return app;
}
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = ref.current?.querySelector("input,select,textarea");
    if (input) {
      input.id = id;
      if (hint) input.setAttribute("aria-describedby", `${id}-hint`);
    }
  }, [id, hint, children]);
  return (
    <div ref={ref} className={clsx("field", className)}>
      <label htmlFor={id}>{label}</label>
      <div>{children}</div>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
    </div>
  );
}
export function CheckField({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="check-field">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const descriptionId = useId();
  const app = useContext(AppContext);
  useEffect(() => {
    if (open) app?.clearNotice();
  }, [open, app?.clearNotice]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={clsx("dialog", wide && "dialog-wide")}
          aria-describedby={description ? descriptionId : undefined}
        >
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              {description && (
                <Dialog.Description id={descriptionId}>
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" aria-label="Close dialog">
                <X size={17} />
              </Button>
            </Dialog.Close>
          </div>
          {app?.notice?.error && (
            <div className="dialog-notice">
              <Notice error>{app.notice.message}</Notice>
            </div>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Confirm({
  title,
  description,
  action,
  onConfirm,
  children,
}: {
  title: string;
  description: string;
  action: string;
  onConfirm: () => Promise<void>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <span className="inline-action" onClick={() => setOpen(true)}>
        {children}
      </span>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={title}
        description={description}
      >
        <div className="dialog-footer">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setOpen(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Working…" : action}
          </Button>
        </div>
      </Modal>
    </>
  );
}
export function Empty({
  icon,
  heading,
  children,
  action,
}: {
  icon: ReactNode;
  heading: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h2>{heading}</h2>
      <p>{children}</p>
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={clsx("notice", error && "notice-error")}
      role={error ? "alert" : "status"}
    >
      {error ? <AlertCircle size={16} /> : <Check size={16} />}
      <span>{children}</span>
    </div>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span className={clsx("status", `status-${status}`)}>
      <i aria-hidden="true" />
      {status.replaceAll("-", " ")}
    </span>
  );
}
export function bytes(value: number | undefined) {
  if (value === undefined) return "Not measured";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = value / 1024,
    index = 0;
  while (v >= 1024 && index < units.length - 1) {
    v /= 1024;
    index++;
  }
  return `${v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[index]}`;
}
export function date(value: string | undefined) {
  if (!value) return "Never";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? value
    : parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
export function shortPath(path: string) {
  return (
    path
      .replace(/[\\/]$/, "")
      .split(/[\\/]/)
      .at(-1) || path
  );
}
export function lines(text: string) {
  return text
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}
