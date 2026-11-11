import { X, AlertCircle } from "lucide-react";

export type Toast = { id: number; message: string };

// Small error messages at the bottom of the screen (instead of browser alert() pop-ups).
// They disappear by themselves after a few seconds; App owns the list.
export default function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div key={t.id} className="toast" role="alert">
          <AlertCircle size={18} className="toast-icon" aria-hidden="true" />
          <span className="toast-text">{t.message}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
