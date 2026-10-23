import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  DATE_SPAN_AFTER_YEARS,
  DATE_SPAN_BEFORE_YEARS,
  DEFAULT_NUMBER_SPAN,
  MAX_AGE_YEARS,
  VALIDITY_PERIOD_MONTHS,
  addYears,
  ageCutoffText,
  agePresetRule,
  describePeriod,
  canonicalValue,
  fieldType,
  ruleError,
  ruleSize,
  todayIso,
  validityPresetRule,
} from "../../midnight/attribute-types";
import SelectDropdown from "./SelectDropdown";

// Above this many accepted values, holders wait a few seconds while their browser builds the set.
const SLOW_SET_SIZE = 2000;

const OPS = {
  text: [{ value: "oneOf", label: "is one of" }],
  list: [{ value: "oneOf", label: "is one of" }],
  number: [
    { value: "gte", label: "is at least (≥)" },
    { value: "lte", label: "is at most (≤)" },
    { value: "between", label: "is between" },
    { value: "oneOf", label: "is one of" },
  ],
  date: [
    { value: "onOrBefore", label: "is on or before" },
    { value: "onOrAfter", label: "is on or after" },
    { value: "between", label: "is between" },
  ],
};

// A credential's "Valid until" date (validity.ts) gets plain-language questions first, anchored on
// today (attribute-types.ts#validityPresetRule); the generic date questions stay below them.
const PRESET_PREFIX = "preset:";
const VALIDITY_OPS = [
  { value: `${PRESET_PREFIX}valid`, label: "is still valid (not expired)" },
  { value: `${PRESET_PREFIX}expired`, label: "has expired" },
  { value: `${PRESET_PREFIX}expiresWithin`, label: "expires within…" },
  { value: `${PRESET_PREFIX}validFor`, label: "is valid for at least…" },
];
// Any other date (a date of birth…) gets age questions first: the asker types an age, the form
// works out the birth date it turns on (attribute-types.ts#agePresetRule).
const AGE_OPS = [
  { value: "ageAtLeast", text: (label) => `${label}: at least N years old` },
  { value: "ageUnder", text: (label) => `${label}: under N years old` },
];
const isAgeOp = (op) => op === "ageAtLeast" || op === "ageUnder";
const isValidUntilField = (field) => field?.auto === "validUntil";
const opsFor = (field) =>
  isValidUntilField(field)
    ? [...VALIDITY_OPS, ...OPS.date]
    : fieldType(field) === "date"
      ? [...AGE_OPS, ...OPS.date]
      : OPS[fieldType(field)];

const toInt = (raw) => (/^[+-]?\d+$/.test(String(raw).trim()) ? Number(String(raw).trim()) : NaN);

