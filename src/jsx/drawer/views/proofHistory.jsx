import { X, ExternalLink, ShieldCheck } from "lucide-react";
import { useDrawer, useDrawerDispatch } from "../../contexts/drawer/drawer.provider";
import { PROOF_KINDS, verifyUrl } from "../../../midnight/proof-verification";
import { recordVerifyHashes } from "../../../midnight/proof-history";
import { formatUntil, parseValidity, validityStatus } from "../../../midnight/validity";

// The holder's proofs for one POAP (proof-history.ts), opened from the expanded poapCard.jsx
// (SHOW_PROOF_HISTORY) — newest first, each with its Verify link. Payload: { records, eventName,
// validity (the event's raw metadata value), isSubscription }. For a subscription, each ownership
// proof also says until when it keeps the subscription active.
export default function ProofHistory() {
  const { proofHistoryContext: ctx } = useDrawer();
  const dispatch = useDrawerDispatch();
  const records = ctx?.records || [];
  const validity = parseValidity(ctx?.validity);

  const closeDrawer = () => dispatch({ type: "CLOSE_DRAWER" });

  return (
    <div className="d-flex flex-column w-100 drawer-modal-inner">
      <div className="drawer-header">
        <button className="btn wallet-modal-close" onClick={closeDrawer} aria-label="close">
          <X size={15} />
        </button>
        <h4 className="text-center w-100 m-0 font-weight-semibold">Proof History</h4>
      </div>

      <div className="drawer-body">
        {ctx?.eventName && <p className="text-muted small text-center mb-3">{ctx.eventName}</p>}
        {records.length === 0 ? (
          <p className="text-muted small mb-0">No proofs made from this POAP yet.</p>
        ) : (
          <ul className="list-unstyled m-0 d-flex flex-column" style={{ gap: "8px" }}>
            {records.map((record) => (
              <li key={`${record.provenAt}-${record.txHash}`} className="proof-history-item">
                <div style={{ minWidth: 0 }}>
                  <p className="m-0 small font-weight-semibold d-flex align-items-center">
                    <ShieldCheck size={13} className="mr-1 flex-shrink-0" />
                    {PROOF_KINDS[record.kind]?.title || "Proof"}
                  </p>
                  <p className="m-0 small text-muted text-truncate">{record.question}</p>
                  <p className="m-0 small text-muted">
                    {new Date(record.provenAt).toLocaleString()}
                    {ctx?.isSubscription &&
                      validity &&
                      (record.kind === "proveTokenOwnership" || record.kind === "proveEventAttendance") &&
                      ` · valid until ${formatUntil(validityStatus(validity, Date.parse(record.provenAt)).untilMs, validity)}`}
                  </p>
                </div>
                {record.txHash && (
                  <a
                    href={verifyUrl(recordVerifyHashes(record))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-card-detail-action btn-sm flex-shrink-0"
                  >
                    <ExternalLink size={14} className="mr-2" />
                    Verify
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="m-0 mt-3 small text-muted">
          Only you see this list — it's kept in this browser and in your backup. Each proof stays
          on-chain; anyone can check it with its Verify link. It shows you held this POAP at that
          moment; prove again to show you still do.
        </p>
      </div>
    </div>
  );
}
