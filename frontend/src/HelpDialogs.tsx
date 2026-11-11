import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import TermsContent from "./Terms";

export type HelpTopic = "how-it-works" | "how-to-upload" | "terms";

export default function HelpDialog({ topic, onClose }: { topic: HelpTopic | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  // Native <dialog>: focus trap, Escape to close and a backdrop for free
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (topic && !d.open) d.showModal();
    if (!topic && d.open) d.close();
  }, [topic]);

  const content = topic === "how-to-upload" ? HOW_TO_UPLOAD : HOW_IT_WORKS;
  const title = topic === "terms" ? "Terms of Service" : content.title;

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
          {topic === "terms" ? (
            <TermsContent />
          ) : (
            <>
              {content.intro && <p className="help-intro">{content.intro}</p>}
              <ol className="help-steps">
                {content.steps.map((s, i) => (
                  <li key={i}>
                    <span className="help-num">{i + 1}</span>
                    <div>
                      <strong>{s.title}</strong>
                      <p>{s.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {content.note && <p className="help-note">{content.note}</p>}
            </>
          )}
        </div>
      )}
    </dialog>
  );
}

type Content = { title: string; intro?: string; steps: { title: string; text: ReactNode }[]; note?: ReactNode };

const HOW_IT_WORKS: Content = {
  title: "How it works",
  intro: "Draw a route on the map, choose how the activity should look, and download it as a GPX file.",
  steps: [
    {
      title: "Draw your route",
      text: "Click on the map to place points along the way you want to go. A dashed line connects them. Use the location button to jump to where you are.",
    },
    {
      title: "Snap to road",
      text: "Press “Snap to road” to turn the points into a route that follows real roads and paths. Run uses footpaths, Bike uses cycle routes. The stats show distance, duration and elevation gain.",
    },
    {
      title: "Set the details",
      text: "Pick your average pace and how much it should vary, add heart rate data if you want it, and set the name, date, start time and description.",
    },
    {
      title: "Download the GPX",
      text: "Press “Download GPX”. The file contains GPS points with timestamps, elevation and heart rate, built from your settings. Long routes can take up to ~30 seconds while elevation is looked up.",
    },
  ],
  note: "Press “Clear” to start over. Switching between Run and Bike re-snaps the route automatically.",
};

const HOW_TO_UPLOAD: Content = {
  title: "How to upload to Strava",
  intro: "Strava's phone app can't upload files, so use a browser (a computer works best).",
  steps: [
    {
      title: "Open Strava in a browser",
      text: "Go to strava.com and log in.",
    },
    {
      title: "Go to Upload activity",
      text: "Click the orange “+” button in the top right corner and choose “Upload activity”, then pick “File”.",
    },
    {
      title: "Choose the GPX file",
      text: "Click “Choose files” and select the .gpx file you downloaded (usually in your Downloads folder).",
    },
    {
      title: "Check the details and save",
      text: "Strava shows the activity before saving. Check the name, activity type and description, then press “Save & View”.",
    },
  ],
  note: "Strava may not pick up the name, type or description from the file, so check them on the upload page before saving.",
};
