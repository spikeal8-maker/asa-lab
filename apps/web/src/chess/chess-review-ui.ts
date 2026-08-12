export function chessReviewDisplayFen(
  finalFen: string,
  selectedFenAfter: string | null,
  retryFen: string | null,
): string {
  return retryFen ?? selectedFenAfter ?? finalFen;
}
