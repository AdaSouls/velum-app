import { useState } from "react";
import { BadgeCheck, Check, Copy, ExternalLink } from "lucide-react";
import { explorerTxUrl } from "../../utils/midnightExplorer";
import { PROOF_KINDS, verifyUrl } from "../../midnight/proof-verification";

const truncateHex = (hex) => (hex ? `${hex.slice(0, 10)}…${hex.slice(-8)}` : "N/A");

// B8 — the one receipt every proof ends in (ownership, attendance, private detail). It's what the
// holder shows. The verify link opens /app/verify, which checks the transaction on the Midnight
// indexer without needing a wallet (src/midnight/proof-verification.ts).
//
// kind: a circuit name from PROOF_KINDS. question: what was proven, in words ("Sector is one of:
// Campo, Platea"). eventName / tokenId: context; tokenId only for ownership (the other proofs
// don't reveal it).
//
// groupTxHashes: every transaction of a group answered together (an identity check + its question,
// holderProofs.jsx), so this receipt's link checks the whole set — never the question alone.
export default function ProofReceipt({ kind, question, eventName, tokenId, txHash, provenAt, groupTxHashes }) {
  const info = PROOF_KINDS[kind] || { title: "Proof", description: "" };
  const [copied, setCopied] = useState(false);
  const inGroup = groupTxHashes?.length > 1;
  const link = txHash ? verifyUrl(inGroup ? groupTxHashes : txHash) : null;

  const copyLink = async () => {
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused — the link is still visible to select by hand.
    }
  };

  return (
    <div className="proof-receipt">
      <div className="poap-verified-seal-card">
        <BadgeCheck size={36} className="poap-verified-seal-icon flex-shrink-0" />
        <div>
          <p className="m-0 font-weight-semibold">{info.title}</p>
          <p className="m-0 text-muted small">{info.description}</p>
        </div>
      </div>

      <dl className="proof-receipt-facts">
        {question && (
          <>
            <dt>Proven</dt>
            <dd>{question}</dd>
          </>
        )}
        {eventName && (
          <>
            <dt>Event</dt>
            <dd>{eventName}</dd>
          </>
        )}
        {tokenId !== undefined && tokenId !== null && (
          <>
            <dt>Token</dt>
            <dd>#{String(tokenId)}</dd>
          </>
        )}
        <dt>When</dt>
        <dd>{(provenAt || new Date()).toLocaleString()}</dd>
        <dt>Transaction</dt>
        <dd>
          {txHash ? (
            <a href={explorerTxUrl(txHash)} target="_blank" rel="noopener noreferrer" className="text-white">
              {truncateHex(txHash)} <ExternalLink size={12} />
            </a>
          ) : (
            "N/A"
          )}
        </dd>
      </dl>

      {link && (
        <div className="proof-receipt-verify">
          <p className="m-0 small text-muted">
            {inGroup
              ? `Anyone can check this proof with the other ${groupTxHashes.length - 1} answered with it, no wallet needed:`
              : "Anyone can check this proof, no wallet needed:"}
          </p>
          <div className="d-flex align-items-center" style={{ gap: "8px" }}>
            <input
              id="proofVerifyLink"
              type="text"
              className="form-control form-control-sm"
              value={link}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <button
              type="button"
              className="btn btn-card-detail-action btn-sm flex-shrink-0"
              onClick={copyLink}
              aria-label={copied ? "Verify link copied" : "Copy verify link"}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
