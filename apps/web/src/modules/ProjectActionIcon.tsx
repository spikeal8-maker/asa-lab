export function ProjectActionIcon({ label }: { readonly label: string }) {
  const paths: Record<string, string> = {
    Свойства: 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5',
    Публикация: 'M12 16V3m-4 4 4-4 4 4M5 13v7h14v-7',
    Дублировать: 'M8 8h12v12H8zM16 8V4H4v12h4',
    'Журнал версий': 'M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2',
    'Добавить в коллекцию': 'M3 7V4h6l2 3h10v13H3zM12 10v7m-3-3h6',
    Архивировать: 'M4 8h16v12H4zM3 3h18v5H3zm6 9h6',
    'В корзину': 'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',
    Восстановить: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
    'Отклик педагога': 'M3 4h18v13H9l-6 4zM7 8h10M7 12h7',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[label] ?? paths['Свойства']} />
    </svg>
  );
}
