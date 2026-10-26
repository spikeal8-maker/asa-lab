export type ImageGenerationMode = 'off' | 'auto' | 'flux2-klein-4b-v1';

/** Only an explicit creation request may consume a GPU operation in Auto mode. */
export function requestsImageCreation(text: string): boolean {
  return (
    /^\s*(?:я\s+)?(?:хочу|мне\s+нужн[ао])\s+(?:изображение|картинку|картинка|иллюстрацию|иллюстрация|фото|рисунок)(?=\s|[,.!?]|$)/iu.test(
      text,
    ) ||
    /^\s*(?:пожалуйста[,\s]+)?(?:нарисуй(?:те)?\s+\S|(?:создай(?:те)?|сгенерируй(?:те)?|сделай(?:те)?)\s+(?:(?:мне|нам|пожалуйста)\s+){0,3}(?:изображение|картинку|иллюстрацию|фото|рисунок)(?=\s|[,.!?]|$))/iu.test(
      text,
    ) ||
    /^\s*(?:please\s+)?(?:draw\s+\S|(?:create|generate|make)\s+(?:an?\s+)?(?:image|picture|illustration|photo)(?=\s|[,.!?]|$))/iu.test(
      text,
    )
  );
}
