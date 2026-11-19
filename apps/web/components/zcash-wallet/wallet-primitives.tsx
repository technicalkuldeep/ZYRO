"use client";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
  type ButtonHTMLAttributes,
} from "react";
import { Eye, EyeOff, X } from "lucide-react";
import styles from "./wallet.module.css";
export function SecretInput({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <div className={styles.secretInput}>
        <input
          {...props}
          id={id}
          type={visible ? "text" : "password"}
          onPaste={(event) => {
            if (props.name !== "phrase") {
              props.onPaste?.(event);
              return;
            }
            // Password inputs strip newlines; normalize a deliberate phrase paste
            // before insertion so words on separate lines do not concatenate.
            event.preventDefault();
            const input = event.currentTarget;
            input.setRangeText(
              event.clipboardData.getData("text").trim().split(/\s+/).join(" "),
              input.selectionStart ?? 0,
              input.selectionEnd ?? 0,
              "end",
            );
          }}
        />
        <button
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}
export function WalletActionButton({
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode }) {
  return (
    <button {...props} className={styles.actionButton}>
      {icon}
      <span>{children}</span>
    </button>
  );
}
export function WalletModal({
  title,
  busy,
  close,
  children,
  error,
  stage,
}: {
  title: string;
  busy: boolean;
  close: () => void;
  children: ReactNode;
  error?: string;
  stage?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={styles.modal}
      aria-labelledby={id}
      aria-busy={busy}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className={styles.modalHeader}>
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          aria-label="Close panel"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {busy && <p role="status">{stage || "Working…"}</p>}
      {children}
    </dialog>
  );
}
