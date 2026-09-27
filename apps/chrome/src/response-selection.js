export function responseSelectionInteractionProtected({
  pointerInteraction = false,
  focusInside = false
} = {}) {
  return Boolean(pointerInteraction || focusInside);
}
