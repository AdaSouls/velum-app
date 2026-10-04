import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
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
import { describeRule, expandRule, ruleSize } from "../../../midnight/attribute-types";
import QuestionBuilder from "../../components/QuestionBuilder";
import SelectDropdown from "../../components/SelectDropdown";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";

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
// on any Credential event with private fields (its metadataURI's credentialAttributeFields, see
// createEvent.jsx). The question depends on the field's type (QuestionBuilder.jsx): a list of
// accepted values, or a number/date range. Holders answer from their POAP card (holderProofs.jsx),
// so the question's rule is published for them (publishRequestRule); the chain only keeps the root
// of the set it expands to.
//
// Every request is addressed to ONE holder (publishDisclosureRequest's `recipient`): their key for
// this event's organizer, which they copy from Prove a Private Detail on their POAP. The contract
// rejects proveCredentialAttribute on an open request and lets only the recipient answer, so a
// classmate can't answer in the applicant's place (AdaSouls/velum f6f6114).
export default function PublishDisclosureRequest() {
  const { midnight, disclosureEvent } = useDrawer();
  const dispatch = useDrawerDispatch();

  const fields = disclosureEvent?.fields || [];
  const [fieldId, setFieldId] = useState(fields[0]?.fieldId || "");
  const [rule, setRule] = useState(null);
  const [ruleProblem, setRuleProblem] = useState(null);
  const [loading, setLoading] = useState(false);
  const [published, setPublished] = useState(null); // the question text, once published
  const [recipientInput, setRecipientInput] = useState("");
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

  const handlePublish = async (e) => {
    e.preventDefault();
    if (!midnight?.provider || !disclosureEvent?.eventId || !fieldId) return;

    if (!recipientPkHex) {
      errorFunction("Validation Error", "Paste the key of the holder this question is for.", "");
      return;
    }
    if (!rule) {
      errorFunction("Validation Error", ruleProblem || "Complete the question first.", "");
      return;
    }

    setLoading(true);
    setPublished(null);
    try {
      if (ruleSize(rule) > 2000) {
        loadingFunction("Publishing Disclosure Request", `Building the ${ruleSize(rule).toLocaleString()} accepted values…`, "");
      }
      const tree = await buildMerkleTree(expandRule(rule).map(encodeAttributeValue), 16);
      const setRootHex = Buffer.from(tree.rootBytes).toString("hex");

      const label = new Uint8Array(32);
      crypto.getRandomValues(label);
      const eventIdBytes = Uint8Array.from(Buffer.from(disclosureEvent.eventId, "hex"));
      const fieldIdBytes = Uint8Array.from(Buffer.from(fieldId, "hex"));

      loadingFunction("Publishing Disclosure Request", "Preparing transaction…", "");
      const publishedTx = await midnight.provider.service.publishDisclosureRequest(
        label,
        eventIdBytes,
        fieldIdBytes,
        tree.rootBytes,
        Uint8Array.from(Buffer.from(recipientPkHex, "hex")),
      );

      // The circuit returns the requestId (private.result); the indexer poll stays as a fallback.
      const returned = publishedTx?.private?.result;
      let requestId = returned instanceof Uint8Array && returned.length === 32 ? Buffer.from(returned).toString("hex") : null;
      if (!requestId) {
        loadingFunction("Publishing Disclosure Request", "Waiting for the indexer to pick it up…", "");
        requestId = await pollForRequestId({
          verifierPkHex: midnight.provider.address,
          eventIdHex: disclosureEvent.eventId,
          fieldIdHex: fieldId,
          setRootHex,
          recipientPkHex,
        });
      }
      if (!requestId) {
        throw new Error("Published, but the indexer hasn't shown it yet. Publish the request again shortly.");
      }

      // Holders answer from their card, so they need the accepted values — the chain only has the root.
      loadingFunction("Publishing Disclosure Request", "Publishing the accepted values…", "");
      try {
        await publishRequestRule(requestId, rule);
      } catch (setError) {
        console.error("Publishing the accepted values failed:", setError);
        throw new Error(
          "The request is on-chain, but its accepted values couldn't be published, so holders can't answer it. Publish the request again.",
        );
      }
      setPublished(describeRule(selectedField?.label || "Value", rule));
      succesfullBlockchainCreation(
        "Disclosure Request Published",
        "The holder can now answer it from their POAP (Prove a Private Detail).",
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
        ) : fields.length === 0 ? (
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
                Only this holder will be able to answer. They find their key on their POAP, under Prove
                a Private Detail. Not their wallet address.
              </small>
            </div>

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

            {published && (
              <div className="col-12 mt-2">
                <div className="alert alert-success m-0" role="status">
                  Published: “{published}”. If their value fits, the holder can prove it from their POAP
                  card (Prove a Private Detail), without revealing it.
                </div>
              </div>
            )}
          </form>
        )}
      </div>

      {midnight?.provider && fields.length > 0 && (
        <div className="drawer-footer">
          <button
            type="submit"
            className="btn btn-gradient btn-block"
            onClick={handlePublish}
            disabled={loading || !rule || !recipient}
          >
            {loading ? "Publishing…" : "Publish Request"}
          </button>
        </div>
      )}
    </div>
  );
}
