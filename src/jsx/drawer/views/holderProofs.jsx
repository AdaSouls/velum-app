import { useEffect, useMemo, useState } from "react";
import { X, EyeOff, ShieldCheck, Users, Info, Copy, Check, Link2 } from "lucide-react";
import { useDrawer, useDrawerDispatch } from "../../contexts/drawer/drawer.provider";
import { errorFunction, loadingFunction, succesfullBlockchainCreation } from "../../toasts/sweetAlerts";
import {
  isIdentityCondition,
  listAnswerableRequests,
  proveAttendance,
  proveAttributes,
  setTreeFor,
  valueQualifies,
} from "../../../midnight/holder-proofs";
import { addProofRecord, getProofHistory } from "../../../midnight/proof-history";
import { getEvent } from "../../../midnight/indexer.service";
import { describeRule, ruleSize } from "../../../midnight/attribute-types";
import ProofReceipt from "../../components/ProofReceipt";
import loadingGif from "../../../images/loading.gif";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";
import { requestLink } from "../../../midnight/invite-links";

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

const conditionText = (condition) =>
  condition.rule ? describeRule(condition.label, condition.rule) : `${condition.label} (accepted values not published)`;

// One line per thing asked: a credential request can carry several conditions (an identity check
// and the question asked with it), all answered in one proof.
const questionLines = (item) =>
  item.kind === "attendance" ? ["Holds a valid POAP of this event"] : item.conditions.map(conditionText);

// Why this condition can't be answered right now, or null.
function conditionProblem(condition, pkg) {
  if (!condition.field) return "One of the questions is about a detail this credential doesn't have.";
  const hasValue = Boolean(pkg?.fields.some((f) => f.fieldId === condition.fieldId));
  if (isIdentityCondition(condition)) {
    if (!hasValue) return "Your credential has no document for this check.";
    return condition.verified ? null : "This identity check doesn't match the document on your credential.";
  }
  if (!condition.rule) return `The accepted values for ${condition.label} aren't available.`;
  if (!hasValue) return `Your credential has no value for ${condition.label}.`;
  if (!valueQualifies(pkg, condition.fieldId, condition.rule)) return `Your ${condition.label} isn't one of the accepted values.`;
  return null;
}

// Why this request can't be answered right now: every condition must hold, since they're answered
// together or not at all.
const problemsFor = (item, pkg) =>
  item.kind === "attribute" ? [...new Set(item.conditions.map((c) => conditionProblem(c, pkg)).filter(Boolean))] : [];

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
      "Proves your credential's private details match what was asked, without revealing them. Questions are addressed to you by name (your key below), so whoever asked knows the answer is yours. Each request is answered in one proof, with one signature.",
    empty: "Nobody has asked you about this credential's private details yet.",
  },
};

