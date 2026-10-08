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
import { getCredentialRequests, getTokensByEvent } from "../../../midnight/indexer.service";
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
// poap.compact's CredentialRequest holds Vector<4, CredentialCondition>; unused slots are all-zero.
const CONDITION_SLOTS = 4;

// The circuit returns the requestId (private.result); if it doesn't come back, poll the indexer for
// OUR OWN just-published request, matching on what we already know client-side (event, holder and
// the conditions' roots).
async function pollForRequestId({ verifierPkHex, eventIdHex, recipientPkHex, conditions }) {
  const sameConditions = (request) =>
    request.conditions.length === conditions.length &&
    conditions.every(
      (c, slot) =>
        request.conditions.some((rc) => rc.slot === slot && rc.fieldId === c.fieldIdHex && rc.setRoot === c.setRootHex),
    );
  for (let attempt = 0; attempt < REQUEST_ID_POLL_ATTEMPTS; attempt++) {
    const requests = await getCredentialRequests({ verifierPk: verifierPkHex, recipientPk: recipientPkHex, eventId: eventIdHex });
    const match = [...requests].reverse().find(sameConditions);
    if (match) return match.requestId;
    await new Promise((resolve) => setTimeout(resolve, REQUEST_ID_POLL_DELAY_MS));
  }
  return null;
}

// Any connected wallet can ask (poap.compact's publishCredentialRequest has no organizer/admin gate)
// — this popup is opened from eventCard.jsx's "Ask for a Disclosure" button (the organizer, from My
// Events) or from a holder's request link (/app/request, anyone else), on any Credential event with
// private fields (its metadataURI's credentialAttributeFields, see createEvent.jsx). The question
// depends on the field's type (QuestionBuilder.jsx): a list of accepted values, or a number/date
// range. Holders answer from their POAP card (holderProofs.jsx), so the question's rule is published
// for them (publishRequestRule, under the request id); the chain only keeps the root of the set it
// expands to.
//
// Every request is addressed to ONE holder (`recipient`): their key for this event's organizer, which
// they copy from Prove a Private Detail on their POAP. Only that holder can answer it.
//
// Identity check (flow 12): addressing alone doesn't stop the applicant from handing over a
// qualifying friend's key. When the credential carries an identity document, the asker types the
// number on the document they checked plus the holder's identity code (prefilled from the request
// link), and the request also asks "is it this document?" — a set of one value,
// computeIdentityValue(...). Identity check and question are conditions of ONE credential request
// (publishCredentialRequest, AdaSouls/velum 77e4ed8), answered in one proof from one credential:
// the question can't be answered without the identity. One signature.
// The check is on by default and turning it off takes an explicit confirmation: without it, a
// borrowed key answers the question just as well.
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

  // One publishCredentialRequest transaction for every condition (slot order = conditions order),
  // then each question's rule for holders. Returns the request id.
  const publishRequest = async (conditions) => {
    const title = "Publishing Disclosure Request";
    const label = new Uint8Array(32);
    crypto.getRandomValues(label);
    const onChain = Array.from({ length: CONDITION_SLOTS }, (_, slot) =>
      conditions[slot]
        ? {
            fieldId: Uint8Array.from(Buffer.from(conditions[slot].fieldIdHex, "hex")),
            setRoot: conditions[slot].setRootBytes,
          }
        : { fieldId: new Uint8Array(32), setRoot: new Uint8Array(32) },
    );
    loadingFunction(title, "Preparing transaction…", "");
    const publishedTx = await midnight.provider.service.publishCredentialRequest(
      label,
      Uint8Array.from(Buffer.from(disclosureEvent.eventId, "hex")),
      Uint8Array.from(Buffer.from(recipientPkHex, "hex")),
      onChain,
    );

    const returned = publishedTx?.private?.result;
    let requestId = returned instanceof Uint8Array && returned.length === 32 ? Buffer.from(returned).toString("hex") : null;
    if (!requestId) {
      loadingFunction(title, "Waiting for the indexer to pick it up…", "");
      requestId = await pollForRequestId({
        verifierPkHex: midnight.provider.address,
        eventIdHex: disclosureEvent.eventId,
        recipientPkHex,
        conditions: conditions.map((c) => ({ fieldIdHex: c.fieldIdHex, setRootHex: Buffer.from(c.setRootBytes).toString("hex") })),
      });
    }
    if (!requestId) {
      throw new Error("Published, but the indexer hasn't shown it yet. Publish the request again shortly.");
    }

    // Holders answer from their card, so they need each question — the chain only has the roots.
    // All under the request id: the holder matches each rule to its condition by root. An identity
    // check needs none: the holder rebuilds its one value from their own document.
    const questions = conditions.filter((c) => c.rule.op !== "identity");
    if (questions.length) loadingFunction(title, "Publishing the question…", "");
    try {
      for (const question of questions) await publishRequestRule(requestId, question.rule);
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

    setLoading(true);
    setPublished(null);
    try {
      // Identity first (slot 0), then the question.
      const conditions = [];
      const asked = [];
      if (checkIdentity) {
        const value = computeIdentityValue(...identityInputs(identityField, numberCheck.value, idCode.trim().toLowerCase()));
        const tree = await buildMerkleTree([value], 16);
        conditions.push({ fieldIdHex: identityField.fieldId, setRootBytes: tree.rootBytes, rule: { op: "identity" } });
        asked.push(describeRule(identityField.label, { op: "identity" }));
      }
      if (askQuestion) {
        if (ruleSize(rule) > 2000) {
          loadingFunction("Publishing Disclosure Request", `Building the ${ruleSize(rule).toLocaleString()} accepted values…`, "");
        }
        const tree = await buildMerkleTree(expandRule(rule).map(encodeAttributeValue), 16);
        conditions.push({ fieldIdHex: fieldId, setRootBytes: tree.rootBytes, rule });
        asked.push(describeRule(selectedField?.label || "Value", rule));
      }
      await publishRequest(conditions);
      setPublished(asked);
      succesfullBlockchainCreation(
        "Disclosure Request Published",
        "The holder can now answer from their POAP (Prove a Private Detail).",
        "",
      );
    } catch (error) {
      console.error("Error publishing disclosure request:", error);
      errorFunction("Error", friendlyErrorMessage(error, "Failed to publish the disclosure request. Please try again."), "");
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
                  One request, one signature. The holder answers the identity check and the question
                  in a single proof: neither can be answered without the other.
                </small>
              </div>
            )}

            {published && (
              <div className="col-12 mt-2">
                <div className="alert alert-success m-0" role="status">
                  Published: {published.map((text) => `“${text}”`).join(" and ")}. If it fits, the holder
                  can prove it from their POAP card (Prove a Private Detail), without revealing it.
                  {published.length > 1 && " Both are answered in one proof."}
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
