// Typed private fields for Credential events (A4) and the questions that can be asked about them
// (A3). SDK-free on purpose: the wizard, Mint POAP, Ask for a Disclosure and the holder's proofs
// all share these rules, and they must agree on the exact text of every value.
//
// The contract only proves "my value is one of the values in this set" (a depth-16 set tree, up to
// 65,536 members), so a range question is expanded to every value it accepts. Values are stored as
// canonical text (attribute-value-codec.ts pads it to 32 bytes):
//   number — a plain integer: "18", "-3" (no plus sign, no leading zeros, no decimals);
//   date   — "YYYY-MM-DD" (UTC calendar day);
//   list   — exactly one of the field's options;
//   text   — trimmed text, at most 32 bytes;
//   identity — a document number (identity.ts), normalized. Not stored as text: the credential
//              commits computeIdentityValue(country, docType, number, salt) instead, and the only
//              question about it is "is it this document?" (not a range or a list).
// What gets published for a question is its rule (a few bytes), never the expanded list.

import { checkDocNumber } from './identity';

export const FIELD_TYPES = ['text', 'number', 'date', 'list', 'identity'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type CredentialField = {
  fieldId: string;
  label: string;
  type?: FieldType; // absent on fields created before types existed = text
  min?: number; // number fields
  max?: number;
  options?: string[]; // list fields
  country?: string; // identity fields: ISO alpha-3, fixed by the organizer
  docType?: string; // identity fields: national_id, passport…
};

export function isIdentityField(field: Pick<CredentialField, 'type'> | null | undefined): boolean {
  return fieldType(field) === 'identity';
}

export const MAX_SET_SIZE = 2 ** 16;
const MAX_VALUE_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;
const INTEGER = /^-?(0|[1-9]\d*)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function fieldType(field: Pick<CredentialField, 'type'> | null | undefined): FieldType {
  return field?.type && (FIELD_TYPES as readonly string[]).includes(field.type) ? field.type : 'text';
}

// ── Values ────────────────────────────────────────────────────────────────────

export function dateToDay(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

export function dayToDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// The canonical text of a value for this field, or an error message. Empty input is allowed (a
// credential can leave a field blank) and returns ''.
export function canonicalValue(field: CredentialField, raw: string): { value: string } | { error: string } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { value: '' };
  switch (fieldType(field)) {
    case 'number': {
      if (!/^[+-]?\d+$/.test(trimmed)) return { error: 'Must be a whole number.' };
      const n = Number(trimmed);
      if (!Number.isSafeInteger(n)) return { error: 'Number is too large.' };
      if (field.min !== undefined && n < field.min) return { error: `Must be at least ${field.min}.` };
      if (field.max !== undefined && n > field.max) return { error: `Must be at most ${field.max}.` };
      return { value: String(n) };
    }
    case 'date':
      return isValidDate(trimmed) ? { value: trimmed } : { error: 'Must be a date (YYYY-MM-DD).' };
    case 'list':
      return (field.options || []).includes(trimmed) ? { value: trimmed } : { error: 'Pick one of the options.' };
    case 'identity':
      return checkDocNumber(trimmed);
    default:
      return new TextEncoder().encode(trimmed).length <= MAX_VALUE_BYTES
        ? { value: trimmed }
        : { error: `At most ${MAX_VALUE_BYTES} bytes.` };
  }
}

// ── Questions (rules) ─────────────────────────────────────────────────────────

export type Rule =
  | { op: 'oneOf'; values: string[] }
  // "Is it this document?" — the set holds one salted identity value (identity.ts) that only the
  // asker and the holder can compute, so nothing about it is published but the kind of question.
  | { op: 'identity' }
  | { op: 'gte' | 'lte' | 'between'; type: 'number'; min: number; max: number }
  | { op: 'onOrAfter' | 'onOrBefore' | 'between'; type: 'date'; from: string; to: string; preset?: ValidityPreset };

// Plain-language questions about a credential's "Valid until" date (validity.ts), for verifiers:
// "is it still valid?", "has it expired?", "does it expire within 6 months?", "is it valid for at
// least a year?". Each is an ordinary date range anchored on the day it was asked (asOf); the preset
// only says how to word it. parseRule accepts a preset only if it rebuilds exactly that range, so a
// rule posted by someone else can't wear a misleading description.
export const VALIDITY_PRESETS = ['valid', 'expired', 'expiresWithin', 'validFor'] as const;
export type ValidityPresetKind = (typeof VALIDITY_PRESETS)[number];
export type ValidityPreset = { kind: ValidityPresetKind; asOf: string; months?: number };
// Choices offered for "expires within" / "valid for at least".
export const VALIDITY_PERIOD_MONTHS = [3, 6, 12, 24] as const;
// How far a "still valid" range reaches ahead, and an "expired" one back.
const VALIDITY_SPAN_YEARS = 30;

export function ruleSize(rule: Rule): number {
  if (rule.op === 'identity') return 1;
  if (rule.op === 'oneOf') return rule.values.length;
  if (rule.type === 'number') return rule.max - rule.min + 1;
  return dateToDay(rule.to) - dateToDay(rule.from) + 1;
}

// Why a rule can't be published, or null. Checked before expanding anything.
export function ruleError(rule: Rule): string | null {
  if (rule.op === 'identity') return null;
  if (rule.op === 'oneOf') {
    if (rule.values.length === 0) return 'Add at least one accepted value.';
    if (new Set(rule.values).size !== rule.values.length) return 'Each accepted value must appear once.';
    return null;
  }
  if (rule.type === 'number') {
    if (!Number.isSafeInteger(rule.min) || !Number.isSafeInteger(rule.max)) return 'Enter whole numbers.';
  } else if (!isValidDate(rule.from) || !isValidDate(rule.to)) {
    return 'Enter valid dates.';
  }
  const size = ruleSize(rule);
  if (size < 1) return 'The range is empty: its start is after its end.';
  if (size > MAX_SET_SIZE) return `The range covers ${size.toLocaleString()} values; the limit is ${MAX_SET_SIZE.toLocaleString()}.`;
  return null;
}

// Every value the rule accepts, in canonical text, in a fixed order — publisher and holder must
// build the exact same set tree from it.
export function expandRule(rule: Rule): string[] {
  const error = ruleError(rule);
  if (error) throw new Error(error);
  if (rule.op === 'identity') throw new Error('An identity question has no public values to expand.');
  if (rule.op === 'oneOf') return [...rule.values];
  const out: string[] = [];
  if (rule.type === 'number') {
    for (let n = rule.min; n <= rule.max; n++) out.push(String(n));
  } else {
    for (let day = dateToDay(rule.from), last = dateToDay(rule.to); day <= last; day++) out.push(dayToDate(day));
  }
  return out;
}

// Local check, no set needed: does this canonical value satisfy the rule?
export function ruleAccepts(rule: Rule, value: string): boolean {
  if (rule.op === 'identity') return false; // checked against the set root instead (holder-proofs.ts)
  if (rule.op === 'oneOf') return rule.values.includes(value);
  if (rule.type === 'number') {
    if (!INTEGER.test(value)) return false;
    const n = Number(value);
    return n >= rule.min && n <= rule.max;
  }
  if (!isValidDate(value)) return false;
  return value >= rule.from && value <= rule.to;
}

const formatDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

// The question in words, as the holder and the verifier see it.
export function describeRule(label: string, rule: Rule): string {
  if (rule.op !== 'identity' && rule.op !== 'oneOf' && rule.type === 'date' && rule.preset) {
    return describeValidityPreset(rule.preset);
  }
  switch (rule.op) {
    case 'identity':
      return `${label} matches the document checked`;
    case 'oneOf':
      return `${label} is one of: ${rule.values.join(', ')}`;
    case 'gte':
      return `${label} ≥ ${rule.min}`;
    case 'lte':
      return `${label} ≤ ${rule.max}`;
    case 'onOrAfter':
      return `${label} on or after ${formatDate(rule.from)}`;
    case 'onOrBefore':
      return `${label} on or before ${formatDate(rule.to)}`;
    default:
      return rule.type === 'number'
        ? `${label} between ${rule.min} and ${rule.max}`
        : `${label} between ${formatDate(rule.from)} and ${formatDate(rule.to)}`;
  }
}

// A rule read back from the server (anyone can post one), or null if it isn't well-formed.
export function parseRule(raw: unknown): Rule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  let rule: Rule | null = null;
  if (r.op === 'identity') {
    rule = { op: 'identity' };
  } else if (r.op === 'oneOf' && Array.isArray(r.values) && r.values.every((v) => typeof v === 'string')) {
    rule = { op: 'oneOf', values: r.values as string[] };
  } else if (r.type === 'number' && (r.op === 'gte' || r.op === 'lte' || r.op === 'between')) {
    rule = { op: r.op, type: 'number', min: Number(r.min), max: Number(r.max) };
  } else if (r.type === 'date' && (r.op === 'onOrAfter' || r.op === 'onOrBefore' || r.op === 'between')) {
    rule = { op: r.op, type: 'date', from: String(r.from), to: String(r.to) };
    const preset = parsePreset(r.preset);
    if (preset) {
      const expected = validityPresetRule(preset.kind, preset.asOf, preset.months);
      if (expected.op === rule.op && expected.from === rule.from && expected.to === rule.to) rule = expected;
    }
  }
  return rule && !ruleError(rule) ? rule : null;
}

