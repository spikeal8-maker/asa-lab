declare const __ASA_BUILD_REVISION__: string;
declare const __ASA_BUILT_AT__: string;

declare module '*.svg?url' {
  const url: string;
  export default url;
}

declare module '*.png?url' {
  const url: string;
  export default url;
}
