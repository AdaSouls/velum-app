import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, XCircle, X } from "lucide-react";
import { closeProgress, subscribeProgress } from "../../midnight/tx-status";
import { explorerTxUrlInText } from "../../utils/midnightExplorer";
import loadingGif from "../../images/loading.gif";

// The single progress popup for create/claim/mint/publish flows — all the sequencing (one step at
// a time, spinner -> check -> slide up and dim -> next, then the final result) lives in
// tx-status.ts; this only renders its current snapshot.

// Escape hatch only: some wallets hang forever instead of erroring (e.g. Lace's balance call with
// no DUST, see useMidnight.js) — the work keeps running in the background if the user hides this.
const HIDE_AVAILABLE_AFTER_MS = 60_000;

export default function TxStatusPopup() {
  const [progress, setProgress] = useState(null);
  const [canHide, setCanHide] = useState(false);

  useEffect(() => subscribeProgress(setProgress), []);

  const open = Boolean(progress?.open);
  const { title, steps = [], result } = progress ?? {};

  useEffect(() => {
    setCanHide(false);
    if (!open) return undefined;
    const timer = setTimeout(() => setCanHide(true), HIDE_AVAILABLE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div className="tx-status-backdrop">
      <div className="tx-status-popup" role="status" aria-live="polite">
        {(result || canHide) && (
          <button type="button" className="btn wallet-modal-close tx-status-close" onClick={closeProgress} aria-label="close">
            <X size={15} />
          </button>
        )}
        {result ? (
          <div key="result" className={`tx-status-result is-${result.kind}`}>
            {result.kind === "success" ? (
              <CheckCircle2 size={48} color="#2ecc71" strokeWidth={1.5} />
            ) : (
              <XCircle size={48} color="#e74c3c" strokeWidth={1.5} />
            )}
            <h4 className="tx-status-title">{result.title}</h4>
            {result.message && <p className="tx-status-result-message">{result.message}</p>}
            {result.kind === "success" && explorerTxUrlInText(result.message) && (
              <a
                className="tx-status-result-link"
                href={explorerTxUrlInText(result.message)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Midnight Explorer <ExternalLink size={13} />
              </a>
            )}
          </div>
        ) : (
          <>
            <h4 className="tx-status-title">{title}</h4>
            {/* Every step stays the same keyed element as it moves current -> previous -> exiting,
                so its slide/dim is a CSS transition on the role class, not a remount. */}
            <div className="tx-status-stage">
              {steps.map((step) => (
                <div key={step.id} className={`tx-status-step is-${step.role} is-${step.status}`}>
                  <span className="tx-status-step-icon" aria-hidden="true">
                    {step.status === "running" ? (
                      <img src={loadingGif} width="22" height="22" alt="" />
                    ) : (
                      <CheckCircle2 size={22} color="#2ecc71" strokeWidth={1.75} />
                    )}
                  </span>
                  <span className="tx-status-step-label">{step.label}</span>
                </div>
              ))}
            </div>
            <p className="tx-status-hint">Keep this tab open until it finishes.</p>
          </>
        )}
      </div>
    </div>
  );
}
