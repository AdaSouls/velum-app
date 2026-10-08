import { useEffect, useState } from "react";
import { X, Info, Check, Copy, CircleAlert, ShieldCheck, Flame, RefreshCw } from "lucide-react";
import { useDrawer, useDrawerDispatch } from "../../contexts/drawer/drawer.provider";
import { errorFunction, loadingFunction, succesfullBlockchainCreation } from "../../toasts/sweetAlerts";
import { fetchUpdateRequest, reissueValues } from "../../../midnight/credential-update";
import {
  buildCredentialAttributes,
  credentialPathOnChain,
  deliverCredentialPackage,
  packageToLinkFragment,
} from "../../../midnight/credential-delivery";
import { getReissueRecord, removeReissueRecord, saveReissueRecord } from "../../../midnight/reissue-store";
import { notifyTokenBurned } from "../../../midnight/token-events";
import { documentLabel } from "../../../midnight/identity";
import { txHashOf } from "../../../midnight/tx-result";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";
import { MINT_BLOCKER_MESSAGES, mintBlockers } from "../../../midnight/mint-readiness";
import loadingGif from "../../../images/loading.gif";

const truncateHex = (hex) => (hex ? `${hex.slice(0, 10)}…${hex.slice(-8)}` : "N/A");
const fromHex = (value) => Uint8Array.from(Buffer.from(value, "hex"));

const STEP_REVIEW = "review";
const STEP_REVOKE = "revoke";
const STEP_ISSUE = "issue";
const STEPS = [STEP_REVIEW, STEP_REVOKE, STEP_ISSUE];