// ── Open-ended ranges ─────────────────────────────────────────────────────────
// "≥ 18" still needs an upper end to become a finite set. The field's own min/max are used when
// set; otherwise these defaults, which the asker can change.

export const DEFAULT_NUMBER_SPAN = 200;
// "on or before D" (e.g. born before) reaches this far back; "on or after D" (e.g. valid until)
// this far ahead. ~36,500 and ~11,000 days: a few seconds to build either set.
export const DATE_SPAN_BEFORE_YEARS = 100;
export const DATE_SPAN_AFTER_YEARS = 30;

export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y + years, m - 1, d));
  // 29 Feb + N years on a non-leap year rolls to 1 Mar; step back to 28 Feb instead.
  if (date.getUTCMonth() !== m - 1) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return dayToDate(dateToDay(iso) + days);
}

// Calendar months; the 31st rolls back to the month's last day (31 Jan + 1 month = 28/29 Feb).
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

// ── "Valid until" questions ───────────────────────────────────────────────────

// The date range behind each plain-language question, asked on `asOf` (a "Valid until" day is the
// last day the credential is valid):
//   valid         — valid until ≥ asOf
//   expired       — valid until < asOf
//   expiresWithin — still valid, and valid until ≤ asOf + N months
//   validFor      — valid until ≥ asOf + N months
export function validityPresetRule(kind: ValidityPresetKind, asOf: string, months = 6): Rule {
  const preset: ValidityPreset = kind === 'expiresWithin' || kind === 'validFor' ? { kind, asOf, months } : { kind, asOf };
  const farAhead = addYears(asOf, VALIDITY_SPAN_YEARS);
  switch (kind) {
    case 'valid':
      return { op: 'onOrAfter', type: 'date', from: asOf, to: farAhead, preset };
    case 'expired':
      return { op: 'onOrBefore', type: 'date', from: addYears(asOf, -VALIDITY_SPAN_YEARS), to: addDays(asOf, -1), preset };
    case 'expiresWithin':
      return { op: 'between', type: 'date', from: asOf, to: addMonths(asOf, months), preset };
    default:
      return { op: 'onOrAfter', type: 'date', from: addMonths(asOf, months), to: farAhead, preset };
  }
}