// Builds one question (a rule, attribute-types.ts) about a typed credential field and reports it up
// through onChange(rule | null, error | null). A range needs both ends to become a finite set: the
// field's own min/max when it has them, otherwise an editable default ("up to", "from").
export default function QuestionBuilder({ field, onChange }) {
  const type = fieldType(field);
  const ops = opsFor(field);
  const [op, setOp] = useState(ops[0].value);
  const [months, setMonths] = useState("6"); // "expires within" / "valid for at least"
  const presetKind = op.startsWith(PRESET_PREFIX) ? op.slice(PRESET_PREFIX.length) : null;
  const [values, setValues] = useState(["", ""]); // oneOf (text/number)
  const [picked, setPicked] = useState([]); // oneOf (list)
  const [a, setA] = useState(""); // number: value / from · date: date / from · age: years old
  const [b, setB] = useState(""); // number: to · date: to
  const [bound, setBound] = useState(""); // the open end of a one-sided range

  // A different field (or type) starts a fresh question.
  useEffect(() => {
    setOp(opsFor(field)[0].value);
    setMonths("6");
    setValues(["", ""]);
    setPicked([]);
    setA("");
    setB("");
    setBound("");
  }, [field]);

  const defaultBound = useMemo(() => {
    if (type === "number") {
      const n = toInt(a);
      if (op === "gte") return field.max !== undefined ? String(field.max) : Number.isNaN(n) ? "" : String(n + DEFAULT_NUMBER_SPAN);
      if (op === "lte") return field.min !== undefined ? String(field.min) : Number.isNaN(n) ? "" : String(n - DEFAULT_NUMBER_SPAN);
    }
    if (type === "date") {
      if (op === "onOrBefore" && a) return addYears(a, -DATE_SPAN_BEFORE_YEARS);
      if (op === "onOrAfter" && a) return addYears(a, DATE_SPAN_AFTER_YEARS);
    }
    return "";
  }, [type, op, a, field]);
  const effectiveBound = bound || defaultBound;
  const oneSided =
    !presetKind &&
    ((type === "number" && (op === "gte" || op === "lte")) || (type === "date" && (op === "onOrBefore" || op === "onOrAfter")));
  const ageYears = isAgeOp(op) ? toInt(a) : NaN;
  const ageValid = !Number.isNaN(ageYears) && ageYears >= 1 && ageYears <= MAX_AGE_YEARS;

  const { rule, error } = useMemo(() => {
    try {
      let built = null;
      if (presetKind) {
        built = validityPresetRule(presetKind, todayIso(), Number(months));
      } else if (op === "oneOf") {
        const raw = type === "list" ? picked : values.filter((v) => v.trim());
        const canonical = raw.map((v) => {
          const result = canonicalValue(type === "list" ? { ...field, type: "text" } : field, v);
          if ("error" in result) throw new Error(`"${v}": ${result.error}`);
          return result.value;
        });
        built = { op: "oneOf", values: canonical };
      } else if (type === "number") {
        const first = toInt(a);
        const second = toInt(op === "between" ? b : effectiveBound);
        if (Number.isNaN(first) || Number.isNaN(second)) return { rule: null, error: null };
        built =
          op === "gte"
            ? { op, type, min: first, max: second }
            : op === "lte"
              ? { op, type, min: second, max: first }
              : { op, type, min: first, max: second };
      } else {
        if (isAgeOp(op)) {
          if (!a.trim()) return { rule: null, error: null };
          if (!ageValid) return { rule: null, error: `Enter an age from 1 to ${MAX_AGE_YEARS}.` };
          built = agePresetRule(op, todayIso(), ageYears);
        } else {
          if (!a || !(op === "between" ? b : effectiveBound)) return { rule: null, error: null };
          built =
            op === "onOrBefore"
              ? { op, type, from: effectiveBound, to: a }
              : op === "onOrAfter"
                ? { op, type, from: a, to: effectiveBound }
                : { op, type, from: a, to: b };
        }
      }
      const problem = ruleError(built);
      return problem ? { rule: null, error: problem } : { rule: built, error: null };
    } catch (err) {
      return { rule: null, error: err.message };
    }
  }, [op, presetKind, months, type, field, values, picked, a, b, effectiveBound, ageValid, ageYears]);

  useEffect(() => {
    onChange(rule, error);
  }, [rule, error, onChange]);

  const size = rule ? ruleSize(rule) : 0;
  // A range that lets a single value through asks for the exact value (an edited far end can do it).
  const exactOnly = rule && rule.op !== "oneOf" && rule.op !== "identity" && size === 1;
  const inputType = isAgeOp(op) ? "number" : type === "date" ? "date" : type === "number" ? "number" : "text";

  return (
    <>
      {ops.length > 1 && (
        <div className="col-12">
          <label className="form-label" htmlFor="questionOp">Question</label>
          <SelectDropdown
            id="questionOp"
            value={op}
            onChange={(next) => {
              if (isAgeOp(next) !== isAgeOp(op)) setA(""); // an age and a date don't carry over
              setOp(next);
            }}
            options={ops.map((option) => ({
              value: option.value,
              label: option.text
                ? option.text(field.label)
                : `${option.value.startsWith(PRESET_PREFIX) ? "The credential" : field.label} ${option.label}`,
            }))}
          />
        </div>
      )}

      {(presetKind === "expiresWithin" || presetKind === "validFor") && (
        <div className="col-12">
          <label className="form-label" htmlFor="questionPeriod">
            {presetKind === "expiresWithin" ? "Expires within" : "Valid for at least"}
          </label>
          <SelectDropdown
            id="questionPeriod"
            value={months}
            onChange={setMonths}
            options={VALIDITY_PERIOD_MONTHS.map((n) => ({ value: String(n), label: describePeriod(n) }))}
          />
        </div>
      )}

      {presetKind && (
        <div className="col-12">
          <small className="form-text text-muted d-block">
            Counted from today. The holder proves it without revealing the date.
          </small>
        </div>
      )}

      {op === "oneOf" && type === "list" && (
        <div className="col-12">
          <label className="form-label">Accepted values</label>
          {(field.options || []).map((option) => (
            <div className="form-check form-switch share-toggle-row mb-2" key={option}>
              <input
                className="form-check-input"
                type="checkbox"
                id={`accept-${option}`}
                checked={picked.includes(option)}
                onChange={(e) =>
                  setPicked((current) => (e.target.checked ? [...current, option] : current.filter((v) => v !== option)))
                }
              />
              <label className="form-check-label" htmlFor={`accept-${option}`}>{option}</label>
            </div>
          ))}
        </div>
      )}

      {op === "oneOf" && type !== "list" && (
        <div className="col-12">
          <label className="form-label">Candidate set</label>
          {values.map((value, index) => (
            <div className="d-flex align-items-center mb-2" style={{ gap: "8px" }} key={index}>
              <input
                type={inputType}
                className="form-control"
                placeholder={type === "number" ? "e.g. 7" : "e.g. EU"}
                aria-label="Candidate value"
                value={value}
                onChange={(e) => setValues((current) => current.map((v, i) => (i === index ? e.target.value : v)))}
              />
              <button
                type="button"
                className="btn btn-card-detail-action btn-sm flex-shrink-0"
                onClick={() => setValues((current) => current.filter((_, i) => i !== index))}
                aria-label="Remove candidate value"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-card-detail-action btn-sm mt-1" onClick={() => setValues((c) => [...c, ""])}>
            <Plus size={14} className="mr-1" />
            Add candidate value
          </button>
          <small className="form-text text-muted d-block mt-2">
            The real answer must be one of these values, plus at least one decoy — a set with
            too few members makes membership equivalent to full disclosure.
          </small>
        </div>
      )}

      {isAgeOp(op) && (
        <div className="col-12">
          <label className="form-label" htmlFor="questionAge">
            {op === "ageAtLeast" ? "At least this age (years)" : "Under this age (years)"}
          </label>
          <input
            id="questionAge"
            type="number"
            min="1"
            max={MAX_AGE_YEARS}
            className="form-control"
            placeholder="e.g. 18"
            value={a}
            onChange={(e) => setA(e.target.value)}
          />
          <small className="form-text text-muted d-block">
            {ageValid
              ? `Counted from today: ${ageCutoffText(op, todayIso(), ageYears)}. The holder proves it without revealing the date.`
              : "Counted from today. The holder proves it without revealing the date."}
          </small>
        </div>
      )}

      {op !== "oneOf" && !presetKind && !isAgeOp(op) && (
        <div className="col-12">
          <div className="d-flex" style={{ gap: "8px" }}>
            <div className="flex-grow-1">
              <label className="form-label" htmlFor="questionA">
                {op === "between" ? "From" : "Value"}
              </label>
              <input
                id="questionA"
                type={inputType}
                className="form-control"
                value={a}
                onChange={(e) => setA(e.target.value)}
              />
            </div>
            {op === "between" && (
              <div className="flex-grow-1">
                <label className="form-label" htmlFor="questionB">To</label>
                <input
                  id="questionB"
                  type={type === "date" ? "date" : "number"}
                  className="form-control"
                  value={b}
                  onChange={(e) => setB(e.target.value)}
                />
              </div>
            )}
          </div>
          {oneSided && (
            <div className="mt-2">
              <label className="form-label small text-muted" htmlFor="questionBound">
                {op === "gte" ? "Up to" : op === "lte" ? "From" : op === "onOrAfter" ? "No later than" : "No earlier than"}
                {type === "number" &&
                  ((op === "gte" && field.max !== undefined) || (op === "lte" && field.min !== undefined)) &&
                  " (the field's own limit)"}
              </label>
              <input
                id="questionBound"
                type={type === "date" ? "date" : "number"}
                className="form-control"
                value={effectiveBound}
                onChange={(e) => setBound(e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {(rule || error) && (
        <div className="col-12">
          {error ? (
            <small className="form-text text-danger d-block">{error}</small>
          ) : (
            <small className={`form-text d-block ${exactOnly ? "text-warning" : "text-muted"}`}>
              {exactOnly
                ? "Only one value is accepted, so this asks for the exact value. Check both ends of the range."
                : `Accepts ${size.toLocaleString()} value${size === 1 ? "" : "s"}.`}
              {size > SLOW_SET_SIZE && " Holders' browsers take a few seconds to prepare a proof for it."}
            </small>
          )}
        </div>
      )}
    </>
  );
}
