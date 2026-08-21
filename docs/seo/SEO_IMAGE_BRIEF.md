# Отдельное ТЗ на SEO-изображения ASA Lab

Дата: 21 августа 2026 года
Назначение: сайт, Open Graph, поисковые превью и публичный GitHub

## 1. Что нужно сделать сейчас

### Обязательный минимум

| № | Файл | Размер | Где используется |
| --- | --- | --- | --- |
| 1 | `apps/web/public/social/asa-lab-og.png` | 1200 × 630 | Главная карточка сайта, GitHub, мессенджеры |
| 2 | `apps/web/public/media/seo/asa-lab-hero.webp` | 1600 × 1000 | Главная продуктовая страница |
| 3 | `apps/web/public/social/asa-lab-for-teachers.png` | 1200 × 630 | Страница для преподавателей и школ |

Без первого файла нельзя завершить качественный social preview. Второй и третий сильно улучшают объяснение продукта, но не блокируют базовую индексацию.

### Полная серия направлений

| № | Файл | Размер | Alt-текст |
| --- | --- | --- | --- |
| 4 | `social/asa-lab-block-programming.png` | 1200 × 630 | Блочное программирование для школьных проектов в ASA Lab |
| 5 | `social/asa-lab-drawing.png` | 1200 × 630 | Рисование и визуальные проекты в ASA Lab |
| 6 | `social/asa-lab-3d-modeling.png` | 1200 × 630 | 3D-моделирование для школьников в ASA Lab |
| 7 | `social/asa-lab-electronics.png` | 1200 × 630 | Виртуальная электроника и учебные схемы в ASA Lab |
| 8 | `social/asa-lab-chess-checkers.png` | 1200 × 630 | Шахматы и русские шашки в ASA Lab |

Для электроники, 3D и шахмат приоритетнее использовать чистые реальные скриншоты продукта, если они выглядят достаточно хорошо. Генерировать следует композиционный фон или иллюстрацию, а не выдуманный интерфейс.

## 2. Единая арт-система

### Палитра

- тёмно-синий: `#0B3558`;
- бирюзовый: `#0AA4C8`;
- тёплый акцент: `#F2A51A`;
- светлый фон: `#F7FAFC`;
- основной текст: `#17212D`.

### Визуальный характер

- современная образовательная редакционная иллюстрация;
- спокойная, профессиональная, без «детсадовской» мультяшности;
- геометрические формы и лёгкая изометрическая глубина;
- понятные предметные символы без сторонних логотипов;
- достаточно свободного места для фирменной надписи;
- интерфейсные элементы крупные и правдоподобные, но без мелкого псевдотекста;
- одинаковое освещение, толщина линий и насыщенность во всей серии.

### Нельзя

- генерировать новый логотип или изменять существующий знак ASA Lab;
- использовать логотипы Scratch, Tinkercad, Arduino, Figma и других продуктов;
- показывать читаемые персональные данные, имена детей или фотографии реальных учеников;
- использовать фотореалистичные лица как основную иллюстрацию продукта;
- вставлять мелкий сгенерированный текст;
- изображать опасное сетевое напряжение в учебной электронике;
- выдавать выдуманный интерфейс за реальный скриншот ASA Lab;
- добавлять watermark, подпись генератора или stock-photo маркировку.

## 3. Главная Open Graph карточка

Файл: `apps/web/public/social/asa-lab-og.png`
Размер: 1200 × 630 px
Формат: PNG, sRGB
Безопасная зона: 80 px по краям
Alt: `ASA Lab — цифровая STEM-лаборатория для школы`

### Промпт для генерации фона

> Wide 1200x630 editorial key visual for ASA Lab, a modern school STEM learning platform. One connected digital laboratory with six clear zones: visual block programming, digital drawing, a simple 3D model, a safe low-voltage electronic circuit, chess and Russian checkers. Professional for teachers, engaging for students, cohesive geometric composition, subtle isometric depth, dark navy #0B3558, cyan #0AA4C8, warm amber #F2A51A, off-white #F7FAFC background, high contrast, crisp vector-like shapes. Leave a clean quiet area on the left half for a real brand wordmark and short headline to be added later. No text, no letters, no logos, no people, no watermark, no device mockup, no third-party branding.

### Финальная сборка после генерации

1. Не просить генератор писать `ASA Lab`.
2. Наложить существующий фирменный знак/wordmark из репозитория отдельным слоем.
3. Добавить текст вручную:

   ```text
   ASA Lab
   Цифровая STEM-лаборатория для школы
   ```

4. Проверить читаемость при уменьшении до 600 × 315.
5. Не помещать текст ближе 80 px к краям.

## 4. Главная hero-иллюстрация

Файл: `apps/web/public/media/seo/asa-lab-hero.webp`
Размер: 1600 × 1000 px
Формат: WebP, quality 82–88, sRGB
Alt: `Учебные среды ASA Lab для программирования, рисования, 3D и электроники`

### Промпт

> Isometric educational workspace illustration for ASA Lab. A single connected canvas contains six clearly separated learning stations: colorful interlocking code blocks controlling a small geometric rover, a digital drawing canvas with bold brush strokes, a simple assembled 3D object made of primitives, a safe low-voltage breadboard circuit with LED and resistor, a chess analysis position, and Russian checkers. Clean Russian edtech aesthetic, age-neutral, serious enough for a school principal and inviting for students, navy #0B3558, cyan #0AA4C8, amber #F2A51A, off-white background, soft shadows, coherent scale, no readable UI text, no logos, no faces, no watermark, 16:10 composition, generous breathing room.

