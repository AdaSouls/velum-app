import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Award, BadgeCheck, CircleAlert, ExternalLink, Search } from "lucide-react";
import Layout from "../layout/layout";
import { blockTimestamp, lookupProofTransaction, parseProofHashes, PROOF_KINDS } from "../../midnight/proof-verification";
import { describeValidity, formatUntil, parseValidity, validityStatus } from "../../midnight/validity";
import { decodeProofDetails, isZeroHex } from "../../midnight/proof-transcript";
import { getEvent, getToken } from "../../midnight/indexer.service";
import { fetchMetadata } from "../hooks/useEventMetadata";
import { describeRule, isIdentityField } from "../../midnight/attribute-types";
import { documentLabel } from "../../midnight/identity";
import { explorerBlockUrl, explorerTxUrl } from "../../utils/midnightExplorer";
import { friendlyErrorMessage } from "../../midnight/friendly-error";

const truncateHex = (hex) => (hex ? `${hex.slice(0, 10)}…${hex.slice(-8)}` : "N/A");

// What the proof was about, in words — one line per thing proven, built from what the transaction
// itself disclosed (proof-transcript.ts) plus the event's public metadata. Never from the receipt.
function questionLines(entryPoint, details, context) {
  if (entryPoint === "proveTokenOwnership") return [`Owns POAP #${String(details.tokenId)} of this event`];
  if (entryPoint === "proveEventAttendance") return ["Holds a valid POAP of this event (which one isn't revealed)"];
  const scope = entryPoint === "proveAttributeMembership" || entryPoint === "proveAttributeMembershipOnce" ? " of the event" : "";
  const conditions = context?.conditions?.length ? context.conditions : [{ label: null, rule: null }];
  return conditions.map(({ label, rule }) => {
    const subject = `${label || "A private detail"}${scope}`;
    return rule ? describeRule(subject, rule) : `${subject} is one of the accepted values (list not published)`;
  });
}

// Event, token and question context for a decoded proof. Every lookup is best-effort: the proof
// is valid on its own; this only puts names on it.
// Validity (validity.ts) of what this proof showed, when the event sets one and it can be told:
// a Subscription's runs from each ownership proof, so from this one; an Event's or Credential's
// runs from the token's mint, known only when the proof names the token. An anonymous credential
// proof can't say which credential it was — its holder proves "Valid until" as a private detail.
async function loadValidity(entryPoint, metadata, token, proofTimestamp) {
  const validity = parseValidity(metadata?.validity);
  if (!validity) return null;
  const holding = entryPoint === "proveTokenOwnership" || entryPoint === "proveEventAttendance";
  if (metadata?.category === "subscription") {
    return holding && proofTimestamp ? { validity, fromMs: proofTimestamp, basis: "this proof" } : null;
  }
  if (entryPoint === "proveTokenOwnership" && token?.mintedBlock != null) {
    const mintedMs = await blockTimestamp(token.mintedBlock);
    return mintedMs ? { validity, fromMs: mintedMs, basis: "when it was issued" } : null;
  }
  return null;
}

// One condition's label and question. An identity check: its one value is known only to whoever
// asked and the holder, so this page can't rebuild the set — it says what kind of question it was;
// the asker knows which document.
async function describeCondition(entryPoint, details, { fieldId, setRoot }, fields) {
  const field = (fields || []).find((f) => f.fieldId?.toLowerCase() === fieldId);
  if (isIdentityField(field)) return { label: `${field.label} (${documentLabel(field)})`, rule: { op: "identity" } };
  let rule = null;
  if (!isZeroHex(setRoot)) {
    // holder-proofs pulls in the compiled contract — only load it when a set has to be checked.
    // checkAll: a question shown on this page must match the on-chain root, even a big range.
    const { fetchRequestRule } = await import("../../midnight/holder-proofs");
    const found = await fetchRequestRule(details.requestId, setRoot, { checkAll: true }).catch(() => null);
    rule = found?.verified ? found.rule : null;
  }
  return { label: field?.label || null, rule };
}

async function loadProofContext(entryPoint, details, proofTimestamp) {
  const event = await getEvent(details.eventId).catch(() => null);
  const metadata = event?.metadataURI ? await fetchMetadata(event.metadataURI) : null;
  const token = details.tokenId !== null ? await getToken(details.tokenId).catch(() => null) : null;

  const fields =
    entryPoint === "proveAttributeMembership" || entryPoint === "proveAttributeMembershipOnce"
      ? metadata?.privateAttributeFields
      : metadata?.credentialAttributeFields;
  const asked = details.conditions || (!isZeroHex(details.fieldId) ? [{ fieldId: details.fieldId, setRoot: details.setRoot }] : []);
  const conditions = await Promise.all(asked.map((condition) => describeCondition(entryPoint, details, condition, fields)));
  const validityInfo = await loadValidity(entryPoint, metadata, token, proofTimestamp).catch(() => null);
  return { event, metadata, token, conditions, validityInfo };
}

