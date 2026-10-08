import { Plus, Trash2 } from "lucide-react";
import { canonicalValue, FIELD_TYPES } from "../../midnight/attribute-types";
import { ID_COUNTRIES, ID_DOC_TYPES, isKnownCountry, isKnownDocType } from "../../midnight/identity";
import OptionChipsInput from "./OptionChipsInput";
import SelectDropdown from "./SelectDropdown";

const TYPE_LABELS = { text: "Text", number: "Number", date: "Date", list: "List", identity: "Identity document" };

// A List field's options: the chips (row.options) plus whatever is still being typed
// (row.optionDraft), so an option isn't lost if Create is pressed before it became a chip. Each
// must be a valid 32-byte text value.
export const listOptions = (row) => {
  const draft = (row.optionDraft || "").trim();
  return [...(row.options || []), ...(draft ? [draft] : [])];
};

// Why this row can't be saved, or null. Empty rows are fine (ignored at submit).
export function privateFieldRowError(row) {
  if (!row.fieldName.trim()) return null;
  if (row.type === "number") {
    const min = row.min === "" || row.min === undefined ? undefined : Number(row.min);
    const max = row.max === "" || row.max === undefined ? undefined : Number(row.max);
    if ((min !== undefined && !Number.isSafeInteger(min)) || (max !== undefined && !Number.isSafeInteger(max))) {
      return "Min and max must be whole numbers.";
    }
    if (min !== undefined && max !== undefined && min > max) return "Min is above max.";
  }
  if (row.type === "list") {
    const options = listOptions(row);
    if (options.length < 2) return "Add at least two options (type one and press comma or Enter).";
    if (new Set(options).size !== options.length) return "Each option must appear once.";
    const tooLong = options.find((option) => "error" in canonicalValue({ type: "text" }, option));
    if (tooLong) return `"${tooLong}" is longer than 32 bytes.`;
  }
  if (row.type === "identity") {
    if (!isKnownCountry(row.country)) return "Pick the document's country.";
    if (!isKnownDocType(row.docType)) return "Pick the document type.";
  }
  return null;
}

// The public template entry for a row (createEvent.jsx → metadata.credentialAttributeFields).
export function privateFieldFromRow(row, fieldId) {
  const field = { fieldId, label: row.fieldName.trim(), type: row.type || "text" };
  if (field.type === "number") {
    if (row.min !== "" && row.min !== undefined) field.min = Number(row.min);
    if (row.max !== "" && row.max !== undefined) field.max = Number(row.max);
  }
  if (field.type === "list") field.options = listOptions(row);
  if (field.type === "identity") {
    field.country = row.country;
    field.docType = row.docType;
  }
  return field;
}

// Repeatable list of a Credential event's private fields ({ fieldName, type, min, max, options, optionDraft, country, docType }[])
// — same controlled, full-array-in/full-array-out contract as ChannelsField.jsx. Empty list is valid
// (no private fields). The values are filled in per recipient when the credential is issued
// (mintPoap.jsx); the type decides the input there and the questions that can be asked about it
// (QuestionBuilder.jsx): numbers and dates allow ranges, like "age ≥ 18". An identity document
// (identity.ts) fixes its country and type here; each credential then carries one person's number,
// and a verifier can check it matches the document they saw.
export default function PrivateAttributesStepFields({ values, onChange }) {
  const attributes = values || [];

  const updateAttribute = (index, patch) => {
    const next = attributes.map((attribute, i) => (i === index ? { ...attribute, ...patch } : attribute));
    onChange(next);
  };

  const removeAttribute = (index) => {
    onChange(attributes.filter((_, i) => i !== index));
  };

  const addAttribute = () => {
    onChange([
      ...attributes,
      { fieldName: "", type: "text", min: "", max: "", options: [], optionDraft: "", country: "", docType: "" },
    ]);
  };

  return (
    <div className="col-12">
      {attributes.map((attribute, index) => {
        const type = attribute.type || "text";
        const error = privateFieldRowError({ ...attribute, type });
        return (
          <div className="private-field-row" key={index}>
            <div className="d-flex align-items-center mb-2" style={{ gap: "8px" }}>
              <input
                type="text"
                className="form-control"
                placeholder="Field name (e.g. Seat)"
                aria-label="Attribute label"
                value={attribute.fieldName}
                onChange={(event) => updateAttribute(index, { fieldName: event.target.value })}
              />
              <SelectDropdown
                ariaLabel="Field type"
                style={{ maxWidth: "150px", flexShrink: 0 }}
                value={type}
                onChange={(newType) => updateAttribute(index, { type: newType })}
                options={FIELD_TYPES.map((option) => ({ value: option, label: TYPE_LABELS[option] }))}
              />
              <button
                type="button"
                className="btn btn-card-detail-action btn-sm flex-shrink-0"
                onClick={() => removeAttribute(index)}
                aria-label="Remove attribute"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {type === "number" && (
              <div className="d-flex mb-2" style={{ gap: "8px" }}>
                <input
                  type="number"
                  step={1}
                  className="form-control"
                  placeholder="Min (optional)"
                  aria-label="Minimum value"
                  value={attribute.min ?? ""}
                  onChange={(event) => updateAttribute(index, { min: event.target.value })}
                />
                <input
                  type="number"
                  step={1}
                  className="form-control"
                  placeholder="Max (optional)"
                  aria-label="Maximum value"
                  value={attribute.max ?? ""}
                  onChange={(event) => updateAttribute(index, { max: event.target.value })}
                />
              </div>
            )}
            {type === "list" && (
              <div className="mb-2">
                <OptionChipsInput
                  options={attribute.options || []}
                  draft={attribute.optionDraft || ""}
                  onChange={(options, optionDraft) => updateAttribute(index, { options, optionDraft })}
                  ariaLabel="List options"
                  placeholder="Type an option and press comma (e.g. Campo)"
                />
              </div>
            )}
            {type === "identity" && (
              <div className="d-flex mb-2" style={{ gap: "8px" }}>
                <SelectDropdown
                  ariaLabel="Document country"
                  value={attribute.country || ""}
                  onChange={(country) => updateAttribute(index, { country })}
                  options={[
                    { value: "", label: "Country" },
                    ...ID_COUNTRIES.map((c) => ({ value: c.code, label: `${c.label} (${c.code})` })),
                  ]}
                />
                <SelectDropdown
                  ariaLabel="Document type"
                  value={attribute.docType || ""}
                  onChange={(docType) => updateAttribute(index, { docType })}
                  options={[{ value: "", label: "Document type" }, ...ID_DOC_TYPES.map((t) => ({ value: t.code, label: t.label }))]}
                />
              </div>
            )}
            {error && <small className="form-text text-danger d-block">{error}</small>}
          </div>
        );
      })}

      <button type="button" className="btn btn-card-detail-action btn-sm mt-1" onClick={addAttribute}>
        <Plus size={14} className="mr-1" />
        Add private field
      </button>

      <small className="form-text text-muted d-block mt-2">
        Optional. Private details each credential carries (e.g. Seat, Sector, Birth date). You'll
        fill in the values for each person when you issue their credential; only they receive
        them, and they can prove one to someone without revealing it. Numbers are whole numbers;
        numbers and dates can be asked about as ranges (e.g. "at least 18"). An identity document
        ties the credential to its holder: a verifier who checks their document can confirm the
        credential is theirs, so it can't be answered with someone else's.
      </small>
    </div>
  );
}
