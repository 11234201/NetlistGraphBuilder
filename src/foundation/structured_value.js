export function areStructuredValuesEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => areStructuredValuesEqual(value, right[index]));
  }
  if (left instanceof Map || right instanceof Map) {
    if (!(left instanceof Map) || !(right instanceof Map) || left.size !== right.size) return false;
    for (const [key, value] of left) {
      if (!right.has(key) || !areStructuredValuesEqual(value, right.get(key))) return false;
    }
    return true;
  }
  if (left instanceof Set || right instanceof Set) {
    if (!(left instanceof Set) || !(right instanceof Set) || left.size !== right.size) return false;
    return [...left].every((value) => right.has(value));
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) =>
    Object.hasOwn(right, key) && areStructuredValuesEqual(left[key], right[key]));
}

export function hasProjectedValueChange(current, projection) {
  return Object.entries(projection || {}).some(([key, value]) =>
    !areStructuredValuesEqual(current?.[key], value));
}
