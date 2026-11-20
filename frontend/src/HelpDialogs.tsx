import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import TermsContent from "./Terms";

// Only the Terms of Service are a dialog now; the guides are pages (/how-it-works/, /how-to-upload/)
export type HelpTopic = "terms";

export default function HelpDialog({ topic, onClose }: { topic: HelpTopic | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  // Native <dialog>: focus trap, Escape to close and a backdrop for free
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (topic && !d.open) d.showModal();
    if (!topic && d.open) d.close();
  }, [topic]);

  const title = "Terms of Service";

  return (
    <dialog
      ref={ref}
      className="help-dialog"
      aria-labelledby="help-title"
      onClose={onClose}
      // click on the backdrop (outside the content box) closes
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {topic && (
        <div className="help-head">
          <h2 id="help-title">{title}</h2>
          <button type="button" className="help-close" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
      )}
      {topic && (
        <div className="help-body">
          <TermsContent />
        </div>
      )}
    </dialog>
  );
}
