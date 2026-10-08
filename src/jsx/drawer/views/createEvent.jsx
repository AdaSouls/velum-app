import {
  useDrawer,
  useDrawerDispatch,
} from "../../contexts/drawer/drawer.provider";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "react-bootstrap";
import { X, Info } from "lucide-react";
import {
  errorFunction,
  loadingFunction,
  succesfullBlockchainCreation,
} from "../../toasts/sweetAlerts";
import EventDetailsFields from "../../components/EventDetailsFields";
import EventImageField from "../../components/EventImageField";
import CategoryPicker from "../../components/CategoryPicker";
import TaxonomyStepFields from "../../components/TaxonomyStepFields";
import ChannelsField from "../../components/ChannelsField";
import OrganizationProfileFields from "../../components/OrganizationProfileFields";
import PrivateAttributesStepFields, {
  privateFieldFromRow,
  privateFieldRowError,
} from "../../components/PrivateAttributesStepFields";
import { uploadImageToIPFS, uploadJSONToIPFS } from "../../../services/ipfs.service";
import { getCroppedImageBlob } from "../../../utils/cropImage";
import {
  EVENT_CATEGORIES,
  getCategoryConfig,
  isOrganizationProfileApplicable,
  serializeTaxonomyValues,
} from "../../constants/eventCategories";
import eventNormal from "../../../images/svg/event-normal.svg";
import { txHashOf } from "../../../midnight/tx-result";
import { VALID_UNTIL_FIELD, VALIDITY_UNITS, parseValidity } from "../../../midnight/validity";
import SelectDropdown from "../../components/SelectDropdown";
import { friendlyErrorMessage } from "../../../midnight/friendly-error";
import { getOrganizerProfile, saveOrganizerProfile } from "../../../midnight/organizer-profile";

// NOTE: createEvent(eventId, maxSupply, expiration, isPublicMint, metadataURI) circuit — the
// metadataURI is a pointer to off-chain JSON (name/description/image/category/…), not stored
// on-chain itself. It's shared by every token minted for this event. Built here from the wizard's
// steps by pinning an (optional) image and the resulting JSON to IPFS via the local server/ proxy
// — never a manually-authored URI, and never a Pinata key in this bundle.
//
// Step 0 picks a category (Event/Subscription/Credential, see
// src/jsx/constants/eventCategories.js) before anything else — see
// docs/event-creation-wizard-design.md for the full design. Every category then walks the SAME
// step sequence (details → image → supply → channels → taxonomy → org profile [conditional] →
// private fields [Credential only] → POAP image), just with different taxonomy fields and a fixed, non-editable
// isPublicMint derived from the category. `step` is 0 for the category picker, then a 1-based
// index into `steps` (computed below) once a category is chosen. The Public Mint/Invite-Only Mint
// explanation used to repeat as its own card on the supply step — moved to a badge on each
// category card in CategoryPicker.jsx instead, since the choice is actually made at step 0 and
// showing it again later (immutably) just confused people.
const STEP_DETAILS = "details";
const STEP_IMAGE = "image";
const STEP_SUPPLY = "supply";
const STEP_CHANNELS = "channels";
const STEP_TAXONOMY = "taxonomy";
const STEP_ORG_PROFILE = "orgProfile";
const STEP_PRIVATE_ATTRIBUTES = "privateAttributes";
const STEP_POAP_IMAGE = "poapImage";

const CATEGORY_LIST = Object.values(EVENT_CATEGORIES);

const PROFILE_SUMMARY_ROWS = [
  ["name", "Name"],
  ["addressLine", "Address"],
  ["locality", "City"],
  ["region", "State / Province"],
  ["country", "Country"],
  ["postalCode", "Postal code"],
];

// Read-only view of the organizer details the event will carry (STEP_ORG_PROFILE, profile switch on).
function OrganizerProfileSummary({ profile }) {
  const rows = PROFILE_SUMMARY_ROWS.filter(([key]) => profile?.[key]);
  if (!rows.length) return null;
  return (
    <ul className="list-unstyled small mb-0 mt-3">
      {rows.map(([key, label]) => (
        <li key={key} className="mb-1">
          <span className="text-muted">{label}: </span>
          <span className="text-white">{profile[key]}</span>
        </li>
      ))}
    </ul>
  );
}

