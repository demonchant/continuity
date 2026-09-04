import type { JsonObject, JsonValue } from '../../missions/mission.js';

export interface OfferingInputCompatibility {
  readonly compatible: boolean;
  readonly validated: boolean;
  readonly reasons: readonly string[];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function schemaObject(
  value: Record<string, unknown> | string,
): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return value;
  try {
    return object(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validate(schema: Record<string, unknown>, value: JsonValue, path: string): string[] {
  const errors: string[] = [];
  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => sameValue(allowed, value))) {
    errors.push(`${path} is not one of the offering's allowed values`);
    return errors;
  }
  if ('const' in schema && !sameValue(schema.const, value)) {
    errors.push(`${path} does not equal the offering's required value`);
    return errors;
  }

  const declaredTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  const types = declaredTypes.filter((type): type is string => typeof type === 'string');
  const permits = (type: string) => types.length === 0 || types.includes(type);

  if (value === null) {
    if (!permits('null')) errors.push(`${path} must not be null`);
    return errors;
  }
  if (Array.isArray(value)) {
    if (!permits('array')) return [`${path} must be an array`];
    if (typeof schema.minItems === 'number' && value.length < schema.minItems)
      errors.push(`${path} has fewer items than the offering permits`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems)
      errors.push(`${path} has more items than the offering permits`);
    const itemSchema = object(schema.items);
    if (itemSchema)
      value.forEach((item, index) =>
        errors.push(...validate(itemSchema, item, `${path}[${index}]`)),
      );
    return errors;
  }
  if (typeof value === 'object') {
    if (!permits('object')) return [`${path} must be an object`];
    const required = Array.isArray(schema.required)
      ? schema.required.filter((field): field is string => typeof field === 'string')
      : [];
    for (const field of required) {
      if (!(field in value)) errors.push(`${path}.${field} is required by the offering`);
    }
    const properties = object(schema.properties) ?? {};
    for (const [field, fieldValue] of Object.entries(value)) {
      const propertySchema = object(properties[field]);
      if (propertySchema) errors.push(...validate(propertySchema, fieldValue, `${path}.${field}`));
      else if (schema.additionalProperties === false)
        errors.push(`${path}.${field} is not accepted by the offering`);
      else {
        const additionalSchema = object(schema.additionalProperties);
        if (additionalSchema)
          errors.push(...validate(additionalSchema, fieldValue, `${path}.${field}`));
      }
    }
    return errors;
  }
  if (typeof value === 'string') {
    if (!permits('string')) return [`${path} must be a string`];
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      errors.push(`${path} is shorter than the offering permits`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      errors.push(`${path} is longer than the offering permits`);
    return errors;
  }
  if (typeof value === 'boolean') {
    if (!permits('boolean')) errors.push(`${path} must be a boolean`);
    return errors;
  }
  if (typeof value === 'number') {
    const numericType = Number.isInteger(value) ? ['number', 'integer'] : ['number'];
    if (types.length > 0 && !numericType.some((type) => types.includes(type)))
      return [`${path} must be ${types.join(' or ')}`];
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      errors.push(`${path} is below the offering minimum`);
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      errors.push(`${path} is above the offering maximum`);
  }
  return errors;
}

/** Validates provider input when an offering publishes a machine-readable JSON Schema. */
export function analyzeOfferingInputCompatibility(
  offeringRequirements: Record<string, unknown> | string,
  providerInput: JsonObject,
): OfferingInputCompatibility {
  const schema = schemaObject(offeringRequirements);
  const machineReadable =
    schema !== undefined &&
    ['type', 'properties', 'required', 'enum', 'const'].some((keyword) => keyword in schema);
  if (!machineReadable) {
    return {
      compatible: true,
      validated: false,
      reasons: ['Offering requirements are not a machine-readable JSON Schema.'],
    };
  }
  const errors = validate(schema, providerInput, '$');
  return {
    compatible: errors.length === 0,
    validated: true,
    reasons:
      errors.length === 0
        ? ['Mission provider input satisfies the offering requirements schema.']
        : errors,
  };
}
