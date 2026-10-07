import { useEffect, useState } from "react";
import { X, EyeOff, ShieldCheck, Users, Info, Copy, Check, Link2 } from "lucide-react";
import { useDrawer, useDrawerDispatch } from "../../contexts/drawer/drawer.provider";
import { errorFunction, loadingFunction, succesfullBlockchainCreation } from "../../toasts/sweetAlerts";
import {
  groupAnswerable,
  isIdentityRequest,
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
import { requestLink } from "../../../midnight/invite-links";
import { verifyUrl } from "../../../midnight/proof-verification";

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

// Why this request can't be answered right now, or null.
function reasonFor(item, pkg) {
  if (item.kind !== "attribute") return null;
  const hasValue = Boolean(pkg?.fields.some((f) => f.fieldId === item.request.fieldId));
  if (isIdentityRequest(item)) {
    if (!hasValue) return "Your credential has no document for this check.";
    return item.verified ? null : "This identity check doesn't match the document on your credential.";
  }
  if (!item.rule) return "The accepted values for this question aren't available.";
  if (!hasValue) return "Your credential has no value for this field.";
  if (!valueQualifies(pkg, item.request.fieldId, item.rule)) return "Your value isn't one of the accepted ones.";
  return null;
}

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
  const [receipts, setReceipts] = useState(null); // one per proof, after answering
  const [step, setStep] = useState(null); // "1 of 2" while a group is being answered
  const [holders, setHolders] = useState(null);

  useEffect(() => {
    if (!ctx || !service) return undefined;
    let cancelled = false;
    listAnswerableRequests(ctx.token.eventId, ctx.credentialFields || [], ctx.token.holderPk, ctx.pkg)
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

  // Answers every request of a group in turn — one signature each. A group is a single request, or
  // an identity check plus the questions its verifier asked with it (holder-proofs.ts).
  const answer = async (group) => {
    const groupId = group[0].request.requestId;
    setBusyId(groupId);
    const done = [];
    try {
      for (const [index, item] of group.entries()) {
        const label = group.length > 1 ? ` (${index + 1} of ${group.length})` : "";
        setStep(group.length > 1 ? `${index + 1} of ${group.length}` : null);
        if (item.kind === "attribute" && !isIdentityRequest(item) && ruleSize(item.rule) > SLOW_SET_SIZE) {
          loadingFunction(PROGRESS_TITLE + label, `Building the ${ruleSize(item.rule).toLocaleString()} accepted values…`, "");
          await setTreeFor(item.rule); // cached: proveAttribute reuses it
        }
        loadingFunction(PROGRESS_TITLE + label, "Preparing transaction…", "");
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
        done.push(record);
        // Kept in this browser only: nothing on-chain links an attendance proof back to the token (an
        // attribute proof does name its holder, through the addressed request).
        addProofRecord(ctx.token.holderPk, ctx.token.tokenId, {
          ...record,
          txHash: txHash ?? null,
          provenAt: record.provenAt.toISOString(),
        });
      }
      setReceipts(done);
      succesfullBlockchainCreation(
        done.length > 1 ? "Proofs Submitted" : "Proof Submitted",
        done.length === 1 && done[0].txHash ? `Transaction: ${done[0].txHash}` : "",
        "",
      );
    } catch (error) {
      console.error("Error proving:", error);
      const message = friendlyErrorMessage(error, "The proof failed. Please try again.");
      errorFunction(
        "Error",
        done.length ? `${done.length} of ${group.length} proofs went through. ${message}` : message,
        "",
      );
      if (done.length) setReceipts(done);
    } finally {
      setBusyId(null);
      setStep(null);
    }
  };

  // Questions about private details must name the holder who answers (poap.compact's
  // proveCredentialAttribute), so whoever asks needs this key: the holder's pseudonym under this
  // event's organizer, already public as their token's owner.
  // The request link carries the key plus this event, so someone other than the organizer can open
  // Ask for a Disclosure straight from it (requestLink.jsx) — Credential events aren't listed anywhere
  // else they could reach.
  // With identity documents, the link also carries their identity codes (never the numbers).
  const idCodes = Object.fromEntries(
    (ctx?.pkg?.fields || []).filter((field) => field.identity).map((field) => [field.fieldId, field.identity.saltHex]),
  );
  const linkHasCodes = Object.keys(idCodes).length > 0;
  const [copied, setCopied] = useState(null); // "key" | "link" | "combined"
  const copy = async (what) => {
    const text =
      what === "link"
        ? requestLink(window.location.origin, ctx.token.eventId, ctx.token.holderPk, idCodes)
        : what === "combined"
          ? verifyUrl(receipts.map((receipt) => receipt.txHash))
          : ctx.token.holderPk;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
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
        ) : !ctx ? null : receipts ? (
          <div className="d-flex flex-column" style={{ gap: "16px" }}>
            {receipts.length > 1 && receipts.every((receipt) => receipt.txHash) && (
              // Answered together (an identity check + its question): one link checks them all, so
              // whoever asked can't miss the identity proof (verifyProof.jsx).
              <div className="info-hint-card m-0">
                <ShieldCheck size={16} />
                <div style={{ minWidth: 0 }} className="flex-grow-1">
                  <p className="m-0 mb-2">
                    Send whoever asked <span className="text-white">this one link</span>: it checks all{" "}
                    {receipts.length} proofs together, identity included.
                  </p>
                  <div className="d-flex align-items-center" style={{ gap: "8px" }}>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      readOnly
                      aria-label="Link that checks all proofs"
                      value={verifyUrl(receipts.map((receipt) => receipt.txHash))}
                      onFocus={(event) => event.target.select()}
                    />
                    <button
                      type="button"
                      className="btn btn-card-detail-action btn-sm flex-shrink-0"
                      onClick={() => copy("combined")}
                      aria-label={copied === "combined" ? "Link copied" : "Copy the link that checks all proofs"}
                    >
                      {copied === "combined" ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {receipts.map((receipt, index) => (
              <ProofReceipt key={receipt.txHash || index} {...receipt} eventName={ctx.eventName} />
            ))}
          </div>
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
                  <p className="m-0 small text-muted">
                    Give the link (or the key) to whoever wants to ask you something.
                  </p>
                  {linkHasCodes && (
                    <p className="m-0 mt-1 small text-warning">
                      This link is personal: it includes your identity code. Give it only to whoever is
                      checking your document.
                    </p>
                  )}
                </div>
                <div className="d-flex flex-column flex-shrink-0" style={{ gap: "6px" }}>
                  <button
                    type="button"
                    className="btn btn-card-detail-action btn-sm"
                    onClick={() => copy("link")}
                    aria-label="Copy the link to ask you"
                  >
                    {copied === "link" ? <Check size={14} className="mr-2" /> : <Link2 size={14} className="mr-2" />}
                    {copied === "link" ? "Copied" : "Copy Link"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-card-detail-action btn-sm"
                    onClick={() => copy("key")}
                    aria-label="Copy your key"
                  >
                    {copied === "key" ? <Check size={14} className="mr-2" /> : <Copy size={14} className="mr-2" />}
                    {copied === "key" ? "Copied" : "Copy Key"}
                  </button>
                </div>
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
                {groupAnswerable(items).map((group) => {
                  const groupId = group[0].request.requestId;
                  const reasons = group.map((item) => reasonFor(item, ctx.pkg)).filter(Boolean);
                  const together = group.length > 1;
                  return (
                    <li key={groupId} className="holder-proof-item">
                      <div>
                        {group.map((item) => (
                          <p key={item.request.requestId} className="m-0 small font-weight-semibold">
                            {questionFor(item)}
                          </p>
                        ))}
                        <p className="m-0 small text-muted">
                          Asked by {organizerLabel(group[0].request.verifierPk)}
                          {together && ` · ${group.length} proofs, one signature each`}
                        </p>
                        {reasons.map((reason) => (
                          <p key={reason} className="m-0 small text-warning">{reason}</p>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-card-detail-action btn-sm flex-shrink-0"
                        onClick={() => answer(group)}
                        disabled={Boolean(busyId) || reasons.length > 0}
                      >
                        <ShieldCheck size={14} className="mr-2" />
                        {busyId === groupId ? (step ? `Proving ${step}…` : "Proving…") : together ? "Respond" : "Prove"}
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
          {receipts ? "Done" : "Close"}
        </button>
      </div>
    </div>
  );
}