// Anonymous proofs from the holder's own POAP (poapCard.jsx → SHOW_HOLDER_PROOFS, ctx.mode picks
// which ones). Lists the requests published for this event that the holder can answer and answers
// each with one proof and one signature. The holder never publishes a request here, so nothing ties the
// proof to their caller_pk. Ends in the shared receipt (B8). Logic: src/midnight/holder-proofs.ts.
export default function HolderProofs() {
  const { midnight, holderProofsContext: ctx } = useDrawer();
  const dispatch = useDrawerDispatch();
  const service = midnight?.provider?.service;
  const mode = MODES[ctx?.mode] || MODES.ownership;

  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [receipt, setReceipt] = useState(null); // after answering
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

  // A request this browser already answered drops out (proof-history.ts keeps what it answered; the
  // Proof history has its receipts). A request can be answered again, so this is just tidying.
  const [answered, setAnswered] = useState(() => new Set());
  useEffect(() => {
    if (!ctx) return;
    setAnswered(
      new Set(
        getProofHistory(ctx.token.holderPk, ctx.token.tokenId)
          .map((record) => record.requestId?.toLowerCase())
          .filter(Boolean),
      ),
    );
  }, [ctx]);
  const pending = useMemo(
    () => (items ? items.filter((item) => !answered.has(item.request.requestId.toLowerCase())) : []),
    [items, answered],
  );

  const answer = async (item) => {
    const requestId = item.request.requestId;
    setBusyId(requestId);
    try {
      if (item.kind === "attribute") {
        const big = item.conditions.filter((c) => c.rule && !isIdentityCondition(c) && ruleSize(c.rule) > SLOW_SET_SIZE);
        for (const condition of big) {
          loadingFunction(PROGRESS_TITLE, `Building the ${ruleSize(condition.rule).toLocaleString()} accepted values…`, "");
          await setTreeFor(condition.rule); // cached: proveAttributes reuses it
        }
      }
      loadingFunction(PROGRESS_TITLE, "Preparing transaction…", "");
      const { txHash } =
        item.kind === "attendance"
          ? await proveAttendance(service, ctx.token, requestId, ctx.pkg)
          : await proveAttributes(service, ctx.token, item.request, item.conditions, ctx.pkg);
      const done = {
        kind: item.kind === "attendance" ? "proveEventAttendance" : "proveCredentialAttributes",
        question: questionLines(item).join(" · "),
        txHash,
        provenAt: new Date(),
        requestId,
      };
      // Kept in this browser only: nothing on-chain links an attendance proof back to the token (an
      // attribute proof does name its holder, through the addressed request).
      addProofRecord(ctx.token.holderPk, ctx.token.tokenId, {
        ...done,
        txHash: txHash ?? null,
        provenAt: done.provenAt.toISOString(),
      });
      setAnswered((current) => new Set([...current, requestId.toLowerCase()]));
      setReceipt(done);
      succesfullBlockchainCreation("Proof Submitted", txHash ? `Transaction: ${txHash}` : "", "");
    } catch (error) {
      console.error("Error proving:", error);
      errorFunction("Error", friendlyErrorMessage(error, "The proof failed. Please try again."), "");
    } finally {
      setBusyId(null);
    }
  };

  // Questions about private details must name the holder who answers (poap.compact's
  // proveCredentialAttributes), so whoever asks needs this key: the holder's pseudonym under this
  // event's organizer, already public as their token's owner.
  // The request link carries the key plus this event, so someone other than the organizer can open
  // Ask for a Disclosure straight from it (requestLink.jsx) — Credential events aren't listed anywhere
  // else they could reach.
  // With identity documents, the link also carries their identity codes (never the numbers).
  const idCodes = Object.fromEntries(
    (ctx?.pkg?.fields || []).filter((field) => field.identity).map((field) => [field.fieldId, field.identity.saltHex]),
  );
  const linkHasCodes = Object.keys(idCodes).length > 0;
  const [copied, setCopied] = useState(null); // "key" | "link"
  const copy = async (what) => {
    const text =
      what === "link" ? requestLink(window.location.origin, ctx.token.eventId, ctx.token.holderPk, idCodes) : ctx.token.holderPk;
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
            ) : pending.length === 0 ? (
              <p className="text-muted small m-0">{items.length ? "You've answered every request on this POAP." : mode.empty}</p>
            ) : (
              <ul className="list-unstyled m-0 d-flex flex-column" style={{ gap: "10px" }}>
                {pending.map((item) => {
                  const requestId = item.request.requestId;
                  const problems = problemsFor(item, ctx.pkg);
                  const several = item.kind === "attribute" && item.conditions.length > 1;
                  return (
                    <li key={requestId} className="holder-proof-item">
                      <div>
                        {questionLines(item).map((line, index) => (
                          <p key={index} className="m-0 small font-weight-semibold">
                            {line}
                          </p>
                        ))}
                        <p className="m-0 small text-muted">
                          Asked by {organizerLabel(item.request.verifierPk)}
                          {several && ` · ${item.conditions.length} answers, one proof`}
                        </p>
                        {problems.map((problem) => (
                          <p key={problem} className="m-0 small text-warning">{problem}</p>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-card-detail-action btn-sm flex-shrink-0"
                        onClick={() => answer(item)}
                        disabled={Boolean(busyId) || problems.length > 0}
                      >
                        <ShieldCheck size={14} className="mr-2" />
                        {busyId === requestId ? "Proving…" : several ? "Respond" : "Prove"}
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
