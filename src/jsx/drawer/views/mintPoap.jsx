import { useEffect, useState } from "react";
import { Button } from "react-bootstrap";
import { X, Copy, Check, Lock } from "lucide-react";
import {
  useDrawer,
  useDrawerDispatch,
} from "../../contexts/drawer/drawer.provider";
import EventImageField from "../../components/EventImageField";
import eventNormal from "../../../images/svg/event-normal.svg";
import eventOwnerIcon from "../../../icons/svg/collection-owner.svg";
import {
  succesfullBlockchainCreation,
  errorFunction,
  loadingFunction,
} from "../../toasts/sweetAlerts";
import { useEventMetadata } from "../../hooks/useEventMetadata";
import { uploadImageToIPFS, uploadJSONToIPFS } from "../../../services/ipfs.service";
import { getCroppedImageBlob } from "../../../utils/cropImage";
import { txHashOf } from "../../../midnight/tx-result";
import { parseHolderCode } from "../../../midnight/credential-crypto";
import { holderCodeFromInput } from "../../../midnight/invite-links";
import {
  buildCredentialAttributes,
  deliverCredentialPackage,
  packageToLinkFragment,
} from "../../../midnight/credential-delivery";
import { canonicalValue, fieldType } from "../../../midnight/attribute-types";
import { documentLabel } from "../../../midnight/identity";
import { parseValidity, validUntilIso } from "../../../midnight/validity";
import SelectDropdown from "../../components/SelectDropdown";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";

const truncateHex = (hex) => {
  if (!hex) return "N/A";
  return `${hex.slice(0, 8)}…${hex.slice(-6)}`;
};

const STEP_RECIPIENT = "recipient";
const STEP_PRIVATE = "private";
const STEP_DOCUMENT = "document";
const STEP_ICON = "icon";
// Each field's value is checked and stored in its canonical form (attribute-types.ts): the same
// text a later range question expands to, so "018" and "18" can't end up as different values.
const valueCheck = (field, raw) => canonicalValue(field, raw || "");

