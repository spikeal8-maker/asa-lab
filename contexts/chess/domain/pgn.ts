import {
  importChessPgn as importChessPgnBase,
  type ChessDocument,
  type ChessDocumentResult,
} from './document.js';

/**
 * Remove PGN line comments before the base tokenizer joins movetext lines.
 * Tag-pair lines are preserved verbatim so a semicolon inside a quoted header
 * remains data rather than being interpreted as a movetext comment.
 */
export function stripPgnLineComments(pgn: string): string {
  return pgn
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.trimStart().startsWith('[') ? line : line.replace(/;.*$/, '')))
    .join('\n');
}

/** Public PGN import entry point with safe semicolon-comment handling. */
export function importChessPgn(pgn: string): ChessDocumentResult<ChessDocument> {
  return importChessPgnBase(stripPgnLineComments(pgn));
}
