import { ZodFirstPartyTypeKind, type ZodRawShape, type ZodTypeAny } from 'zod';

/**
 * TypeScript text for the Zod v3 types the connector uses, so code mode can show signatures
 * instead of JSON Schema. Unknown types print as `unknown`; it never throws.
 */
export function zodToTs(schema: ZodTypeAny, indent = ''): string {
  const def = schema._def as { typeName?: ZodFirstPartyTypeKind } & Record<string, unknown>;
  switch (def.typeName) {
    case ZodFirstPartyTypeKind.ZodString:
      return 'string';
    case ZodFirstPartyTypeKind.ZodNumber:
      return 'number';
    case ZodFirstPartyTypeKind.ZodBoolean:
      return 'boolean';
    case ZodFirstPartyTypeKind.ZodNull:
      return 'null';
    case ZodFirstPartyTypeKind.ZodLiteral:
      return JSON.stringify(def.value);
    case ZodFirstPartyTypeKind.ZodEnum:
      return (def.values as string[]).map((value) => JSON.stringify(value)).join(' | ');
    case ZodFirstPartyTypeKind.ZodOptional:
    case ZodFirstPartyTypeKind.ZodDefault:
      return zodToTs(def.innerType as ZodTypeAny, indent);
    case ZodFirstPartyTypeKind.ZodEffects:
      return zodToTs(def.schema as ZodTypeAny, indent);
    case ZodFirstPartyTypeKind.ZodNullable:
      return `${zodToTs(def.innerType as ZodTypeAny, indent)} | null`;
    case ZodFirstPartyTypeKind.ZodArray: {
      const item = zodToTs(def.type as ZodTypeAny, indent);
      return /[|&]/.test(item) && !item.startsWith('{') ? `(${item})[]` : `${item}[]`;
    }
    case ZodFirstPartyTypeKind.ZodRecord:
      return `Record<string, ${zodToTs(def.valueType as ZodTypeAny, indent)}>`;
    case ZodFirstPartyTypeKind.ZodUnion:
      return (def.options as ZodTypeAny[]).map((option) => zodToTs(option, indent)).join(' | ');
    case ZodFirstPartyTypeKind.ZodObject:
      return shapeToTs((def.shape as () => ZodRawShape)(), indent);
    default:
      return 'unknown';
  }
}

/** Optional and defaulted fields are optional for the caller. */
export function shapeToTs(shape: ZodRawShape, indent = ''): string {
  const entries = Object.entries(shape);
  if (!entries.length) return '{}';
  const inner = `${indent}  `;
  const fields = entries.map(([key, value]) => {
    const optional = value.isOptional() ? '?' : '';
    return `${inner}${key}${optional}: ${zodToTs(value, inner)};`;
  });
  return `{\n${fields.join('\n')}\n${indent}}`;
}