// mintTo(eventId, recipientPk, tokenMetadataURI, tokenPrivateMetadataCommit, credentialAttributesRoot) — the organizer-only
// push-mint circuit (poap.compact) — is the counterpart to createPoap.jsx's self-service claim():
// instead of the recipient claiming their own token, the organizer mints a brand-new one directly
// to a recipient's per-issuer holder pk. Always opened pre-filled with a specific event
// (CREATE_MINT's payload, dispatched from eventCard.jsx's expanded detail — no event selector
// here, unlike Claim POAP).
//
// A small 3-step wizard, same Back/Next/step-dot pattern as createEvent.jsx, one field group per
// step: recipient → credential image → icon. Only reachable for Credential-category (invite-only)
// events — see createEvent.jsx, where that category is the only one with no shared "POAP image"
// step, precisely because each credential gets its own image right here instead of inheriting one
// set at event-creation time. Two images, both independent of the event's own metadataURI:
// - `image` (icon, optional) — the small thumbnail wherever this token appears in a list/grid.
// - `documentImage` (required) — the actual ticket/diploma/document, shown full-size when the
//   holder opens this specific credential (poapCard.jsx's expanded view).
//
// When the event defines private fields (createEvent.jsx → metadata.credentialAttributeFields), a
// "Private details" step asks for this recipient's values. They're committed on-chain only as a
// Merkle root (mintTo's credentialAttributesRoot) and delivered to the recipient encrypted for the
// key inside their "Get My Key" code (credential-delivery.ts). An old code without that key — or a
// failed upload — falls back to a private link the organizer sends by hand.
export default function MintPoap() {
  const { mintEvent, mintRecipient, midnight } = useDrawer();
  const dispatch = useDrawerDispatch();
  const { metadata } = useEventMetadata(mintEvent?.metadataURI);

  const credentialFields = metadata?.credentialAttributeFields || [];
  const steps = [STEP_RECIPIENT, ...(credentialFields.length ? [STEP_PRIVATE] : []), STEP_DOCUMENT, STEP_ICON];
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLastStep = stepIndex >= steps.length - 1;
  const [recipientPkHex, setRecipientPkHex] = useState(mintRecipient || "");
  const [privateValues, setPrivateValues] = useState({});
  // A Credential with validity has an automatic "Valid until" field (createEvent.jsx): pre-filled
  // with today + the event's validity, still editable (e.g. a license that started earlier).
  const rawValidity = metadata?.validity;
  const validUntilField = credentialFields.find((field) => field.auto === "validUntil");
  useEffect(() => {
    const validity = parseValidity(rawValidity);
    if (!validUntilField || !validity) return;
    setPrivateValues((current) =>
      current[validUntilField.fieldId] !== undefined
        ? current
        : { ...current, [validUntilField.fieldId]: validUntilIso(Date.now(), validity) },
    );
  }, [validUntilField, rawValidity]);
  // Set after a successful mint that still needs the organizer to act: the private link to send.
  const [deliveryLink, setDeliveryLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [iconValues, setIconValues] = useState({ imageFile: null, croppedAreaPixels: null });
  const [documentValues, setDocumentValues] = useState({ imageFile: null, croppedAreaPixels: null });
  const [loading, setLoading] = useState(false);

  const recipient = parseHolderCode(recipientPkHex);
  // mintTo reverts with "Cannot mint to yourself" when the recipient is the caller's own key for
  // this event's organizer (holder_pk(ev.organizer)) — that holds for an admin minting into
  // someone else's event too, so compare against that, not just the organizer's own events.
  const [ownHolderPkHex, setOwnHolderPkHex] = useState(null);
  useEffect(() => {
    const service = midnight?.provider?.service;
    if (typeof service?.getHolderPkHex !== "function" || !mintEvent?.issuerPk) return undefined;
    let cancelled = false;
    Promise.resolve(service.getHolderPkHex(Uint8Array.from(Buffer.from(mintEvent.issuerPk, "hex"))))
      .then((pk) => !cancelled && setOwnHolderPkHex(pk))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [midnight?.provider, mintEvent?.issuerPk]);
  const isOwnKey = Boolean(recipient && ownHolderPkHex && recipient.holderPkHex === ownHolderPkHex);
  const isRecipientValid = () => Boolean(recipient) && !isOwnKey;
  const isDocumentValid = () => Boolean(documentValues.imageFile);
  const isPrivateValid = () => credentialFields.every((f) => "value" in valueCheck(f, privateValues[f.fieldId]));

  const stepValidators = {
    [STEP_RECIPIENT]: isRecipientValid,
    [STEP_PRIVATE]: isPrivateValid,
    [STEP_DOCUMENT]: isDocumentValid,
  };
  const isCurrentStepValid = () => {
    const validator = stepValidators[step];
    return validator ? validator() : true;
  };

  const closeDrawer = () => {
    dispatch({ type: "CLOSE_DRAWER" });
  };

  const handleNext = () => setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  const handleBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const copyDeliveryLink = () => {
    navigator.clipboard?.writeText(deliveryLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!midnight?.provider || !mintEvent) return;

    if (isOwnKey) {
      errorFunction("Cannot Mint to Yourself", "That key is your own. Paste the recipient's key instead.", "");
      return;
    }

    if (!isRecipientValid()) {
      errorFunction(
        "Invalid Public Key",
        "Paste the code the recipient generated in My Subscriptions → Paste Link.",
        ""
      );
      return;
    }

    if (!isDocumentValid()) {
      errorFunction(
        "Credential Image Required",
        "Upload the ticket, diploma, or document this credential represents.",
        ""
      );
      return;
    }

    setLoading(true);
    try {
      let iconUri;
      if (iconValues.imageFile) {
        loadingFunction("Minting POAP", "Uploading icon to IPFS…", "");
        const iconBlob = iconValues.croppedAreaPixels
          ? await getCroppedImageBlob(iconValues.imageFile, iconValues.croppedAreaPixels)
          : iconValues.imageFile;
        iconUri = await uploadImageToIPFS(iconBlob);
      }

      loadingFunction("Minting POAP", "Uploading credential image to IPFS…", "");
      // noCrop on this field (see below) — the document keeps its original aspect ratio
      // (horizontal, vertical, or square), so croppedAreaPixels is never set; upload the file as-is.
      const documentImageUri = await uploadImageToIPFS(documentValues.imageFile);

      // Name/description/category/organization mirror the event's own (organizer can always tell
      // tokens apart by recipient/event either way) — the images are what's actually personalized
      // per recipient. Mirroring category/organization keeps the category badge and the
      // organizer's display name showing on this credential too, instead of falling back to no
      // badge / the raw pk the way it would with no tokenMetadataURI fields of its own.
      loadingFunction("Minting POAP", "Uploading token metadata to IPFS…", "");
      const tokenMetadataURI = await uploadJSONToIPFS({
        ...(metadata?.name ? { name: metadata.name } : {}),
        ...(metadata?.description ? { description: metadata.description } : {}),
        ...(metadata?.category ? { category: metadata.category } : {}),
        ...(metadata?.organization ? { organization: metadata.organization } : {}),
        ...(iconUri ? { image: iconUri } : {}),
        documentImage: documentImageUri,
      });

      const canonicalValues = Object.fromEntries(
        credentialFields.map((field) => {
          const checked = valueCheck(field, privateValues[field.fieldId]);
          return [field.fieldId, "value" in checked ? checked.value : ""];
        }),
      );
      const { fields: privateFields, root: credentialAttributesRoot } = await buildCredentialAttributes(
        credentialFields,
        canonicalValues,
      );

      loadingFunction("Minting POAP", "Preparing transaction…", "");
      const eventIdBytes = Uint8Array.from(Buffer.from(mintEvent.eventId, "hex"));
      const recipientPk = Uint8Array.from(Buffer.from(recipient.holderPkHex, "hex"));
      const txHash = txHashOf(
        await midnight.provider.service.mintTo(
          eventIdBytes,
          recipientPk,
          tokenMetadataURI,
          new Uint8Array(32),
          credentialAttributesRoot,
        ),
      );

      if (privateFields.length === 0) {
        succesfullBlockchainCreation("POAP Minted Successfully", `Transaction: ${txHash}`, "");
        closeDrawer();
        return;
      }

      const pkg = {
        version: 1,
        eventId: mintEvent.eventId,
        issuerPk: mintEvent.issuerPk,
        holderPk: recipient.holderPkHex,
        credAttrRoot: Buffer.from(credentialAttributesRoot).toString("hex"),
        fields: privateFields,
      };
      let delivered = false;
      if (recipient.encryptionPublicKeyHex) {
        loadingFunction("Minting POAP", "Sending the private details, encrypted…", "");
        try {
          await deliverCredentialPackage(pkg, recipient.encryptionPublicKeyHex);
          delivered = true;
        } catch (deliveryError) {
          console.error("Encrypted delivery failed, falling back to a link:", deliveryError);
        }
      }
      if (delivered) {
        succesfullBlockchainCreation(
          "POAP Minted Successfully",
          `The private details were sent encrypted; the recipient will see them in My Subscriptions. Transaction: ${txHash}`,
          "",
        );
        closeDrawer();
        return;
      }
      setDeliveryLink(`${window.location.origin}/app/credential#${packageToLinkFragment(pkg)}`);
      succesfullBlockchainCreation(
        "POAP Minted — Send the Private Link",
        `Transaction: ${txHash}`,
        "",
      );
    } catch (error) {
      console.error("Error minting POAP:", error);
      errorFunction("Error", friendlyErrorMessage(error, "Failed to mint POAP. Please try again."), "");
    } finally {
      setLoading(false);
    }
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
          Mint POAP
        </h4>
      </div>

      {mintEvent && !deliveryLink && (
        <div className="drawer-modal-steps">
          {steps.map((key) => (
            <span key={key} className={`step-dot${step === key ? ' active' : ''}`} />
          ))}
        </div>
      )}

      <div className="drawer-body">
        {deliveryLink ? (
          <div className="d-flex flex-column" style={{ gap: "12px" }}>
            <p className="m-0">The credential is minted. Now send its private details.</p>
            <div className="info-hint-card is-warning m-0">
              <Lock size={16} />
              <p>
                The recipient's code doesn't include an encryption key (or the encrypted upload
                failed), so the details travel in this link instead. Anyone with the link can read
                them — send it privately, only to the recipient. They open it once while connected
                and the details are saved in their browser.
              </p>
            </div>
            <div className="d-flex align-items-center" style={{ gap: "8px" }}>
              <input
                id="deliveryLink"
                type="text"
                className="form-control"
                value={deliveryLink}
                readOnly
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
        ) : mintEvent ? (
          <form name="mintPoapForm" className="row g-3" onSubmit={handleSubmit}>
            {step === STEP_RECIPIENT && (
              <>
                <div className="col-12">
                  <div className="drawer-modal-preview-card">
                    <div className="d-flex align-items-center mb-3">
                      <img
                        className="mr-3 rounded-circle"
                        src={metadata?.poapImageUrl || metadata?.imageUrl || eventNormal}
                        width="48"
                        height="48"
                        alt=""
                        onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = eventNormal; }}
                      />
                      <div>
                        <h5 className="mb-1" style={{ fontSize: "16px" }}>
                          {metadata?.name || `Event ${truncateHex(mintEvent.eventId)}`}
                        </h5>
                      </div>
                    </div>
                    <ul className="list-unstyled mb-0 small">
                      <li className="d-flex align-items-center mb-2">
                        <img className="mr-2" src={eventOwnerIcon} width="16" height="16" alt="" />
                        Organizer: <span className="text-white">{metadata?.organization?.name || truncateHex(mintEvent.issuerPk)}</span>
                      </li>
                      <li className="mb-2">
                        Supply: {mintEvent.minted}/{mintEvent.maxSupply || "unlimited"}
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="col-12 mt-3">
                  <label className="form-label" htmlFor="recipientPkHex">Recipient's Key</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Code or mint link the recipient sent you"
                    id="recipientPkHex"
                    name="recipientPkHex"
                    value={recipientPkHex}
                    onChange={(event) => setRecipientPkHex(holderCodeFromInput(event.target.value))}
                    required
                  />
                  {isOwnKey && (
                    <small className="form-text text-danger d-block">
                      That's your own key. You can't mint a POAP to yourself.
                    </small>
                  )}
                  <small className="form-text text-muted">
                    Not their wallet address — this has to be the key they generate specifically for
                    you. Send them your organizer public key ({truncateHex(mintEvent.issuerPk)}), have
                    them open My Subscriptions → Paste Link and paste it in, and they'll get back the
                    value to paste here.
                  </small>
                </div>
              </>
            )}

            {step === STEP_PRIVATE && (
              <div className="col-12">
                <p className="small text-muted mb-3">
                  Private details for this recipient only. They're stored on-chain as a fingerprint
                  (a Merkle root), sent to the recipient encrypted, and let them prove a value to
                  someone without revealing it. Leave a field empty to skip it.
                </p>
                {credentialFields.map((field) => {
                  const type = fieldType(field);
                  const checked = valueCheck(field, privateValues[field.fieldId]);
                  const problem = "error" in checked ? checked.error : null;
                  const inputId = `private-${field.fieldId}`;
                  const value = privateValues[field.fieldId] || "";
                  const setValue = (next) => setPrivateValues((current) => ({ ...current, [field.fieldId]: next }));
                  const range =
                    type === "number" && (field.min !== undefined || field.max !== undefined)
                      ? ` (${field.min ?? "…"} to ${field.max ?? "…"})`
                      : type === "identity"
                        ? ` (${documentLabel(field)})`
                        : "";
                  return (
                    <div className="mb-3" key={field.fieldId}>
                      <label className="form-label" htmlFor={inputId}>{field.label}{range}</label>
                      {type === "list" ? (
                        <SelectDropdown
                          id={inputId}
                          value={value}
                          onChange={setValue}
                          options={[{ value: "", label: "—" }, ...(field.options || []).map((option) => ({ value: option, label: option }))]}
                        />
                      ) : (
                        <input
                          id={inputId}
                          type={type === "number" ? "number" : type === "date" ? "date" : "text"}
                          step={type === "number" ? 1 : undefined}
                          className={`form-control${problem ? " is-invalid" : ""}`}
                          placeholder={type === "identity" ? "Document number" : undefined}
                          value={value}
                          onChange={(event) => setValue(event.target.value)}
                        />
                      )}
                      {problem && <small className="form-text text-danger d-block">{problem}</small>}
                      {type === "identity" && !problem && (
                        <small className="form-text text-muted d-block">
                          Check it against the person's document. Spaces, dots and dashes are ignored.
                          Never published: the credential only keeps a salted fingerprint of it.
                        </small>
                      )}
                      {field.auto === "validUntil" && !problem && (
                        <small className="form-text text-muted d-block">
                          Set from the event's validity. The holder can prove it's still valid without revealing it.
                        </small>
                      )}
                    </div>
                  );
                })}
                {recipient && !recipient.encryptionPublicKeyHex && (
                  <div className="info-hint-card is-warning">
                    <Lock size={16} />
                    <p>
                      This recipient's code is from an older version and has no encryption key. After
                      minting you'll get a private link to send them by hand. Ask them to generate
                      the code again to receive the details automatically.
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === STEP_DOCUMENT && (
              <div className="col-12">
                <EventImageField
                  values={documentValues}
                  onChange={setDocumentValues}
                  noCrop
                  id="documentImage"
                  label={<>Credential Image <span className="text-danger">*</span></>}
                  helperText="Required. The ticket, diploma, or document this credential represents — horizontal, vertical, or square, shown uncropped when the recipient opens it."
                />
              </div>
            )}

            {step === STEP_ICON && (
              <div className="col-12">
                <EventImageField
                  values={iconValues}
                  onChange={setIconValues}
                  circular
                  id="iconImage"
                  label="Icon (optional)"
                  helperText="Optional. Shown as the small thumbnail wherever this credential appears in a list — falls back to a generic icon if left blank."
                />
              </div>
            )}
          </form>
        ) : (
          <div className="alert alert-info" role="alert">
            No event selected. Open this from an event's expanded detail on the Events page.
          </div>
        )}
      </div>

      {deliveryLink ? (
        <div className="drawer-footer d-flex flex-column">
          <Button type="button" className="btn btn-card-detail-action" onClick={closeDrawer}>
            Done
          </Button>
        </div>
      ) : mintEvent && (
        <div className="drawer-footer">
          {stepIndex === 0 ? (
            <Button
              type="button"
              className="btn btn-gradient btn-block w-100"
              onClick={handleNext}
              disabled={!isCurrentStepValid()}
            >
              Next
            </Button>
          ) : (
            <div className="d-flex gap-2 w-100">
              <Button
                type="button"
                className="btn btn-card-detail-action"
                onClick={handleBack}
                disabled={loading}
              >
                Back
              </Button>
              {isLastStep ? (
                <Button
                  type="submit"
                  className="btn btn-gradient flex-grow-1"
                  onClick={handleSubmit}
                  disabled={loading || !isDocumentValid() || !isPrivateValid()}
                >
                  {loading ? "Minting…" : "Mint POAP"}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="btn btn-gradient flex-grow-1"
                  onClick={handleNext}
                  disabled={!isCurrentStepValid()}
                >
                  Next
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
