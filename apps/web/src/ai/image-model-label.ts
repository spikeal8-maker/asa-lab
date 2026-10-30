import type { AiImageRecipe } from '@asa-lab/contracts';

/** Labels describe the immutable recipe saved with the job, not today's admin selection. */
export function imageModelLabel(recipe: AiImageRecipe | undefined): string {
  if (recipe === 'flux2-klein-4b-fp8-izo-v1') return 'FLUX.2 Klein 4B · FP8';
  if (recipe === 'flux2-klein-4b-v1') return 'FLUX.2 Klein 4B';
  return 'Модель не указана';
}
