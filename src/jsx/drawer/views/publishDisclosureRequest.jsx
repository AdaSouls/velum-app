import { useCallback, useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import {
  useDrawer,
  useDrawerDispatch,
} from "../../contexts/drawer/drawer.provider";
import {
  errorFunction,
  loadingFunction,
  succesfullBlockchainCreation,
} from "../../toasts/sweetAlerts";
import { encodeAttributeValue } from "../../../midnight/attribute-value-codec";
import { buildMerkleTree } from "../../../midnight/merkle";
import { getDisclosureRequestsByVerifier, getTokensByEvent } from "../../../midnight/indexer.service";
import { requestRecipient } from "../../../midnight/ownership-proof";
import { parseHolderCode } from "../../../midnight/credential-crypto";
import { holderCodeFromInput } from "../../../midnight/invite-links";
import { publishRequestRule } from "../../../midnight/disclosure-sets";
import { describeRule, expandRule, isIdentityField, ruleSize } from "../../../midnight/attribute-types";
import QuestionBuilder from "../../components/QuestionBuilder";
import SelectDropdown from "../../components/SelectDropdown";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";
import { checkDocNumber, documentLabel, identityInputs, isValidSalt } from "../../../midnight/identity";
import { computeIdentityValue } from "../../../midnight/contract.service";

const REQUEST_ID_POLL_ATTEMPTS = 10;
const REQUEST_ID_POLL_DELAY_MS = 1500;

// After publishDisclosureRequest's tx confirms, the requestId it produced isn't something we can
// recompute ourselves (poap.compact's disclosure_request_key is NOT an exported pure circuit, unlike
// computeEventId) or trust out of the tx result (this codebase's established convention — see
// contract.service.ts's own comment near computeEventId). So: poll the indexer for OUR OWN just-
// published request, matching on the (eventId, fieldId, setRoot) we already know client-side.
async function pollForRequestId({ verifierPkHex, eventIdHex, fieldIdHex, setRootHex, recipientPkHex }) {
  for (let attempt = 0; attempt < REQUEST_ID_POLL_ATTEMPTS; attempt++) {
    const requests = await getDisclosureRequestsByVerifier(verifierPkHex);
    const match = requests.find(
      (request) =>
        request.eventId === eventIdHex &&
        request.fieldId === fieldIdHex &&
        request.setRoot === setRootHex &&
        requestRecipient(request) === recipientPkHex,
    );
    if (match) return match.requestId;
    await new Promise((resolve) => setTimeout(resolve, REQUEST_ID_POLL_DELAY_MS));
  }
  return null;
}

// Any connected wallet can publish a disclosure request (poap.compact's publishDisclosureRequest has
// no organizer/admin gate) — this popup is opened from eventCard.jsx's "Ask for a Disclosure" button
// (the organizer, from My Events) or from a holder's request link (/app/request, anyone else), on any
// Credential event with private fields (its metadataURI's credentialAttributeFields, see
// createEvent.jsx). The question depends on the field's type (QuestionBuilder.jsx): a list of
// accepted values, or a number/date range. Holders answer from their POAP card (holderProofs.jsx),
// so the question's rule is published for them (publishRequestRule); the chain only keeps the root
// of the set it expands to.
//
// Every request is addressed to ONE holder (publishDisclosureRequest's `recipient`): their key for
// this event's organizer, which they copy from Prove a Private Detail on their POAP. The contract
// rejects proveCredentialAttribute on an open request and lets only the recipient answer, so a
// classmate can't answer in the applicant's place (AdaSouls/velum f6f6114).
//
// Identity check (AdaSouls/velum 0e37df6, flow 12): addressing alone doesn't stop the applicant from
// handing over a qualifying friend's key. When the credential carries an identity document, the
// asker types the number on the document they checked plus the holder's identity code (prefilled
// from the request link), and a second request asks "is it this document?" — a set of one value,
// computeIdentityValue(...). Both requests go to the same holder; a holder has one credential per
// event, so both proofs are about the same credential. Two signatures, published in a row.
// The check is on by default and turning it off takes an explicit confirmation: without it, a
// borrowed key answers the question just as well (verifyProof.jsx flags a question proof whose
// identity check is missing).
export default function PublishDisclosureRequest() {
  const { midnight, disclosureEvent } = useDrawer();
  const dispatch = useDrawerDispatch();

  const allFields = disclosureEvent?.fields || [];
  // Identity documents get their own section; QuestionBuilder handles the rest (ranges, lists…).
  const fields = allFields.filter((field) => !isIdentityField(field));
  const identityFields = allFields.filter(isIdentityField);
  const [fieldId, setFieldId] = useState(fields[0]?.fieldId || "");
  const [askQuestion, setAskQuestion] = useState(fields.length > 0);
  const [checkIdentity, setCheckIdentity] = useState(identityFields.length > 0);
  const [skipIdentityConfirmed, setSkipIdentityConfirmed] = useState(false);
  const skippingIdentity = identityFields.length > 0 && !checkIdentity;
  const toggleIdentity = (on) => {
    setCheckIdentity(on);
    setSkipIdentityConfirmed(false);
  };
  const [identityFieldId, setIdentityFieldId] = useState(identityFields[0]?.fieldId || "");
  const [docNumber, setDocNumber] = useState("");
  const [idCode, setIdCode] = useState(disclosureEvent?.idCodes?.[identityFields[0]?.fieldId] || "");
  const identityField = identityFields.find((field) => field.fieldId === identityFieldId);
  const numberCheck = checkDocNumber(docNumber);
  const identityProblem = !checkIdentity
    ? null
    : "error" in numberCheck
      ? numberCheck.error
      : !numberCheck.value
        ? "Enter the number on the document you checked."
        : !isValidSalt(idCode.trim().toLowerCase())
          ? "Enter the holder's identity code (it comes in their link)."
          : null;
  const pickIdentityField = (id) => {
    setIdentityFieldId(id);
    setIdCode(disclosureEvent?.idCodes?.[id] || "");
  };
  const [rule, setRule] = useState(null);
  const [ruleProblem, setRuleProblem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [published, setPublished] = useState(null); // the question text, once published
  // Prefilled when opened from a holder's request link (requestLink.jsx).
  const [recipientInput, setRecipientInput] = useState(disclosureEvent?.recipient || "");
  const recipient = parseHolderCode(recipientInput);
  const recipientPkHex = recipient?.holderPkHex || null;
  // Informative only: whether that key holds a live POAP of this event right now. A request can be
  // published before the credential is issued; the holder just can't answer until then.
  const [recipientHolds, setRecipientHolds] = useState(null);
  useEffect(() => {
    setRecipientHolds(null);
    if (!recipientPkHex || !disclosureEvent?.eventId) return undefined;
    let cancelled = false;
    getTokensByEvent(disclosureEvent.eventId, { includeBurned: false })
      .then((tokens) => {
        if (!cancelled) setRecipientHolds(tokens.some((token) => token.ownerPk?.toLowerCase() === recipientPkHex));
      })
      .catch((error) => console.error("Error checking the holder's key:", error));
    return () => {
      cancelled = true;
    };
  }, [recipientPkHex, disclosureEvent?.eventId]);
  const selectedField = fields.find((field) => field.fieldId === fieldId);
  const onQuestionChange = useCallback((nextRule, problem) => {
    setRule(nextRule);
    setRuleProblem(problem);
  }, []);

  const closeDrawer = () => {
    dispatch({ type: "CLOSE_DRAWER" });
  };

  // One publishDisclosureRequest transaction + its question for holders. Returns the request id.
  const publishOne = async ({ title, fieldIdHex, setRootBytes, rule: question }) => {
    const setRootHex = Buffer.from(setRootBytes).toString("hex");
    const label = new Uint8Array(32);
    crypto.getRandomValues(label);
    loadingFunction(title, "Preparing transaction…", "");
    const publishedTx = await midnight.provider.service.publishDisclosureRequest(
      label,
      Uint8Array.from(Buffer.from(disclosureEvent.eventId, "hex")),
      Uint8Array.from(Buffer.from(fieldIdHex, "hex")),
      setRootBytes,
      Uint8Array.from(Buffer.from(recipientPkHex, "hex")),
    );

    // The circuit returns the requestId (private.result); the indexer poll stays as a fallback.
    const returned = publishedTx?.private?.result;
    let requestId = returned instanceof Uint8Array && returned.length === 32 ? Buffer.from(returned).toString("hex") : null;
    if (!requestId) {
      loadingFunction(title, "Waiting for the indexer to pick it up…", "");
      requestId = await pollForRequestId({
        verifierPkHex: midnight.provider.address,
        eventIdHex: disclosureEvent.eventId,
        fieldIdHex,
        setRootHex,
        recipientPkHex,
      });
    }
    if (!requestId) {
      throw new Error("Published, but the indexer hasn't shown it yet. Publish the request again shortly.");
    }

    // Holders answer from their card, so they need the question — the chain only has the root. For
    // an identity check that's just { op: 'identity' }: the value stays between asker and holder.
    loadingFunction(title, "Publishing the question…", "");
    try {
      await publishRequestRule(requestId, question);
    } catch (setError) {
      console.error("Publishing the accepted values failed:", setError);
      throw new Error(
        "The request is on-chain, but its question couldn't be published, so the holder can't answer it. Publish the request again.",
      );
    }
    return requestId;
  };

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!midnight?.provider || !disclosureEvent?.eventId) return;

    if (!recipientPkHex) {
      errorFunction("Validation Error", "Paste the key of the holder this question is for.", "");
      return;
    }
    if (!askQuestion && !checkIdentity) {
      errorFunction("Validation Error", "Choose what to ask.", "");
      return;
    }
    if (skippingIdentity && !skipIdentityConfirmed) {
      errorFunction("Validation Error", "Confirm that you want to ask without the identity check.", "");
      return;
    }
    if (checkIdentity && identityProblem) {
      errorFunction("Validation Error", identityProblem, "");
      return;
    }
    if (askQuestion && !rule) {
      errorFunction("Validation Error", ruleProblem || "Complete the question first.", "");
      return;
    }

    const total = (checkIdentity ? 1 : 0) + (askQuestion ? 1 : 0);
    const titleFor = (n) => `Publishing Disclosure Request${total > 1 ? ` (${n} of ${total})` : ""}`;
    const done = [];
    setLoading(true);
    setPublished(null);
    try {
      if (checkIdentity) {
        const value = computeIdentityValue(...identityInputs(identityField, numberCheck.value, idCode.trim().toLowerCase()));
        const tree = await buildMerkleTree([value], 16);
        await publishOne({
          title: titleFor(1),
          fieldIdHex: identityField.fieldId,
          setRootBytes: tree.rootBytes,
          rule: { op: "identity" },
        });
        done.push(describeRule(identityField.label, { op: "identity" }));
      }
      if (askQuestion) {
        const title = titleFor(done.length + 1);
        if (ruleSize(rule) > 2000) {
          loadingFunction(title, `Building the ${ruleSize(rule).toLocaleString()} accepted values…`, "");
        }
        const tree = await buildMerkleTree(expandRule(rule).map(encodeAttributeValue), 16);
        await publishOne({ title, fieldIdHex: fieldId, setRootBytes: tree.rootBytes, rule });
        done.push(describeRule(selectedField?.label || "Value", rule));
      }
      setPublished(done);
      succesfullBlockchainCreation(
        done.length > 1 ? "Disclosure Requests Published" : "Disclosure Request Published",
        "The holder can now answer from their POAP (Prove a Private Detail).",
        "",
      );
    } catch (error) {
      console.error("Error publishing disclosure request:", error);
      const message = friendlyErrorMessage(error, "Failed to publish the disclosure request. Please try again.");
      errorFunction(
        "Error",
        done.length ? `“${done[0]}” was published; the next request failed. ${message}` : message,
        "",
      );
      if (done.length) setPublished(done);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="d-flex flex-column w-100 drawer-modal-inner">
      <div className="drawer-header">
        <button className="btn wallet-modal-close" onClick={closeDrawer} aria-label="close">
          <X size={15} />
        </button>
        <h4 className="text-center w-100 m-0 font-weight-semibold">Ask for a Disclosure</h4>
      </div>

      <div className="drawer-body">
        {!midnight?.provider ? (
          <div className="alert alert-info" role="alert">
            Connect your wallet first to publish a disclosure request.
          </div>
        ) : allFields.length === 0 ? (
          <div className="alert alert-info" role="alert">
            This event has no private attributes to ask about.
          </div>
        ) : (
          <form className="row g-3" onSubmit={handlePublish}>
            <div className="col-12">
              <label className="form-label" htmlFor="disclosureRecipient">Holder's Key</label>
              <input
                type="text"
                className="form-control"
                placeholder="The key the holder gave you"
                id="disclosureRecipient"
                name="disclosureRecipient"
                value={recipientInput}
                onChange={(event) => setRecipientInput(holderCodeFromInput(event.target.value))}
                required
              />
              {recipientInput.trim() && !recipient && (
                <small className="form-text text-danger d-block">That doesn't look like a holder's key.</small>
              )}
              {recipientHolds === false && (
                <small className="form-text text-warning d-block">
                  This key holds no POAP of this event right now, so it can't answer until it gets one.
                </small>
              )}
              <small className="form-text text-muted">
                Only this holder will be able to answer. They find their key (or a link with it) on
                their POAP, under Prove a Private Detail. Not their wallet address.
              </small>
            </div>

            {identityFields.length > 0 && (
              <>
                <div className="col-12">
                  <div className="form-check form-switch share-toggle-row">
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id="checkIdentity"
                      checked={checkIdentity}
                      onChange={(event) => toggleIdentity(event.target.checked)}
                    />
                    <label className="form-check-label" htmlFor="checkIdentity">
                      Identity check: the credential is theirs
                    </label>
                  </div>
                </div>
                {checkIdentity && (
                  <>
                    {identityFields.length > 1 && (
                      <div className="col-12">
                        <label className="form-label" htmlFor="identityField">Document</label>
                        <SelectDropdown
                          id="identityField"
                          value={identityFieldId}
                          onChange={pickIdentityField}
                          options={identityFields.map((field) => ({
                            value: field.fieldId,
                            label: `${field.label} (${documentLabel(field)})`,
                          }))}
                        />
                      </div>
                    )}
                    <div className="col-12">
                      <label className="form-label" htmlFor="identityNumber">
                        {identityField ? documentLabel(identityField) : "Document"} number, as seen on the document
                      </label>
                      <input
                        id="identityNumber"
                        type="text"
                        className="form-control"
                        autoComplete="off"
                        value={docNumber}
                        onChange={(event) => setDocNumber(event.target.value)}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label" htmlFor="identityCode">Holder's identity code</label>
                      <input
                        id="identityCode"
                        type="text"
                        className="form-control"
                        autoComplete="off"
                        placeholder="Comes in the holder's link"
                        value={idCode}
                        onChange={(event) => setIdCode(event.target.value)}
                      />
                      {identityProblem && (docNumber.trim() || idCode.trim()) && (
                        <small className="form-text text-danger d-block">{identityProblem}</small>
                      )}
                      <small className="form-text text-muted">
                        Check the person's document yourself and type its number. Only you and the
                        holder can tell which document this is: the number is never published. If
                        the credential was issued for someone else's document, the holder can't
                        answer.
                      </small>
                    </div>
                  </>
                )}
                {!checkIdentity && (
                  <div className="col-12">
                    <div className="info-hint-card is-warning m-0">
                      <Info size={16} />
                      <div>
                        <p className="m-0 mb-2">
                          Without the identity check, anyone the holder lends their key to could answer
                          for them, with their own credential.
                        </p>
                        <div className="form-check m-0">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="skipIdentityConfirmed"
                            checked={skipIdentityConfirmed}
                            onChange={(event) => setSkipIdentityConfirmed(event.target.checked)}
                          />
                          <label className="form-check-label" htmlFor="skipIdentityConfirmed">
                            I understand, ask without it
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {fields.length > 0 && (
              <>
                {identityFields.length > 0 && (
                  <div className="col-12">
                    <div className="form-check form-switch share-toggle-row">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="askQuestion"
                        checked={askQuestion}
                        onChange={(event) => setAskQuestion(event.target.checked)}
                      />
                      <label className="form-check-label" htmlFor="askQuestion">
                        Ask about a private detail
                      </label>
                    </div>
                  </div>
                )}
                {askQuestion && (
                  <>
                    <div className="col-12">
                      <label className="form-label" htmlFor="disclosureField">Attribute</label>
                      <SelectDropdown
                        id="disclosureField"
                        value={fieldId}
                        onChange={setFieldId}
                        options={fields.map((field) => ({ value: field.fieldId, label: field.label }))}
                      />
                    </div>

                    {selectedField && <QuestionBuilder field={selectedField} onChange={onQuestionChange} />}
                  </>
                )}
              </>
            )}

            {checkIdentity && askQuestion && (
              <div className="col-12">
                <small className="form-text text-muted d-block">
                  Two requests, one signature each. The holder answers both together and sends you
                  one link that checks both. A proof of the question alone isn't enough.
                </small>
              </div>
            )}

            {published && (
              <div className="col-12 mt-2">
                <div className="alert alert-success m-0" role="status">
                  Published: {published.map((text) => `“${text}”`).join(" and ")}. If it fits, the holder
                  can prove it from their POAP card (Prove a Private Detail), without revealing it.
                  {published.length > 1 &&
                    " They'll send you one link that checks both proofs: the answer alone doesn't show the credential is theirs."}
                </div>
              </div>
            )}
          </form>
        )}
      </div>

      {midnight?.provider && allFields.length > 0 && (
        <div className="drawer-footer">
          <button
            type="submit"
            className="btn btn-gradient btn-block"
            onClick={handlePublish}
            disabled={
              loading ||
              !recipient ||
              (!askQuestion && !checkIdentity) ||
              (askQuestion && !rule) ||
              Boolean(checkIdentity && identityProblem) ||
              (skippingIdentity && !skipIdentityConfirmed)
            }
          >
            {loading ? "Publishing…" : "Publish Request"}
          </button>
        </div>
      )}
    </div>
  );
}
