import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Copy, Check } from "lucide-react";
import {
  useDrawer,
  useDrawerDispatch,
} from "../../contexts/drawer/drawer.provider";
import { errorFunction } from "../../toasts/sweetAlerts";
import { generateHolderCode, mintLink, parsePastedInput } from "../../../midnight/invite-links";
import LinkQrCard from "../../components/LinkQrCard";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";

// getHolderPk(issuerId) is a per-organizer pseudonym (poap.compact) — deliberately DIFFERENT from
// the caller pk shown as "your address" everywhere else in the app. It's the only value an
// organizer can actually mintTo() a wallet with; sharing the wrong one (the plain address) results
// in an unrecoverable mint — see witnesses.ts's deriveHolderPk comment. This view exists purely so
// a subscriber can generate and copy that value for a specific organizer, out-of-band (chat,
// email, in person) — there's no on-chain "give me this" handshake to automate here.
//
// The code also carries this wallet's encryption key for the same organizer
// (`<holderPk>.<encryptionKey>`, see credential-crypto.ts), so a credential with private
// attributes can be delivered to it encrypted. Both halves are derived from local_sk: generating
// the code again always gives the same value.
//
// The result also comes as a mint link + QR (invite-links.ts): opening it opens Mint POAP with this
// code filled in. An organizer's invite link (/app/key, keyInvite.jsx) does all of this without
// pasting their key first.
//
// Opening one of those links in the address bar reloads the page and drops the wallet connection,
// so this popup ("Paste Link") also takes the links themselves: an invite, mint or request link is opened
// with an in-app navigation instead, keeping the session. A bare organizer key still works as before.
export default function GetHolderKey() {
  const { midnight } = useDrawer();
  const dispatch = useDrawerDispatch();
  const navigate = useNavigate();

  const [issuerPkHex, setIssuerPkHex] = useState("");
  const [holderPkHex, setHolderPkHex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const closeDrawer = () => {
    dispatch({ type: "CLOSE_DRAWER" });
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!midnight?.provider) return;

    const pasted = parsePastedInput(issuerPkHex);
    if (!pasted) {
      errorFunction(
        "Not a Link or Key",
        "Paste an invite link, a mint link, a request link, or an organizer's public key (64 hex characters).",
        ""
      );
      return;
    }
    if (pasted.kind !== "key") {
      closeDrawer();
      navigate(pasted.route);
      return;
    }

    setLoading(true);
    setHolderPkHex(null);
    setCopied(false);
    try {
      setHolderPkHex(await generateHolderCode(midnight.provider.service, pasted.organizerPkHex));
    } catch (error) {
      console.error("Error generating holder key:", error);
      errorFunction("Error", friendlyErrorMessage(error, "Failed to generate your key. Please try again."), "");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!holderPkHex) return;
    navigator.clipboard?.writeText(holderPkHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="d-flex flex-column w-100 drawer-modal-inner">
      <div className="drawer-header">
        <button
          className="btn wallet-modal-close"
          onClick={closeDrawer}
          aria-label="close"
        >
          <X size={15} />
        </button>
        <h4 className="text-center w-100 m-0 font-weight-semibold">
          Paste Link
        </h4>
      </div>

      <div className="drawer-body">
        {midnight?.provider ? (
          <form name="getHolderKeyForm" className="row g-3" onSubmit={handleGenerate}>
            <div className="col-12">
              <label className="form-label" htmlFor="issuerPkHex">Link or organizer key</label>
              <input
                id="issuerPkHex"
                type="text"
                className="form-control"
                placeholder="https://…/app/key#… or 64-character key"
                name="issuerPkHex"
                value={issuerPkHex}
                onChange={(event) => setIssuerPkHex(event.target.value)}
                required
              />
              <small className="form-text text-muted">
                Paste an invite link or a mint link someone sent you — it opens here without
                disconnecting your wallet. An organizer's public key also works: it generates your
                key for that one organizer (sharing it doesn't link it back to your other POAPs).
              </small>
            </div>

            {holderPkHex && (
              <div className="col-12 mt-3">
                <div className="drawer-modal-preview-card">
                  <p className="m-0 small text-muted mb-1">Your key for this organizer</p>
                  <div className="d-flex align-items-center justify-content-between">
                    <p className="m-0 text-break small font-weight-semibold mr-2">{holderPkHex}</p>
                    <button
                      type="button"
                      className="btn btn-card-detail-action btn-sm flex-shrink-0"
                      onClick={handleCopy}
                      aria-label={copied ? "Copied" : "Copy"}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <p className="text-muted small mb-0 mt-2">
                    Send this to the organizer — it's what they'll use to mint your POAP to. It also
                    lets them send you the credential's private details, encrypted so only you can
                    read them.
                  </p>
                </div>
                <div className="mt-3">
                  <LinkQrCard
                    url={mintLink(window.location.origin, holderPkHex)}
                    label="Or send this link"
                    hint="Opening it opens Mint POAP with your key already filled in. Together, the organizer can scan the QR."
                  />
                </div>
              </div>
            )}
          </form>
        ) : (
          <div className="alert alert-info" role="alert">
            Connect your wallet first, then paste the link here.
          </div>
        )}
      </div>

      {midnight?.provider && (
        <div className="drawer-footer">
          <button
            type="submit"
            className="btn btn-gradient btn-block"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? "Generating…" : "Continue"}
          </button>
        </div>
      )}
    </div>
  );
}
