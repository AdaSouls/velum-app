import { useState } from "react";
import { X, Info, RefreshCw } from "lucide-react";
import { useDrawer, useDrawerDispatch } from "../../contexts/drawer/drawer.provider";
import { errorFunction, loadingFunction, succesfullBlockchainCreation } from "../../toasts/sweetAlerts";
import {
  changeError,
  MAX_REASON_LENGTH,
  notifyCredentialUpdateRequested,
  submitUpdateRequest,
} from "../../../midnight/credential-update";
import { documentLabel, maskDocNumber } from "../../../midnight/identity";
import SelectDropdown from "../../components/SelectDropdown";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";

// The holder asks the credential's organizer to issue it again with a new document number
// (credential-update.ts), opened from their POAP card (SHOW_REQUEST_UPDATE). The request travels
// encrypted to the organizer's inbox key (the event's updateRequestKey); on-chain only a commitment
// to it is filed, so anyone can see that an update was asked for, not what changed. One signature.
export default function RequestCredentialUpdate() {
  const { midnight, requestUpdateContext: ctx } = useDrawer();
  const dispatch = useDrawerDispatch();
  const service = midnight?.provider?.service;

  const documents = (ctx?.pkg?.fields || []).filter((field) => field.identity);
  const [fieldId, setFieldId] = useState(documents[0]?.fieldId || "");
  const [number, setNumber] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const current = documents.find((field) => field.fieldId === fieldId);
  const change = { fieldId, number };
  const problem = changeError(ctx?.pkg, change);

  const closeDrawer = () => dispatch({ type: "CLOSE_DRAWER" });

  const handleSubmit = async (event) => {
    event?.preventDefault();
    if (!service || !ctx || problem) return;
    setSubmitting(true);
    try {
      loadingFunction("Requesting Update", "Sending your request, encrypted…", "");
      const { txHash } = await submitUpdateRequest(service, {
        token: ctx.token,
        pkg: ctx.pkg,
        changes: [change],
        reason,
        updateRequestKey: ctx.updateRequestKey,
      });
      notifyCredentialUpdateRequested(ctx.token.tokenId);
      closeDrawer();
      succesfullBlockchainCreation(
        "Update Requested",
        `The organizer will see it next time they open their subscribers list.${txHash ? ` Transaction: ${txHash}` : ""}`,
        "",
      );
    } catch (error) {
      console.error("Error requesting a credential update:", error);
      errorFunction("Error", friendlyErrorMessage(error, "Failed to request the update. Please try again."), "");
      setSubmitting(false);
    }
  };

  return (
    <div className="d-flex flex-column w-100 drawer-modal-inner">
      <div className="drawer-header">
        <button className="btn wallet-modal-close" onClick={closeDrawer} aria-label="close">
          <X size={15} />
        </button>
        <h4 className="text-center w-100 m-0 font-weight-semibold">Request Update</h4>
      </div>

      <div className="drawer-body">
        {!service ? (
          <div className="alert alert-info" role="alert">
            Connect your wallet first.
          </div>
        ) : !ctx ? null : documents.length === 0 ? (
          <div className="alert alert-info" role="alert">
            This credential has no identity document to update.
          </div>
        ) : (
          <form className="row g-3" onSubmit={handleSubmit}>
            <div className="col-12">
              <p className="text-muted small m-0">
                Ask {ctx.organizerName || "the organizer"} to issue
                {ctx.eventName ? <> <span className="text-white">{ctx.eventName}</span></> : " this credential"} again
                with a new document number. If they accept, your current credential is replaced by a new one.
              </p>
            </div>

            {documents.length > 1 && (
              <div className="col-12">
                <label className="form-label" htmlFor="updateDocument">Document</label>
                <SelectDropdown
                  id="updateDocument"
                  value={fieldId}
                  onChange={setFieldId}
                  options={documents.map((field) => ({
                    value: field.fieldId,
                    label: `${field.label} (${documentLabel(field.identity)})`,
                  }))}
                />
              </div>
            )}

            {current && (
              <div className="col-12">
                <p className="small m-0">
                  <span className="text-muted">Now: </span>
                  <span className="text-white">
                    {documentLabel(current.identity)} · {maskDocNumber(current.identity.number)}
                  </span>
                </p>
              </div>
            )}

            <div className="col-12">
              <label className="form-label" htmlFor="updateNumber">New number</label>
              <input
                id="updateNumber"
                type="text"
                className="form-control"
                autoComplete="off"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
              />
              {number.trim() && problem && <small className="form-text text-danger d-block">{problem}</small>}
            </div>

            <div className="col-12">
              <label className="form-label" htmlFor="updateReason">Reason (optional)</label>
              <textarea
                id="updateReason"
                className="form-control"
                rows={2}
                maxLength={MAX_REASON_LENGTH}
                placeholder="e.g. New passport issued"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>

            <div className="col-12">
              <div className="info-hint-card m-0">
                <Info size={16} />
                <p>
                  Only the organizer can read the request: it carries your current details and the new
                  number, encrypted. Anyone can see that you asked for an update, but not what changed.
                  They'll check your new document before issuing it.
                  {ctx.pending && " You already have a pending request: sending this one replaces it."}
                </p>
              </div>
            </div>
          </form>
        )}
      </div>

      <div className="drawer-footer d-flex" style={{ gap: "8px" }}>
        <button className="btn btn-card-detail-action flex-grow-1" onClick={closeDrawer} disabled={submitting}>
          Cancel
        </button>
        <button
          className="btn btn-gradient flex-grow-1"
          onClick={handleSubmit}
          disabled={!service || !ctx || Boolean(problem) || submitting}
        >
          <RefreshCw size={14} className="mr-2" />
          {submitting ? "Sending…" : "Send Request"}
        </button>
      </div>
    </div>
  );
}