export function describePeriod(months: number): string {
  if (months % 12 === 0) return months === 12 ? '1 year' : `${months / 12} years`;
  return months === 1 ? '1 month' : `${months} months`;
}

export function describeValidityPreset(preset: ValidityPreset): string {
  const on = formatDate(preset.asOf);
  switch (preset.kind) {
    case 'valid':
      return `Still valid (checked on ${on})`;
    case 'expired':
      return `Expired (checked on ${on})`;
    case 'expiresWithin':
      return `Still valid, but expires within ${describePeriod(preset.months ?? 6)} (checked on ${on})`;
    default:
      return `Valid for at least ${describePeriod(preset.months ?? 6)} more (checked on ${on})`;
  }
}

function parsePreset(raw: unknown): ValidityPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!(VALIDITY_PRESETS as readonly string[]).includes(p.kind as string)) return null;
  if (typeof p.asOf !== 'string' || !isValidDate(p.asOf)) return null;
  const kind = p.kind as ValidityPresetKind;
  if (kind === 'expiresWithin' || kind === 'validFor') {
    const months = Number(p.months);
    if (!Number.isSafeInteger(months) || months < 1 || months > 120) return null;
    return { kind, asOf: p.asOf, months };
  }
  return { kind, asOf: p.asOf };
}
