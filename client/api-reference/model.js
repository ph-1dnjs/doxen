export const METHODS = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];

export function resolve(spec, value, seen = new Set()) {
  if (!value?.$ref || !value.$ref.startsWith("#/")) return value || {};
  if (seen.has(value.$ref)) return { type: "object", title: "순환 참조" };
  const ref = value.$ref;
  const target = ref.slice(2).split("/").reduce((item, key) => item?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], spec);
  if (!target) return { ...value, title: `참조를 찾을 수 없음: ${ref}` };
  return { ...resolve(spec, target, new Set([...seen, ref])), ...Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref")) };
}

export function operations(spec) {
  return Object.entries(spec.paths).flatMap(([path, rawItem]) => {
    const item = resolve(spec, rawItem);
    return METHODS.filter((method) => item[method]).map((method) => {
      const operation = resolve(spec, item[method]);
      return { ...operation, path, method, key: `${method.toUpperCase()} ${path}`, group: operation.tags?.[0] || "기타 API", item };
    });
  });
}

export function parameters(spec, op) {
  const merged = new Map();
  for (const raw of [...(op.item.parameters || []), ...(op.parameters || [])]) {
    const parameter = resolve(spec, raw);
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  }
  return [...merged.values()];
}

export function schema(spec, raw, depth = 0) {
  const value = resolve(spec, raw);
  if (!value.allOf || depth > 8) return value;
  const parts = value.allOf.map((part) => schema(spec, part, depth + 1));
  return { ...value, properties: Object.assign({}, ...parts.map((part) => part.properties), value.properties), required: [...new Set([...parts.flatMap((part) => part.required || []), ...(value.required || [])])] };
}

export function example(spec, raw, seen = new Set(), depth = 0, mode = "response") {
  if (!raw || depth > 8 || (raw.$ref && seen.has(raw.$ref))) return null;
  const next = new Set(seen);
  if (raw.$ref) next.add(raw.$ref);
  const value = schema(spec, raw);
  for (const key of ["example", "default", "const"]) if (value[key] !== undefined) return value[key];
  if (value.examples?.length) return value.examples[0];
  if (value.enum?.length) return value.enum[0];
  if (value.oneOf || value.anyOf) return example(spec, (value.oneOf || value.anyOf)[0], next, depth + 1, mode);
  if (value.type === "array" || value.items) return [example(spec, value.items, next, depth + 1, mode)];
  if (value.type === "object" || value.properties) {
    return Object.fromEntries(Object.entries(value.properties || {}).filter(([, prop]) => !resolve(spec, prop)[mode === "request" ? "readOnly" : "writeOnly"]).map(([name, prop]) => [name, example(spec, prop, next, depth + 1, mode)]));
  }
  if (value.type === "boolean") return true;
  if (value.type === "integer" || value.type === "number") return value.minimum ?? 0;
  return ({ "date-time": "2026-01-01T00:00:00.000Z", date: "2026-01-01", uuid: "123e4567-e89b-12d3-a456-426614174000", email: "user@example.com", binary: "<파일>" })[value.format] || "text";
}

export function mediaExample(spec, media, mode = "response") {
  if (media.example !== undefined) return media.example;
  const first = Object.values(media.examples || {})[0];
  if (first) {
    const value = resolve(spec, first);
    if (value.value !== undefined) return value.value;
  }
  return example(spec, media.schema, new Set(), 0, mode);
}
