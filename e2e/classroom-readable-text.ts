import type { Page } from '@playwright/test';
export async function classroomTextDefects(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const defects: string[] = [];
    const roots = [
      ...document.querySelectorAll<HTMLElement>(
        '.classroom-list-row, .classroom-metrics, .notification-setting-row',
      ),
    ];
    for (const root of roots) {
      if (!root.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
      const boxes: Array<{ node: Node; text: string; rect: DOMRect }> = [];
      const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walk.nextNode())) {
        const el = node.parentElement;
        if (
          !el ||
          !node.textContent?.trim() ||
          el.closest('.sr-only,.dropdown-menu') ||
          !el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })
        )
          continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects())
          if (rect.width > 0 && rect.height > 0)
            boxes.push({ node, text: node.textContent.trim(), rect });
      }
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!,
            b = boxes[j]!;
          if (a.node === b.node) continue;
          if (
            Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) > 1 &&
            Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) > 1
          )
            defects.push(root.className + ': ' + a.text + ' overlaps ' + b.text);
        }
      if (root.matches('.classroom-list-row')) {
        for (const cell of root.querySelectorAll<HTMLElement>(':scope > span[data-label]')) {
          const label = cell.querySelector<HTMLElement>('.classroom-stat-label');
          if (!label) defects.push('Missing actual label: ' + cell.dataset['label']);
          const before = getComputedStyle(cell, '::before').content;
          if (before && before !== 'none' && before !== 'normal' && before !== '""')
            defects.push('Unmeasured pseudo label: ' + cell.dataset['label']);
          for (const text of cell.querySelectorAll<HTMLElement>(
            '.classroom-stat-label,.classroom-stat-number',
          )) {
            if (!text.checkVisibility()) continue;
            const r = document.createRange();
            r.selectNodeContents(text);
            const box = r.getBoundingClientRect(),
              owner = cell.getBoundingClientRect();
            if (box.left < owner.left - 1 || box.right > owner.right + 1)
              defects.push('Text exceeds stat cell: ' + text.textContent);
          }
        }
      }
      if (root.matches('.notification-setting-row')) {
        const input = root.querySelector<HTMLElement>('input[type="checkbox"]');
        if (input && input.checkVisibility())
          for (const box of boxes) {
            const r = input.getBoundingClientRect();
            if (
              Math.min(r.right, box.rect.right) - Math.max(r.left, box.rect.left) > 1 &&
              Math.min(r.bottom, box.rect.bottom) - Math.max(r.top, box.rect.top) > 1
            )
              defects.push('Checkbox covers ' + box.text);
          }
      }
    }
    for (const column of document.querySelectorAll<HTMLElement>(
      '.manual-journal thead th:not(:first-child)',
    )) {
      if (column.checkVisibility() && column.getBoundingClientRect().width < 128)
        defects.push('Unreadably narrow journal heading');
    }
    return defects;
  });
}