export default function CreateEvent() {
  const { midnight: { provider } } = useDrawer();
  const dispatch = useDrawerDispatch();

  const [category, setCategory] = useState(null);
  const [step, setStep] = useState(0);

  const [metadata, setMetadata] = useState({
    name: "",
    description: "",
    imageFile: null,
    croppedAreaPixels: null,
  });
  const [maxSupply, setMaxSupply] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  // How long each POAP stays valid (validity.ts). Unit "" = no expiry.
  const [validityAmount, setValidityAmount] = useState("");
  const [validityUnit, setValidityUnit] = useState("");
  const [channels, setChannels] = useState([]);
  const [taxonomyValues, setTaxonomyValues] = useState({});
  // This identity's saved organizer profile (organizer-profile.ts). With one, the step only shows a
  // "Use my organizer profile" switch (on) and a summary of what the event will carry; turning it
  // off opens the fields, prefilled, to change them for this event (saveAsProfile off by default, so
  // a one-off change doesn't overwrite the profile). Without one, the fields are open and
  // saveAsProfile starts on, so the details are typed once, not per event. Saved only after a
  // successful create.
  const [savedProfile, setSavedProfile] = useState(() => getOrganizerProfile(provider?.address));
  const [useSavedProfile, setUseSavedProfile] = useState(() => Boolean(getOrganizerProfile(provider?.address)));
  const [organizationProfile, setOrganizationProfile] = useState(() => getOrganizerProfile(provider?.address) ?? {});
  const [saveAsProfile, setSaveAsProfile] = useState(() => !getOrganizerProfile(provider?.address));
  useEffect(() => {
    const saved = getOrganizerProfile(provider?.address);
    setSavedProfile(saved);
    if (!saved) return;
    setUseSavedProfile(true);
    setSaveAsProfile(false);
    setOrganizationProfile((current) =>
      Object.values(current).some((value) => String(value ?? "").trim()) ? current : saved,
    );
  }, [provider?.address]);
  // { fieldName, type, min, max, options, optionDraft }[] — Credential only: each credential's private fields.
  const [privateAttributes, setPrivateAttributes] = useState([]);
  // On by default: most organizers want a distinct POAP image; the switch turns it off to reuse the
  // event's own image.
  const [usePoapImage, setUsePoapImage] = useState(true);
  // Separate {imageFile, croppedAreaPixels} pair — EventImageField hardcodes those two field names
  // on whatever `values` object it's given, so this can't share `metadata` above without colliding
  // with the event's own image.
  const [poapImageValues, setPoapImageValues] = useState({ imageFile: null, croppedAreaPixels: null });
  const [loading, setLoading] = useState(false);
  // Cropped once when leaving the image step, reused both for the supply step's preview card and
  // the actual upload at submit — avoids re-running the canvas crop twice.
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  const [preparedImageBlob, setPreparedImageBlob] = useState(null);
  const previewUrlRef = useRef(null);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const categoryConfig = getCategoryConfig(category);

  // STEP_ORG_PROFILE is always in the sequence now — it collects an organizer display name (see
  // OrganizationProfileFields.jsx), which is just as relevant for an individual as for a company,
  // so the step itself is never skipped. Only its address sub-fields are conditionally shown,
  // via showOrgAddress below (recomputed on every taxonomy answer) — see
  // isOrganizationProfileApplicable's doc comment for the per-category rule on that part.
  //
  // STEP_POAP_IMAGE only applies to categories where every token shares the event's own image set
  // (Event/Subscription, isPublicMint) — a single image chosen once at event-creation time,
  // inherited by every self-claim. Credential tokens are minted individually afterward (push-mint,
  // see mintPoap.jsx) with their own per-recipient image, so there's nothing for this step to set:
  // asking for one shared "POAP image" here would be misleading, not just redundant.
  const showOrgAddress = isOrganizationProfileApplicable(category, taxonomyValues);
  const usingSavedProfile = useSavedProfile && Boolean(savedProfile);
  // What goes into the event's public metadata: the address only where this category asks for it.
  const profileSource = usingSavedProfile ? savedProfile : organizationProfile;
  const eventOrganization = showOrgAddress ? profileSource : { name: profileSource?.name };
  const steps = useMemo(() => {
    if (!categoryConfig) return [];
    const list = [STEP_DETAILS, STEP_IMAGE, STEP_SUPPLY, STEP_CHANNELS, STEP_TAXONOMY, STEP_ORG_PROFILE];
    // Private fields only make sense per credential (each holder has their own values and proves
    // them anonymously). Event/Subscription used to take event-level private attributes, the same
    // for every holder; removed 2026-09-24: a question about them said nothing about the holder.
    if (category === "credential") {
      list.push(STEP_PRIVATE_ATTRIBUTES);
    }
    if (categoryConfig.isPublicMint) {
      list.push(STEP_POAP_IMAGE);
    }
    return list;
  }, [categoryConfig, category]);

  const currentStepKey = step > 0 ? steps[step - 1] : null;
  const isLastStep = step > 0 && step === steps.length;

  const isDetailsValid = () => metadata.name.trim().length > 0;
  const validity = validityUnit ? parseValidity({ amount: validityAmount, unit: validityUnit }) : null;
  const isSupplyValid = () => Number(maxSupply) >= 0 && (!validityUnit || Boolean(validity));
  // Only Event/Subscription have the POAP image step. The switch starts on, so without this check a
  // Credential (no such step) would be blocked asking for an image it never offered.
  const wantsPoapImage = usePoapImage && steps.includes(STEP_POAP_IMAGE);
  const isPoapImageValid = () => !wantsPoapImage || Boolean(poapImageValues.imageFile);
  const isPrivateAttributesValid = () => privateAttributes.every((row) => !privateFieldRowError(row));

  const stepValidators = {
    [STEP_DETAILS]: isDetailsValid,
    [STEP_SUPPLY]: isSupplyValid,
    [STEP_POAP_IMAGE]: isPoapImageValid,
    [STEP_PRIVATE_ATTRIBUTES]: isPrivateAttributesValid,
  };
  const isCurrentStepValid = () => {
    if (step === 0) return category !== null;
    const validator = stepValidators[currentStepKey];
    return validator ? validator() : true;
  };

  const closeDrawer = () => {
    dispatch({ type: "CLOSE_DRAWER" });
  };

  // Only called when metadata.imageFile is truthy (see handleNext) — the no-image case is handled
  // inline there, synchronously.
  const prepareImagePreview = async () => {
    try {
      const blob = metadata.croppedAreaPixels
        ? await getCroppedImageBlob(metadata.imageFile, metadata.croppedAreaPixels)
        : metadata.imageFile;
      setPreparedImageBlob(blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setPreviewImageUrl(url);
    } catch (error) {
      console.error("Error preparing image preview:", error);
    }
  };

  // Stays synchronous (no `await` reached) whenever there's no image to crop — the common case —
  // so the step change lands in the same React batch as the click, instead of deferring to a
  // microtask. Only the actual crop path needs the extra tick.
  const handleNext = () => {
    if (currentStepKey === STEP_IMAGE && metadata.imageFile) {
      prepareImagePreview().then(() => setStep((s) => s + 1));
      return;
    }
    if (currentStepKey === STEP_IMAGE) {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreparedImageBlob(null);
      setPreviewImageUrl(null);
    }
    setStep((s) => s + 1);
  };

  // Going back from the first content step returns to the category picker (step 0) — category and
  // every field already entered stay as-is, only actually replaced if a different category is
  // subsequently chosen.
  const handleBack = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!provider) {
      errorFunction("Wallet Required", "Please connect your wallet first.", "");
      return;
    }

    // createEvent reverts with "Issuer is deactivated" once the admin has blocked this key (any
    // key can be blocked, registered or not). Checked against the live ledger before the IPFS
    // uploads, so a blocked organizer isn't left with orphaned pins and a failed transaction.
    try {
      const { ledger } = await provider.service.getState();
      const callerPk = Uint8Array.from(Buffer.from(provider.address, "hex"));
      if (ledger.issuers.member(callerPk) && !ledger.issuers.lookup(callerPk).isActive) {
        errorFunction("Organizer Blocked", "An admin has blocked this wallet from creating events.", "");
        return;
      }
    } catch (stateError) {
      console.warn("Could not check issuer status before creating the event:", stateError);
    }

    if (!categoryConfig) {
      errorFunction("Validation Error", "Choose what you're creating first.", "");
      return;
    }

    if (!isSupplyValid()) {
      errorFunction("Validation Error", "Maximum Supply must be 0 (unlimited) or greater.", "");
      return;
    }

    if (!isPoapImageValid()) {
      errorFunction("Validation Error", "Please choose a POAP image, or turn the switch off to use the event's own image.", "");
      return;
    }

    setLoading(true);
    try {
      let imageUri;
      if (preparedImageBlob) {
        loadingFunction("Creating Event", "Uploading image to IPFS…", "");
        imageUri = await uploadImageToIPFS(preparedImageBlob);
      }

      let poapImageUri;
      if (wantsPoapImage && poapImageValues.imageFile) {
        loadingFunction("Creating Event", "Uploading POAP image to IPFS…", "");
        const poapBlob = poapImageValues.croppedAreaPixels
          ? await getCroppedImageBlob(poapImageValues.imageFile, poapImageValues.croppedAreaPixels)
          : poapImageValues.imageFile;
        poapImageUri = await uploadImageToIPFS(poapBlob);
      }

      // `label` — NOT the on-chain eventId. createEvent used to accept a raw caller-chosen eventId
      // directly, which was a confirmed vulnerability (event-ID squatting: whoever called
      // createEvent first for a given id became its organizer forever, no recovery). The contract
      // now derives the real id as event_key(organizerPk, label) internally; a fresh random 32
      // bytes works fine as a label, same as the old eventId generation did.
      const label = new Uint8Array(32);
      crypto.getRandomValues(label);

      // poap.compact's createEvent still takes a privateMetadataCommit slot (the commit/reveal
      // "Extra Info" feature this UI used to offer) — always pass the all-zero default now that
      // this wizard no longer sets it, per poap.compact's own convention for "no private part".
      const privateMetadataCommit = new Uint8Array(32);

      // Credential: public list of fields (name, type and its limits/options) + fresh random fieldIds,
      // no values and no event-level root (privateAttributesRoot stays all-zero). mintPoap.jsx reads
      // this list to ask for each recipient's values.
      const credentialAttributeFieldsForMetadata = category === "credential"
        ? privateAttributes
            .filter((row) => row.fieldName.trim())
            .map((row) =>
              privateFieldFromRow(row, Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")),
            )
        : [];
      // A Credential with validity also carries its end date as a private field, so a verifier can
      // ask "valid until ≥ today" anonymously (validity.ts). mintPoap.jsx fills it in at issuance.
      if (category === "credential" && validity) {
        credentialAttributeFieldsForMetadata.push({
          fieldId: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex"),
          ...VALID_UNTIL_FIELD,
        });
      }
      const privateAttributesRoot = new Uint8Array(32);

      // Credential: the key holders seal credential update requests to (credential-update.ts) — e.g.
      // after their document changes. Derived from this identity, so nothing new to store. Best
      // effort: without it the event works the same, its holders just can't ask for updates.
      let updateRequestKey = null;
      if (category === "credential" && typeof provider.service?.getInboxKeyPair === "function") {
        try {
          updateRequestKey = (await provider.service.getInboxKeyPair()).publicKeyHex;
        } catch (inboxError) {
          console.error("Could not derive the update-request key:", inboxError);
        }
      }

      const taxonomyEntries = serializeTaxonomyValues(category, taxonomyValues);
      const hasOrgProfileField = Object.values(eventOrganization).some(
        (value) => typeof value === "string" && value.trim().length > 0,
      );

      loadingFunction("Creating Event", "Uploading metadata to IPFS…", "");
      const metadataURI = await uploadJSONToIPFS({
        name: metadata.name.trim(),
        ...(metadata.description.trim() ? { description: metadata.description.trim() } : {}),
        ...(imageUri ? { image: imageUri } : {}),
        ...(poapImageUri ? { poapImage: poapImageUri } : {}),
        category,
        ...taxonomyEntries,
        ...(channels.length ? { channels } : {}),
        ...(hasOrgProfileField ? { organization: eventOrganization } : {}),
        ...(credentialAttributeFieldsForMetadata.length
          ? { credentialAttributeFields: credentialAttributeFieldsForMetadata }
          : {}),
        ...(validity ? { validity } : {}),
        ...(updateRequestKey ? { updateRequestKey } : {}),
      });

      const expiration = expirationDate
        ? BigInt(Math.floor(new Date(expirationDate).getTime() / 1000))
        : 0n;

      loadingFunction("Creating Event", "Preparing transaction…", "");

      const txHash = txHashOf(
        await provider.service.createEvent(
          label,
          BigInt(maxSupply || 0),
          expiration,
          categoryConfig.isPublicMint,
          metadataURI,
          privateMetadataCommit,
          privateAttributesRoot,
        ),
      );

      // Only after the transaction succeeded: a failed create leaves the saved profile as it was.
      if (!usingSavedProfile && saveAsProfile) saveOrganizerProfile(provider.address, organizationProfile);

      closeDrawer();
      succesfullBlockchainCreation("Event Created Successfully", `Transaction: ${txHash}`, "");
    } catch (error) {
      console.error("Error creating event:", error);
      errorFunction(
        "Error",
        friendlyErrorMessage(error, "An error occurred while creating the event. Please try again."),
        "",
      );
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
          {categoryConfig ? categoryConfig.headerTitle : "New POAP Group"}
        </h4>
      </div>

      {categoryConfig && (
        <div className="drawer-modal-steps">
          {steps.map((stepKey, index) => (
            <span key={stepKey} className={`step-dot${step === index + 1 ? ' active' : ''}`} />
          ))}
        </div>
      )}

      <div className="drawer-body">
        <form className="row g-3" onSubmit={handleSubmit}>
          {step === 0 && (
            <CategoryPicker value={category} onChange={setCategory} categories={CATEGORY_LIST} />
          )}

          {currentStepKey === STEP_DETAILS && (
            <EventDetailsFields values={metadata} onChange={setMetadata} category={category} />
          )}

          {currentStepKey === STEP_IMAGE && (
            <EventImageField values={metadata} onChange={setMetadata} />
          )}

          {currentStepKey === STEP_SUPPLY && (
            <>
              <div className="col-12">
                <div className="drawer-modal-preview-card">
                  <div className="d-flex align-items-center">
                    <img
                      className="mr-3"
                      src={previewImageUrl || eventNormal}
                      width="96"
                      height="96"
                      alt=""
                      style={{ objectFit: "cover", borderRadius: 16, flexShrink: 0 }}
                    />
                    <div>
                      <h5 className="mb-1" style={{ fontSize: "16px" }}>
                        {metadata.name.trim() || "Untitled Event"}
                      </h5>
                      {metadata.description.trim() && (
                        <p className="small text-muted mb-0">{metadata.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12">
                <label className="form-label" htmlFor="maxSupply">
                  Maximum Supply <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  className="form-control"
                  placeholder="0 for unlimited"
                  id="maxSupply"
                  name="maxSupply"
                  value={maxSupply}
                  onChange={(event) => setMaxSupply(event.target.value)}
                  required
                  min="0"
                />
                <small className="form-text text-muted">
                  Maximum number of POAPs that can be claimed for this event. 0 means unlimited.
                </small>
              </div>

              <div className="col-12 mb-3">
                <label className="form-label" htmlFor="expirationDate">Expiration Date</label>
                <input
                  type="date"
                  className="form-control"
                  id="expirationDate"
                  name="expirationDate"
                  value={expirationDate}
                  onChange={(event) => setExpirationDate(event.target.value)}
                />
                <small className="form-text text-muted">
                  Optional. No new POAPs can be {categoryConfig?.isPublicMint ? "claimed" : "issued"} after this
                  date. Leave blank for no expiration.
                </small>
              </div>

              <div className="col-12 mb-3">
                <label className="form-label" htmlFor="validityAmount">Validity</label>
                <div className="d-flex" style={{ gap: "8px" }}>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="form-control"
                    id="validityAmount"
                    placeholder="e.g. 1"
                    value={validityAmount}
                    disabled={!validityUnit}
                    onChange={(event) => setValidityAmount(event.target.value)}
                  />
                  <SelectDropdown
                    ariaLabel="Validity unit"
                    value={validityUnit}
                    onChange={setValidityUnit}
                    options={[
                      { value: "", label: "No expiry" },
                      ...VALIDITY_UNITS.map((unit) => ({ value: unit, label: unit[0].toUpperCase() + unit.slice(1) })),
                    ]}
                  />
                </div>
                <small className="form-text text-muted">
                  Optional. How long each POAP stays valid,{" "}
                  {category === "subscription"
                    ? "counted from the holder's last proof of ownership: they renew by proving it again."
                    : category === "credential"
                      ? "counted from when it's issued. Each credential also gets a private \"Valid until\" date the holder can prove without revealing it."
                      : "counted from when it's claimed."}
                </small>
              </div>

              {category === "credential" && (
                <div className="col-12 mb-3">
                  <div className="info-hint-card m-0">
                    <Info size={16} />
                    <p>
                      Re-issuing a credential (for example when its holder's document changes) uses one more
                      place of the supply, since revoking doesn't free one, and isn't possible after the
                      expiration date. Leave room, or use 0 for unlimited.
                    </p>
                  </div>
                </div>
              )}

            </>
          )}

          {currentStepKey === STEP_CHANNELS && (
            <ChannelsField values={channels} onChange={setChannels} />
          )}

          {currentStepKey === STEP_TAXONOMY && (
            <TaxonomyStepFields
              taxonomy={categoryConfig.taxonomy}
              values={taxonomyValues}
              onChange={setTaxonomyValues}
            />
          )}

          {currentStepKey === STEP_ORG_PROFILE && (
            <>
              {savedProfile && (
                <div className="col-12 mb-3">
                  <div className="drawer-modal-preview-card">
                    <div className="d-flex align-items-center" style={{ gap: "14px" }}>
                      <div className="form-check form-switch mb-0 flex-shrink-0">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          id="useSavedProfile"
                          aria-label="Use my organizer profile"
                          checked={useSavedProfile}
                          onChange={(event) => setUseSavedProfile(event.target.checked)}
                        />
                      </div>
                      <div>
                        <span className="d-block font-weight-semibold">Use my organizer profile</span>
                        <small className="form-text text-muted d-block mt-1">
                          {useSavedProfile
                            ? "These details are shown publicly on this event."
                            : "Change the details below for this event."}
                        </small>
                      </div>
                    </div>
                    {useSavedProfile && <OrganizerProfileSummary profile={eventOrganization} />}
                  </div>
                </div>
              )}
              {!usingSavedProfile && (
                <>
                  <OrganizationProfileFields
                    values={organizationProfile}
                    onChange={setOrganizationProfile}
                    showAddress={showOrgAddress}
                  />
                  <div className="col-12 mt-2">
                    <div className="form-check form-switch mb-0 d-flex align-items-start" style={{ gap: "10px" }}>
                      <input
                        className="form-check-input flex-shrink-0"
                        type="checkbox"
                        id="saveAsProfile"
                        checked={saveAsProfile}
                        onChange={(event) => setSaveAsProfile(event.target.checked)}
                      />
                      <label className="form-check-label" htmlFor="saveAsProfile">
                        <span className="d-block">Save as my organizer profile</span>
                        <small className="form-text text-muted d-block mt-1">
                          {savedProfile
                            ? "Replaces your saved profile with these details for the next events."
                            : "These details are shown publicly on your events. Saved with your encrypted backup, so they're filled in next time."}
                        </small>
                      </label>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {currentStepKey === STEP_PRIVATE_ATTRIBUTES && (
            <PrivateAttributesStepFields
              values={privateAttributes}
              onChange={setPrivateAttributes}
            />
          )}

          {currentStepKey === STEP_POAP_IMAGE && (
            <>
              <div className="col-12">
                <div className="drawer-modal-preview-card">
                  <div className="d-flex align-items-center" style={{ gap: "14px" }}>
                    <div className="form-check form-switch mb-0 flex-shrink-0">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="usePoapImage"
                        aria-label="Use a different image for the POAP"
                        checked={usePoapImage}
                        onChange={(event) => setUsePoapImage(event.target.checked)}
                      />
                    </div>
                    <div>
                      <span className="d-block font-weight-semibold">
                        {usePoapImage ? "Different POAP Image" : "Same as Event Image"}
                      </span>
                      <small className="form-text text-muted d-block mt-1">
                        {usePoapImage
                          ? "Choose the image attendees will see on the POAP they claim, separate from the event's own listing image."
                          : "The claimed POAP will display the same image as the event listing."}
                      </small>
                    </div>
                  </div>
                </div>
              </div>

              {usePoapImage && (
                <EventImageField values={poapImageValues} onChange={setPoapImageValues} circular />
              )}
            </>
          )}
        </form>
      </div>

      <div className="drawer-footer">
        {step === 0 ? (
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
                disabled={loading || !isCurrentStepValid()}
              >
                {loading ? "Creating…" : "Create"}
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
    </div>
  );
}
