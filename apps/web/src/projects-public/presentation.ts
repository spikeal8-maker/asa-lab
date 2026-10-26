export const PUBLIC_PROJECT_MODULES = [
  { value: 'three-d', label: '3D-моделирование' },
  { value: 'electronics', label: 'Электроника' },
  { value: 'blocks', label: 'Блочное программирование' },
] as const;

export function publicModuleName(key: string): string {
  return PUBLIC_PROJECT_MODULES.find((entry) => entry.value === key)?.label ?? key;
}

export const PUBLIC_PROJECT_LICENSES = [
  {
    value: 'reserved',
    label: 'Все права сохранены',
    hint: 'Использование требует разрешения автора.',
  },
  {
    value: 'public-domain',
    label: 'Общественное достояние',
    hint: 'Можно свободно использовать и изменять работу.',
  },
  {
    value: 'cc-by',
    label: 'CC BY — с указанием автора',
    hint: 'При использовании и переработке нужно указать автора.',
  },
  {
    value: 'cc-by-sa',
    label: 'CC BY-SA — на тех же условиях',
    hint: 'Нужно указать автора и сохранить лицензию в переработке.',
  },
  {
    value: 'cc-by-nc',
    label: 'CC BY-NC — без коммерческого использования',
    hint: 'Можно использовать с указанием автора в некоммерческих целях.',
  },
] as const;

export function publicationHref(publicationId: string): string {
  return `/#/public-projects/${encodeURIComponent(publicationId)}`;
}

export function publicationUrl(publicationId: string, location: string): string {
  return new URL(publicationHref(publicationId), location).href;
}
