import { useEffect, useState } from "react";
import { X, EyeOff, ShieldCheck, Users, Info, Copy, Check } from "lucide-react";
import { useDrawer, useDrawerDispatch } from "../../contexts/drawer/drawer.provider";
import { errorFunction, loadingFunction, succesfullBlockchainCreation } from "../../toasts/sweetAlerts";
import {
  listAnswerableRequests,
  proveAttendance,
  proveAttribute,
  setTreeFor,
  valueQualifies,
} from "../../../midnight/holder-proofs";
import { addProofRecord } from "../../../midnight/proof-history";
import { getEvent } from "../../../midnight/indexer.service";
import { describeRule, ruleSize } from "../../../midnight/attribute-types";
import ProofReceipt from "../../components/ProofReceipt";
import loadingGif from "../../../images/loading.gif";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";

const PROGRESS_TITLE = "Proving";
// Below this many live POAPs in the event, "one of the holders" barely hides anyone.
export const ANONYMITY_WARNING_BELOW = 5;

// An anonymous proof hides which of the event's live POAPs is yours, so it's only as anonymous as
// that count is large. Informative only: the proof itself is unchanged and the button stays enabled.
function AnonymityNote({ holders }) {
  if (holders == null) return null;
  if (holders >= ANONYMITY_WARNING_BELOW) {
    return (
      <p className="text-muted small m-0 d-flex align-items-center">
        <Users size={14} className="mr-2 flex-shrink-0" />
        Anonymous among {holders} holders of this event.
      </p>
    );
  }
  return (
    <div className="info-hint-card is-warning m-0">
      <Info size={16} />
      <p>
        {holders <= 1
          ? "You're the only holder of this event so far, so this proof points straight at you."
          : `Only ${holders} holders of this event so far: whoever checks this proof may be able to tell it's you.`}
      </p>
    </div>
  );
}

const questionFor = (item) =>
  item.kind === "attendance"
    ? "Holds a valid POAP of this event"
    : item.rule
      ? describeRule(item.label, item.rule)
      : `${item.label} (accepted values not published)`;

// Big ranges take a few seconds to turn into the set the proof needs (attribute-types.ts).
const SLOW_SET_SIZE = 2000;

// Two modes, one per button on the POAP card:
//   "ownership" — Prove Ownership Anonymously: plain requests (proveEventAttendance), "I hold a
//                 valid POAP of this event" without saying which;
//   "detail"    — Prove a Private Detail: questions about one of the credential's private fields.
const MODES = {
  ownership: {
    kind: "attendance",
    title: "Prove Ownership Anonymously",
    intro:
      "Proves you hold a valid POAP of this event without revealing which one is yours or your wallet. Each proof takes one signature.",
    empty:
      "The organizer hasn't enabled proofs on this event yet. They can do it from their event card (Ask for Proof of Ownership).",
  },
  detail: {
    kind: "attribute",
    title: "Prove a Private Detail",
    intro:
      "Proves one of your credential's private details matches what was asked, without revealing the value. Questions are addressed to you by name (your key below), so whoever asked knows the answer is yours. Each proof takes one signature.",
    empty: "Nobody has asked you about this credential's private details yet.",
  },
};

