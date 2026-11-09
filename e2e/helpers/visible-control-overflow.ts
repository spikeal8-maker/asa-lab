/** Browser-side observer: display:none controls have no layout box. */
export function visibleControlOverflow(controls: Element[]): boolean {
  return controls.some((control) => {
    if (control.getClientRects().length === 0) return false;
    const box = control.getBoundingClientRect();
    const panel = control.closest('.workbench-inspector')?.getBoundingClientRect();
    if (!panel) throw new Error('Inspector control has no panel');
    return box.left < panel.left - 1 || box.right > panel.right + 1;
  });
}
