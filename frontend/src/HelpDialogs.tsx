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
                      {s.bullets && (
                        <ul className="help-bullets">
                          {s.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      )}
                      {s.smallNote && <p className="help-small">{s.smallNote}</p>}
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

type Step = {
  title: string;
  text: ReactNode;
  bullets?: string[];   // optional list under the text
  smallNote?: string;   // optional small grey note under the step
};
type Content = { title: string; intro?: string; steps: Step[]; note?: ReactNode };

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
      text: "Pick your average pace and how much it should vary, add heart rate data if you want it, and set the name, date and start time.",
    },
    {
      title: "Download the GPX",
      text: "Press “Download GPX”. The file contains GPS points with timestamps, elevation and heart rate, built from your settings. Long routes can take a few seconds.",
    },
  ],
  note: "Press “Clear” on the map to start over. Switching between Run and Bike re-snaps the route automatically.",
};

const HOW_TO_UPLOAD: Content = {
  title: "Uploading your GPX file",
  steps: [
    {
      title: "Open the upload page",
      text: "Log in to your account on the website of the service you use. Find the “Upload”, “Import” or “Add” option. It's usually in the main menu, on your dashboard or behind a “+” button.",
      smallNote: "Most services only accept files on their website, not in the phone app, so use a browser (a computer works best).",
    },
    {
      title: "Select your GPX file",
      text: "Click “Choose file”, “Browse” or similar, and pick the .gpx file you downloaded (usually in your Downloads folder).",
      smallNote: "Most services accept .gpx, .tcx and .fit files. Size limits vary.",
    },
    {
      title: "Fill in the activity details",
      text: "After choosing the file you'll usually get a form for the activity:",
      bullets: [
        "Name, e.g. “Morning Run” or “Sunday Long Run”",
        "Activity type: Run, Ride, Walk, …",
        "Description (optional)",
        "Date and time (normally read from the file)",
        "Who can see it (privacy)",
      ],
    },
    {
      title: "Save",
      text: "Check the details and click “Save”, “Upload” or “Done”. The activity shows up in your activity list and feed.",
    },
    {
      title: "Check the result",
      text: "Open the activity and make sure that:",
      bullets: [
        "the route on the map looks right",
        "distance, time and elevation look reasonable",
        "the activity type is correct",
      ],
    },
  ],
  note: "Something wrong? Most services let you edit the name, type and description after uploading.",
};