// Anonymous proofs from the holder's own POAP (poapCard.jsx → SHOW_HOLDER_PROOFS, ctx.mode picks
// which ones). Lists the requests published for this event that the holder can answer and answers
// them with one signature each. The holder never publishes a request here, so nothing ties the
// proof to their caller_pk. Ends in the shared receipt (B8). Logic: src/midnight/holder-proofs.ts.
export default function HolderProofs() {
  const { midnight, holderProofsContext: ctx } = useDrawer();
  const dispatch = useDrawerDispatch();
  const service = midnight?.provider?.service;
  const mode = MODES[ctx?.mode] || MODES.ownership;

  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [holders, setHolders] = useState(null);

  useEffect(() => {
    if (!ctx || !service) return undefined;
    let cancelled = false;
    listAnswerableRequests(ctx.token.eventId, ctx.credentialFields || [], ctx.token.holderPk)
      .then((found) => {
        if (!cancelled) setItems(found.filter((item) => item.kind === mode.kind));
      })
      .catch((error) => {
        console.error("Error loading requests:", error);
        if (!cancelled) setLoadError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, service, mode.kind]);

  // Live (non-burned) POAPs of the event = the crowd an anonymous proof hides in.
  useEffect(() => {
    if (!ctx) return undefined;
    let cancelled = false;
    getEvent(ctx.token.eventId)
      .then((event) => {
        if (!cancelled && typeof event?.liveTokens === "number") setHolders(event.liveTokens);
      })
      .catch((error) => console.error("Error loading the event's holder count:", error));
    return () => {
      cancelled = true;
    };
  }, [ctx]);

  const closeDrawer = () => dispatch({ type: "CLOSE_DRAWER" });

  const answer = async (item) => {
    setBusyId(item.request.requestId);
    try {
      if (item.kind === "attribute" && ruleSize(item.rule) > SLOW_SET_SIZE) {
        loadingFunction(PROGRESS_TITLE, `Building the ${ruleSize(item.rule).toLocaleString()} accepted values…`, "");
        await setTreeFor(item.rule); // cached: proveAttribute reuses it
      }
      loadingFunction(PROGRESS_TITLE, "Preparing transaction…", "");
      const { txHash } =
        item.kind === "attendance"
          ? await proveAttendance(service, ctx.token, item.request.requestId, ctx.pkg)
          : await proveAttribute(service, ctx.token, item.request, item.rule, ctx.pkg);
      const record = {
        kind: item.kind === "attendance" ? "proveEventAttendance" : "proveCredentialAttribute",
        question: questionFor(item),
        txHash,
        provenAt: new Date(),
      };
      setReceipt(record);
      // Kept in this browser only: nothing on-chain links an attendance proof back to the token (an
      // attribute proof does name its holder, through the addressed request).
      addProofRecord(ctx.token.holderPk, ctx.token.tokenId, {
        ...record,
        txHash: txHash ?? null,
        provenAt: record.provenAt.toISOString(),
      });
      succesfullBlockchainCreation("Proof Submitted", txHash ? `Transaction: ${txHash}` : "", "");
    } catch (error) {
      console.error("Error proving:", error);
      errorFunction("Error", friendlyErrorMessage(error, "The proof failed. Please try again."), "");
    } finally {
      setBusyId(null);
    }
  };

  // Questions about private details must name the holder who answers (poap.compact's
  // proveCredentialAttribute), so whoever asks needs this key: the holder's pseudonym under this
  // event's organizer, already public as their token's owner.
  const [keyCopied, setKeyCopied] = useState(false);
  const copyHolderKey = async () => {
    try {
      await navigator.clipboard.writeText(ctx.token.holderPk);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  const organizerLabel = (verifierPk) => (verifierPk === ctx?.token.issuerPk ? "the organizer" : "someone else");

  return (
    <div className="d-flex flex-column w-100 drawer-modal-inner">
      <div className="drawer-header">
        <button className="btn wallet-modal-close" onClick={closeDrawer} aria-label="close">
          <X size={15} />
        </button>
        <h4 className="text-center w-100 m-0 font-weight-semibold">{mode.title}</h4>
      </div>

      <div className="drawer-body">
        {!service ? (
          <div className="alert alert-info" role="alert">
            Connect your wallet first.
          </div>
        ) : !ctx ? null : receipt ? (
          <ProofReceipt {...receipt} eventName={ctx.eventName} />
        ) : (
          <div className="d-flex flex-column" style={{ gap: "12px" }}>
            <div className="info-hint-card m-0">
              <EyeOff size={16} />
              <p>{mode.intro}</p>
            </div>

            {mode.kind === "attribute" ? (
              <div className="holder-proof-item">
                <div style={{ minWidth: 0 }}>
                  <p className="m-0 small font-weight-semibold">Your key for questions</p>
                  <p className="m-0 small text-muted text-break" title={ctx.token.holderPk}>
                    {ctx.token.holderPk}
                  </p>
                  <p className="m-0 small text-muted">Give it to whoever wants to ask you something.</p>
                </div>
                <button
                  type="button"
                  className="btn btn-card-detail-action btn-sm flex-shrink-0"
                  onClick={copyHolderKey}
                  aria-label="Copy your key"
                >
                  {keyCopied ? <Check size={14} className="mr-2" /> : <Copy size={14} className="mr-2" />}
                  {keyCopied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <AnonymityNote holders={holders} />
            )}

            {loadError ? (
              <div className="alert alert-danger m-0" role="alert">
                Could not load the requests for this event. Try again in a moment.
              </div>
            ) : !items ? (
              <p className="text-muted small m-0 d-flex align-items-center">
                <img src={loadingGif} width="14" height="14" alt="" className="mr-2" />
                Looking for requests on this event…
              </p>
            ) : items.length === 0 ? (
              <p className="text-muted small m-0">{mode.empty}</p>
            ) : (
              <ul className="list-unstyled m-0 d-flex flex-column" style={{ gap: "10px" }}>
                {items.map((item) => {
                  const isAttribute = item.kind === "attribute";
                  const qualifies = isAttribute ? valueQualifies(ctx.pkg, item.request.fieldId, item.rule) : true;
                  const hasValue = !isAttribute || Boolean(ctx.pkg?.fields.some((f) => f.fieldId === item.request.fieldId));
                  const reason = !isAttribute
                    ? null
                    : !item.rule
                      ? "The accepted values for this question aren't available."
                      : !hasValue
                        ? "Your credential has no value for this field."
                        : !qualifies
                          ? "Your value isn't one of the accepted ones."
                          : null;
                  return (
                    <li key={item.request.requestId} className="holder-proof-item">
                      <div>
                        <p className="m-0 small font-weight-semibold">{questionFor(item)}</p>
                        <p className="m-0 small text-muted">Asked by {organizerLabel(item.request.verifierPk)}</p>
                        {reason && <p className="m-0 small text-warning">{reason}</p>}
                      </div>
                      <button
                        type="button"
                        className="btn btn-card-detail-action btn-sm flex-shrink-0"
                        onClick={() => answer(item)}
                        disabled={Boolean(busyId) || Boolean(reason)}
                      >
                        <ShieldCheck size={14} className="mr-2" />
                        {busyId === item.request.requestId ? "Proving…" : "Prove"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="drawer-footer d-flex flex-column">
        <button className="btn btn-card-detail-action" onClick={closeDrawer}>
          {receipt ? "Done" : "Close"}
        </button>
      </div>
    </div>
  );
}
