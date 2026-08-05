export const ISOLATED_UI_EVENT_TYPES = Object.freeze([
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'change',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'focusin',
  'focusout',
  'paste',
  'copy',
  'cut'
]);

export function isolateUiInputEvents(root) {
  const contain = (event) => event.stopPropagation();
  for (const type of ISOLATED_UI_EVENT_TYPES) root.addEventListener(type, contain);
}
