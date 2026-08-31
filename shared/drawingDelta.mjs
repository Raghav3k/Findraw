const equal = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
};

// A splice handles append, undo, redo, clear and changes in the middle of a list.
export function drawingDelta(before, after) {
  let index = 0;
  while (index < before.length && index < after.length && equal(before[index], after[index])) index++;
  let suffix = 0;
  while (suffix < before.length - index && suffix < after.length - index && equal(before[before.length - 1 - suffix], after[after.length - 1 - suffix])) suffix++;
  return { index, deleteCount: before.length - index - suffix, operations: after.slice(index, after.length - suffix) };
}

export function applyDrawingDelta(before, delta) {
  if (!delta || !Number.isSafeInteger(delta.index) || !Number.isSafeInteger(delta.deleteCount) ||
      delta.index < 0 || delta.index > before.length || delta.deleteCount < 0 ||
      delta.deleteCount > before.length - delta.index || !Array.isArray(delta.operations)) {
    throw new Error("Invalid drawing delta.");
  }
  return [...before.slice(0, delta.index), ...delta.operations, ...before.slice(delta.index + delta.deleteCount)];
}
