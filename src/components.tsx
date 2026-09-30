import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, ArrowUpRight } from "lucide-react";
export function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button className="brand" onClick={onClick} aria-label="FORME — на главную">
      forme
      <span className="brand-mark" aria-hidden="true">
        ✳
      </span>
    </button>
  );
}
export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  feedback,
  returnFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  feedback?: ReactNode;
  returnFocus?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const trigger = useRef(returnFocus);
  useEffect(() => {
    const dialog = ref.current!;
    const previous =
      trigger.current ?? (document.activeElement as HTMLElement | null);
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="Закрыть диалог" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {feedback}
      {children}
    </dialog>
  );
}
export function Empty({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description: string;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Arrow() {
  return <ArrowUpRight size={19} aria-hidden="true" />;
}