## 5. Карточка для преподавателей и школ

Файл: `apps/web/public/social/asa-lab-for-teachers.png`
Размер: 1200 × 630 px
Alt: `ASA Lab для учителей — классы, задания и проекты учеников`

### Промпт

> Wide editorial illustration for a teacher using ASA Lab in a school project lesson. Show a calm teacher workspace with an abstract class overview: several anonymous project cards, assignment progress, version history and feedback markers, connected to student work in block coding, drawing, 3D and electronics. No student names, no grades leaderboard, no chat, no personal data. Professional educational product visual, clean geometric style, navy #0B3558, cyan #0AA4C8, amber #F2A51A, off-white background, clear hierarchy, leave the left third quiet for real text added later, no readable generated text, no logos, no photorealistic faces, no watermark, 1200x630.

Ручной текст поверх готового фона:

```text
ASA Lab для преподавателей
Классы, задания и видимый путь решения
```

## 6. Карточки направлений

Все карточки: 1200 × 630 px, PNG, sRGB. Композиция должна оставлять свободную левую треть для ручного заголовка. Цвет, свет, перспектива и плотность деталей должны совпадать.

### Блочное программирование

> A visual programming learning scene: large interlocking code blocks form a clear algorithm with sequence, condition and loop, controlling a small geometric rover through a simple grid challenge. Emphasize cause and effect, debugging and school project learning. Same ASA Lab visual system, navy #0B3558, cyan #0AA4C8, amber #F2A51A, off-white background, crisp geometric editorial illustration, leave the left third quiet, no readable text, no logos, no characters, no watermark.

Ручной заголовок: `Блочное программирование`
Подзаголовок: `Алгоритмы через действие`

### Рисование

> A digital art learning scene with one clean canvas, layered abstract geometric shapes, expressive brush strokes, color swatches and transformation handles. Show composition, color and iteration as a school project, not a professional design brand interface. Same ASA Lab visual system, navy #0B3558, cyan #0AA4C8, amber #F2A51A, off-white background, crisp geometric editorial illustration, leave the left third quiet, no readable text, no logos, no characters, no watermark.

Ручной заголовок: `Рисование и визуальные проекты`
Подзаголовок: `Форма, цвет и собственная идея`

### 3D-моделирование

> A school 3D modelling scene: a simple useful object assembled from cube, cylinder and sphere primitives, with subtle orbit guides, axis hints and measurement markers. Emphasize spatial reasoning and construction from basic forms. Same ASA Lab visual system, navy #0B3558, cyan #0AA4C8, amber #F2A51A, off-white background, crisp geometric editorial illustration, leave the left third quiet, no readable text, no logos, no characters, no watermark.

Ручной заголовок: `3D-моделирование`
Подзаголовок: `От формы к пространственному проекту`

### Виртуальная электроника

> A safe low-voltage virtual electronics learning scene with a breadboard, battery pack, LED, resistor, push button and clean color-coded wires. The circuit is understandable and physically plausible, with subtle diagnostic glow but no dangerous mains electricity. Same ASA Lab visual system, navy #0B3558, cyan #0AA4C8, amber #F2A51A, off-white background, crisp geometric editorial illustration, leave the left third quiet, no readable text, no third-party hardware logos, no characters, no watermark.

Ручной заголовок: `Виртуальная электроника`
Подзаголовок: `Собрать, проверить, объяснить`

### Шахматы и русские шашки

> A balanced educational strategy scene combining a clear chess position and a Russian checkers position as two related analysis boards. Show move paths, alternatives and reflection without competitive spectacle. Same ASA Lab visual system, navy #0B3558, cyan #0AA4C8, amber #F2A51A, off-white background, crisp geometric editorial illustration, leave the left third quiet, no readable text, no logos, no characters, no watermark.

Ручной заголовок: `Шахматы и русские шашки`
Подзаголовок: `Стратегия, варианты и разбор решения`

## 7. Техническая приёмка файлов

Для каждого изображения:

- точные пиксельные размеры;
- цветовой профиль sRGB;
- без EXIF/GPS и персональных metadata;
- резкость текста проверяется после ручной сборки;
- PNG для social cards желательно до 600–800 KB;
- WebP hero желательно до 250–350 KB;
- контраст ручного текста не ниже 4.5:1;
- важные элементы не находятся у самых краёв;
- файл открывается без ошибки и отдаётся с корректным MIME;
- визуальный смысл совпадает с текстом страницы;
- alt описывает содержание и функцию, а не начинается словами «картинка» или «изображение».

## 8. Как подключить после готовности

На каждой странице добавить:

```html
<meta property="og:image" content="https://asa-lab.ru/social/asa-lab-og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:alt" content="ASA Lab — цифровая STEM-лаборатория для школы" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://asa-lab.ru/social/asa-lab-og.png" />
```

Для feature-страниц заменить URL и alt на собственную карточку. После деплоя проверить прямой URL каждого файла и карточки в инструментах предпросмотра социальных сетей.

## 9. Порядок производства

1. Сгенерировать 3–4 варианта общего OG-фона по одному промпту.
2. Выбрать композицию, которая читается в маленьком размере.
3. Зафиксировать этот вариант как style reference для всей серии.
4. Сгенерировать hero и teacher card в том же стиле.
5. Сгенерировать пять feature backgrounds с тем же reference.
6. Наложить реальный wordmark и русский текст вручную.
7. Экспортировать, оптимизировать и передать все файлы одним пакетом.
8. Подключить метатеги и пройти автоматическую проверку существования изображений.

Если времени хватает только на один файл, первым делается `asa-lab-og.png`.