// The organizer's side of a credential update request (credential-update.ts), opened from the
// subscribers list (SHOW_REVIEW_UPDATE). Three guided steps, one signature each where there is one:
//   1. Review — open the holder's sealed request with this identity's inbox key, check that the
//      credential it describes is the one on-chain, compare old and new document. Dismiss
//      (dismissCredentialUpdate) or go on.
//   2. Revoke — burn(tokenId), which also closes the request on-chain.
//   3. Issue — mintTo the same holder pseudonym with the updated values (fresh openings, a new
//      identity code), reusing the old token's metadata (same images), and deliver the private
//      details encrypted to the holder's key from the request.
// Between 2 and 3 the holder has no credential, so a record (reissue-store.ts) is saved before the
// burn; reopening from the subscribers list ("Finish re-issue") resumes at step 3.
// Before any of that, the event must still accept a new mint (mint-readiness.ts: active, not
// expired, supply left, organizer not blocked, contract not paused) — checked on open and again
// right before the burn, so a re-issue that can't finish never revokes the old credential.
export default function ReviewCredentialUpdate() {
  const { midnight, reviewUpdateContext: ctx } = useDrawer();
  const dispatch = useDrawerDispatch();
  const service = midnight?.provider?.service;

  const [step, setStep] = useState(ctx?.resume ? STEP_ISSUE : STEP_REVIEW);
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState(ctx?.resume ? "ready" : "loading"); // loading | ready | unreadable | error
  const [matchesChain, setMatchesChain] = useState(null);
  const [record, setRecord] = useState(ctx?.resume || null);
  const [busy, setBusy] = useState(false);
  const [deliveryLink, setDeliveryLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [blockers, setBlockers] = useState([]);

  const template = ctx?.credentialFields || [];
  const fieldLabel = (fieldId) => template.find((field) => field.fieldId === fieldId)?.label || "Field";

  useEffect(() => {
    if (!ctx || ctx.resume || !service) return undefined;
    let cancelled = false;
    (async () => {
      const inbox = await service.getInboxKeyPair();
      const found = await fetchUpdateRequest(ctx.request.payloadCommit, inbox);
      if (cancelled) return;
      // It must be about this very token, from its owner.
      if (!found || found.tokenId !== Number(ctx.token.tokenId) || found.holderPk !== ctx.token.ownerPk?.toLowerCase()) {
        setStatus("unreadable");
        return;
      }
      setPayload(found);
      setStatus("ready");
      const { ledger } = await service.getState();
      const path = await credentialPathOnChain(
        ledger.credentials,
        ctx.token.tokenId,
        ctx.event.eventId,
        found.holderPk,
        found.currentPackage.credAttrRoot,
      );
      if (!cancelled) setMatchesChain(Boolean(path));
    })().catch((error) => {
      console.error("Error opening the update request:", error);
      if (!cancelled) setStatus("error");
    });
    return () => {
      cancelled = true;
    };
  }, [ctx, service]);

  const eventIdHex = ctx?.resume?.eventId || ctx?.event?.eventId;
  useEffect(() => {
    if (!eventIdHex || !service) return undefined;
    let cancelled = false;
    service
      .getState()
      .then(({ ledger }) => {
        if (!cancelled) setBlockers(mintBlockers(ledger, eventIdHex));
      })
      .catch((error) => console.warn("Could not check whether the event still accepts a re-issue:", error));
    return () => {
      cancelled = true;
    };
  }, [eventIdHex, service]);
  const isBlocked = blockers.length > 0;

  const closeDrawer = () => dispatch({ type: "CLOSE_DRAWER" });

  const handleDismiss = async () => {
    setBusy(true);
    try {
      loadingFunction("Dismissing Request", "Preparing transaction…", "");
      const txHash = txHashOf(await service.dismissCredentialUpdate(BigInt(ctx.token.tokenId)));
      closeDrawer();
      succesfullBlockchainCreation("Request Dismissed", txHash ? `Transaction: ${txHash}` : "", "");
    } catch (error) {
      console.error("Error dismissing the update request:", error);
      errorFunction("Error", friendlyErrorMessage(error, "Failed to dismiss the request. Please try again."), "");
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    const next = {
      stage: "burning",
      tokenId: Number(ctx.token.tokenId),
      eventId: ctx.event.eventId,
      issuerPk: ctx.event.issuerPk,
      holderPk: payload.holderPk,
      holderEncryptionKey: payload.holderEncryptionKey,
      tokenMetadataURI: ctx.token.tokenMetadataURI || "",
      values: reissueValues(payload),
      payloadCommit: ctx.request.payloadCommit,
      savedAt: new Date().toISOString(),
    };
    setBusy(true);
    try {
      // Fresh state: the event may have expired or filled up since the popup opened.
      const latest = mintBlockers((await service.getState()).ledger, next.eventId);
      if (latest.length) {
        setBlockers(latest);
        setStep(STEP_REVIEW);
        return;
      }
      saveReissueRecord(next);
      loadingFunction("Revoking the Old Credential", "Preparing transaction…", "");
      await service.burn(BigInt(ctx.token.tokenId));
      const burned = { ...next, stage: "burned" };
      saveReissueRecord(burned);
      setRecord(burned);
      notifyTokenBurned(ctx.event.eventId, ctx.token.tokenId);
      setStep(STEP_ISSUE);
    } catch (error) {
      console.error("Error revoking the old credential:", error);
      // Nothing was burned: the record would only offer a re-issue that isn't due.
      if (getReissueRecord(next.eventId, next.tokenId)?.stage === "burning") removeReissueRecord(next.eventId, next.tokenId);
      errorFunction("Error", friendlyErrorMessage(error, "Failed to revoke the credential. Please try again."), "");
    } finally {
      setBusy(false);
    }
  };

  const handleIssue = async () => {
    setBusy(true);
    try {
      loadingFunction("Issuing the Updated Credential", "Preparing the private details…", "");
      const { fields, root } = await buildCredentialAttributes(template, record.values);
      loadingFunction("Issuing the Updated Credential", "Preparing transaction…", "");
      const txHash = txHashOf(
        await service.mintTo(fromHex(record.eventId), fromHex(record.holderPk), record.tokenMetadataURI, new Uint8Array(32), root),
      );
      removeReissueRecord(record.eventId, record.tokenId);
      const pkg = {
        version: 1,
        eventId: record.eventId,
        issuerPk: record.issuerPk,
        holderPk: record.holderPk,
        credAttrRoot: Buffer.from(root).toString("hex"),
        fields,
      };
      try {
        loadingFunction("Issuing the Updated Credential", "Sending the private details, encrypted…", "");
        await deliverCredentialPackage(pkg, record.holderEncryptionKey);
      } catch (deliveryError) {
        console.error("Encrypted delivery failed, falling back to a link:", deliveryError);
        setDeliveryLink(`${window.location.origin}/app/credential#${packageToLinkFragment(pkg)}`);
        succesfullBlockchainCreation("Credential Re-issued — Send the Private Link", txHash ? `Transaction: ${txHash}` : "", "");
        return;
      }
      closeDrawer();
      succesfullBlockchainCreation(
        "Credential Re-issued",
        `The holder will find the updated credential in My Subscriptions.${txHash ? ` Transaction: ${txHash}` : ""}`,
        "",
      );
    } catch (error) {
      console.error("Error issuing the updated credential:", error);
      errorFunction(
        "Error",
        `${friendlyErrorMessage(error, "Failed to issue the updated credential.")} The old one is already revoked: you can finish from the subscribers list (Finish Re-issue).`,
        "",
      );
    } finally {
      setBusy(false);
    }
  };

  const copyDeliveryLink = () => {
    navigator.clipboard?.writeText(deliveryLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const renderChange = (change) => {
    const field = payload.currentPackage.fields.find((f) => f.fieldId === change.fieldId);
    return (
      <li key={change.fieldId} className="mb-2">
        <span className="text-muted">
          {fieldLabel(change.fieldId)}
          {field?.identity && ` (${documentLabel(field.identity)})`}:{" "}
        </span>
        <span className="text-white">{field?.identity?.number || "—"}</span>
        <span className="text-muted"> → </span>
        <span className="text-white">{change.number}</span>
      </li>
    );
  };

  const renderReview = () => {
    if (status === "loading") {
      return (
        <p className="text-muted small d-flex align-items-center m-0">
          <img src={loadingGif} width="14" height="14" alt="" className="mr-2" />
          Opening the request…
        </p>
      );
    }
    if (status !== "ready") {
      return (
        <div className="info-hint-card is-warning m-0">
          <CircleAlert size={16} />
          <p>
            {status === "unreadable"
              ? "This request can't be read with your key (it may have been sent for another identity, or tampered with). You can dismiss it."
              : "Could not open the request. Try again in a moment."}
          </p>
        </div>
      );
    }
    return (
      <div className="d-flex flex-column" style={{ gap: "12px" }}>
        <p className="small m-0">
          <span className="text-muted">Holder: </span>
          <span className="text-white">{truncateHex(payload.holderPk)}</span>
          <span className="text-muted"> · Token #{String(ctx.token.tokenId)}</span>
        </p>
        <ul className="list-unstyled small m-0">{payload.changes.map(renderChange)}</ul>
        {payload.reason && (
          <p className="small m-0">
            <span className="text-muted">Reason: </span>
            <span className="text-white">{payload.reason}</span>
          </p>
        )}
        {matchesChain === false ? (
          <div className="info-hint-card is-warning m-0">
            <CircleAlert size={16} />
            <p>
              The details in this request don't match this credential on-chain, so it can't be re-issued
              from them. Dismiss it, or ask the holder to send it again.
            </p>
          </div>
        ) : matchesChain ? (
          <p className="small text-muted m-0 d-flex align-items-center">
            <ShieldCheck size={14} className="mr-2 flex-shrink-0" />
            The current details match this credential on-chain.
          </p>
        ) : null}
        <div className="info-hint-card m-0">
          <Info size={16} />
          <p>
            Check the holder's new document before re-issuing. Re-issuing revokes this credential and issues
            a new one to the same holder, with the same images and the new number (two signatures).
          </p>
        </div>
      </div>
    );
  };

  const renderBlockers = () =>
    isBlocked && (
      <div className="info-hint-card is-warning m-0">
        <CircleAlert size={16} />
        <p>
          {record ? "The updated credential can't be issued: " : "This credential can't be re-issued, so it isn't revoked: "}
          {blockers.map((blocker) => MINT_BLOCKER_MESSAGES[blocker]).join(" ")}
        </p>
      </div>
    );

  const renderValues = () => (
    <ul className="list-unstyled small m-0">
      {Object.entries(record.values).map(([fieldId, value]) => (
        <li key={fieldId} className="mb-1">
          <span className="text-muted">{fieldLabel(fieldId)}: </span>
          <span className="text-white">{value}</span>
        </li>
      ))}
    </ul>
  );


  return (
    <div className="d-flex flex-column w-100 drawer-modal-inner">
      <div className="drawer-header">
        <button className="btn wallet-modal-close" onClick={closeDrawer} aria-label="close">
          <X size={15} />
        </button>
        <h4 className="text-center w-100 m-0 font-weight-semibold">
          {ctx?.resume ? "Finish Re-issue" : "Review Update Request"}
        </h4>
      </div>

      {!deliveryLink && (
        <div className="drawer-modal-steps">
          {STEPS.map((key) => (
            <span key={key} className={`step-dot${step === key ? " active" : ""}`} />
          ))}
        </div>
      )}

      <div className="drawer-body">
        {!service ? (
          <div className="alert alert-info" role="alert">
            Connect your wallet first.
          </div>
        ) : !ctx ? null : deliveryLink ? (
          <div className="d-flex flex-column" style={{ gap: "12px" }}>
            <p className="m-0">The updated credential is issued. Now send its private details.</p>
            <div className="info-hint-card is-warning m-0">
              <Info size={16} />
              <p>
                The encrypted upload failed, so the details travel in this link instead. Anyone with the link
                can read them: send it privately, only to the holder.
              </p>
            </div>
            <div className="d-flex align-items-center" style={{ gap: "8px" }}>
              <input
                type="text"
                className="form-control"
                value={deliveryLink}
                readOnly
                aria-label="Private link"
                onFocus={(event) => event.target.select()}
              />
              <button
                type="button"
                className="btn btn-card-detail-action btn-sm flex-shrink-0"
                onClick={copyDeliveryLink}
                aria-label={linkCopied ? "Link copied" : "Copy link"}
              >
                {linkCopied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        ) : step === STEP_REVIEW ? (
          <div className="d-flex flex-column" style={{ gap: "12px" }}>
            {renderBlockers()}
            {renderReview()}
          </div>
        ) : step === STEP_REVOKE ? (
          <div className="d-flex flex-column" style={{ gap: "12px" }}>
            <p className="small m-0">
              Step 2 of 3: revoke credential #{String(ctx.token.tokenId)}. Its holder keeps seeing it, marked
              Burned, and it stops working for proofs.
            </p>
            <div className="info-hint-card is-warning m-0">
              <Info size={16} />
              <p>
                Until step 3 the holder has no valid credential. If you stop in between, finish from the
                subscribers list (Finish Re-issue).
              </p>
            </div>
          </div>
        ) : (
          <div className="d-flex flex-column" style={{ gap: "12px" }}>
            <p className="small m-0">
              Step 3 of 3: issue the updated credential to holder {truncateHex(record?.holderPk)}, with the same
              images. They get a new identity code with it.
            </p>
            {record && renderValues()}
            {renderBlockers()}
          </div>
        )}
      </div>

      {service && ctx && !deliveryLink && (
        <div className="drawer-footer d-flex" style={{ gap: "8px" }}>
          {step === STEP_REVIEW && (
            <>
              <button
                className="btn btn-card-detail-action flex-grow-1"
                onClick={handleDismiss}
                disabled={busy || status === "loading"}
              >
                Dismiss
              </button>
              <button
                className="btn btn-gradient flex-grow-1"
                onClick={() => setStep(STEP_REVOKE)}
                disabled={busy || status !== "ready" || !matchesChain || isBlocked}
              >
                <RefreshCw size={14} className="mr-2" />
                Re-issue
              </button>
            </>
          )}
          {step === STEP_REVOKE && (
            <>
              <button className="btn btn-card-detail-action flex-grow-1" onClick={() => setStep(STEP_REVIEW)} disabled={busy}>
                Back
              </button>
              <button className="btn btn-destructive flex-grow-1" onClick={handleRevoke} disabled={busy || isBlocked}>
                <Flame size={14} className="mr-2" />
                {busy ? "Revoking…" : "Revoke and Continue"}
              </button>
            </>
          )}
          {step === STEP_ISSUE && (
            <button className="btn btn-gradient btn-block" onClick={handleIssue} disabled={busy || !record || isBlocked}>
              {busy ? "Issuing…" : "Issue Updated Credential"}
            </button>
          )}
        </div>
      )}
      {deliveryLink && (
        <div className="drawer-footer d-flex flex-column">
          <button className="btn btn-card-detail-action" onClick={closeDrawer}>
            Done
          </button>
        </div>
      )}
    </div>
  );
}