// One proof on the page: looks the transaction up and decodes what it proved.
function ProofSection({ hash, contractAddress }) {
  const [result, setResult] = useState(null);
  const [details, setDetails] = useState(null);
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    setDetails(null);
    setContext(null);
    lookupProofTransaction(hash, contractAddress)
      .then(async (found) => {
        if (cancelled) return;
        setResult(found);
        const isProof = found.status === "found" && found.isOurContract && PROOF_KINDS[found.entryPoint]?.isProof;
        if (!isProof || !found.raw) {
          return;
        }
        const decoded = await decodeProofDetails(found.raw, contractAddress).catch((decodeError) => {
          console.error("Could not read the proof's details from the transaction:", decodeError);
          return null;
        });
        if (cancelled) return;
        if (!decoded) {
          return;
        }
        setDetails(decoded);
        // Context only puts names on the proof; a failed lookup doesn't make it invalid.
        const loaded = await loadProofContext(found.entryPoint, decoded, found.timestamp).catch((contextError) => {
          console.error("Could not load the proof's context:", contextError);
          return null;
        });
        if (cancelled) return;
        setContext(loaded);
      })
      .catch((lookupError) => {
        if (cancelled) return;
        setError(friendlyErrorMessage(lookupError, "Could not look up this proof. Try again in a moment."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hash, contractAddress]);

  const kind = result?.status === "found" ? PROOF_KINDS[result.entryPoint] : null;
  const valid = result?.status === "found" && result.isOurContract && kind?.isProof && result.succeeded !== false;
  const event = context?.event;
  const metadata = context?.metadata;
  const token = context?.token;
  const askedByOrganizer = details && event && details.verifierPk === event.issuerPk?.toLowerCase();
  const validityInfo = context?.validityInfo;
  const validityNow = validityInfo ? validityStatus(validityInfo.validity, validityInfo.fromMs) : null;
  const found = result?.status === "found";

  return (
    <>
      {found && (
        <>
          <div className="verify-proof-heading">
            {valid ? (
              <BadgeCheck size={128} strokeWidth={1.25} className="poap-verified-seal-icon" />
            ) : (
              <CircleAlert size={128} strokeWidth={1.25} className="text-warning" />
            )}
            <p className="m-0 verify-proof-title">
              {valid
                ? kind.title
                : result.isOurContract && kind?.isProof
                  ? "Failed transaction"
                  : result.isOurContract
                    ? "Not a proof"
                    : "Not a Velum POAP transaction"}
            </p>
            {valid && <span className="badge verify-proof-valid-badge">Valid proof</span>}
            <p className="m-0 text-muted">
              {valid
                ? kind.description
                : result.isOurContract && kind?.isProof
                  ? "The transaction was recorded but did not succeed, so it proves nothing."
                  : result.isOurContract
                    ? `This transaction called "${result.entryPoint}", which doesn't prove anything about a POAP.`
                    : "This transaction exists, but it doesn't call the Velum POAP contract."}
            </p>
          </div>

          {valid && details && (
            <div className="verify-proof-event">
              <div className="verify-proof-event-thumb">
                {metadata?.imageUrl ? <img src={metadata.imageUrl} alt="" /> : <Award size={28} className="text-muted" />}
              </div>
              <div style={{ minWidth: 0 }}>
                <p className="m-0 small text-muted">Event</p>
                <p className="m-0 font-weight-semibold text-truncate">
                  {metadata?.name || (context ? `Event ${truncateHex(details.eventId)}` : "Loading…")}
                </p>
                {metadata?.organization?.name && (
                  <p className="m-0 small text-muted text-truncate">by {metadata.organization.name}</p>
                )}
              </div>
            </div>
          )}

          <dl className="proof-receipt-facts verify-proof-facts m-0">
            {valid && details && (
              <>
                <dt>Proven</dt>
                <dd>
                  {questionLines(result.entryPoint, details, context).map((line, index) => (
                    <span key={index} className="d-block">
                      {line}
                    </span>
                  ))}
                </dd>
                {details.tokenId !== null && (
                  <>
                    <dt>Token</dt>
                    <dd>
                      #{String(details.tokenId)}
                      {token && (
                        <span className={token.isBurned ? "text-warning" : "text-muted"}>
                          {token.isBurned ? ` · revoked since block ${token.burnedBlock ?? "N/A"}` : " · still held today"}
                        </span>
                      )}
                    </dd>
                  </>
                )}
                {validityNow?.untilMs && (
                  <>
                    <dt>Validity</dt>
                    <dd className={validityNow.state === "expired" ? "text-warning" : undefined}>
                      {validityNow.state === "expired" ? "Expired on " : "Valid until "}
                      {formatUntil(validityNow.untilMs, validityInfo.validity)}
                      <span className="text-muted">
                        {" "}
                        · {describeValidity(validityInfo.validity)} from {validityInfo.basis}
                      </span>
                    </dd>
                  </>
                )}
                <dt>Asked by</dt>
                <dd title={details.verifierPk}>
                  {askedByOrganizer ? "The event's organizer" : `Someone else (${truncateHex(details.verifierPk)})`}
                </dd>
                {details.recipientPk && (
                  <>
                    {/* An addressed request can only be answered by the holder it names. */}
                    <dt>Answered by</dt>
                    <dd title={details.recipientPk}>The holder it was addressed to ({truncateHex(details.recipientPk)})</dd>
                  </>
                )}
              </>
            )}
            <dt>When</dt>
            <dd>{result.timestamp ? new Date(result.timestamp).toLocaleString() : "N/A"}</dd>
            <dt>Block</dt>
            <dd>
              {result.blockHeight !== null ? (
                <a href={explorerBlockUrl(result.blockHeight)} target="_blank" rel="noopener noreferrer" className="text-white">
                  {result.blockHeight} <ExternalLink size={12} />
                </a>
              ) : (
                "N/A"
              )}
            </dd>
            <dt>Transaction</dt>
            <dd>
              <a href={explorerTxUrl(result.hash)} target="_blank" rel="noopener noreferrer" className="text-white">
                {truncateHex(result.hash)} <ExternalLink size={12} />
              </a>
            </dd>
            {valid && details && (
              <>
                <dt>Event ID</dt>
                <dd title={details.eventId}>{truncateHex(details.eventId)}</dd>
                <dt>Request ID</dt>
                <dd title={details.requestId}>{truncateHex(details.requestId)}</dd>
              </>
            )}
            {result.entryPoint && (
              <>
                <dt>Circuit</dt>
                <dd>{result.entryPoint}</dd>
              </>
            )}
            <dt>Contract</dt>
            <dd title={contractAddress}>{truncateHex(contractAddress)}</dd>
          </dl>

          {valid && (
            <p className="text-muted small m-0 text-center">
              A proof only reaches the chain if it's correct, so a confirmed transaction is the proof. It
              shows the holder had this POAP at that moment; ask for a new proof to check they still do.
            </p>
          )}
        </>
      )}

      {loading && !result && <p className="text-muted small m-0 text-center">Checking on the Midnight network…</p>}
      {error && (
        <div className="alert alert-danger m-0" role="alert">
          {error}
        </div>
      )}
      {result?.status === "not-found" && (
        <div className="alert alert-danger m-0" role="alert">
          No transaction with this hash exists on this network. The proof is not valid here.
        </div>
      )}
    </>
  );
}

// B8 — public check of a proof receipt (ProofReceipt.jsx's verify link). No wallet: reads the
// transaction straight from the Midnight indexer, and what it proved from its own transcript. One
// transaction per proof: a credential request's conditions (an identity check and its question) are
// all answered in the same one. The box still takes several hashes, each checked on its own.
export default function VerifyProof() {
  const [searchParams] = useSearchParams();
  const [txHash, setTxHash] = useState(searchParams.get("tx") || "");
  const [submitted, setSubmitted] = useState(searchParams.get("tx") || "");
  const hashes = useMemo(() => parseProofHashes(submitted), [submitted]);
  const contractAddress = process.env.REACT_APP_MIDNIGHT_CONTRACT_ADDRESS;

  const verifyForm = (
    <form
      className="d-flex w-100"
      style={{ gap: "8px" }}
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        setSubmitted(txHash);
      }}
    >
      <input
        id="verifyTxHash"
        type="text"
        className="form-control"
        placeholder="Transaction hash from the proof receipt (several: separate with commas)"
        value={txHash}
        onChange={(changeEvent) => setTxHash(changeEvent.target.value)}
      />
      <button type="submit" className="btn btn-gradient flex-shrink-0" disabled={!txHash.trim()}>
        <Search size={14} className="mr-2" />
        Verify
      </button>
    </form>
  );

  return (
    <Layout>
      <div className="verify-proof-page">
        <div className="drawer-modal-preview-card verify-proof-card">
          {hashes.length === 0 && (
            <div className="verify-proof-heading">
              <BadgeCheck size={96} strokeWidth={1.25} className="text-muted" />
              <p className="m-0 verify-proof-title">Verify a Proof</p>
              <p className="m-0 text-muted small">
                Paste the transaction hash from a proof receipt. No wallet needed: the proof is checked on
                the Midnight network.
              </p>
            </div>
          )}

          {hashes.map((hash, index) => (
            <React.Fragment key={hash}>
              {(index > 0 || hashes.length > 1) && <hr className="verify-proof-divider m-0" />}
              <ProofSection hash={hash} contractAddress={contractAddress} />
            </React.Fragment>
          ))}

          <div className="verify-proof-footer">
            {hashes.length > 0 && <p className="m-0 small text-muted">Verify another proof</p>}
            {verifyForm}
          </div>
        </div>
      </div>
    </Layout>
  );
}
