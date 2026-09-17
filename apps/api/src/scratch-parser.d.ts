/** The callback API of the exact Scratch VM-compatible scratch-parser dependency. */
declare module 'scratch-parser' {
  function parse(
    input: string | Buffer,
    isSprite: boolean,
    callback: (error: unknown, result?: unknown) => void,
  ): void;
  export = parse;
}
