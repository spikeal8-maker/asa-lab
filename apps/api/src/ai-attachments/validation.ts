export const AI_ATTACHMENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const AI_ATTACHMENT_TEXT_MAX_BYTES = 512 * 1024;
export const AI_ATTACHMENT_MAX_DIMENSION = 8192;
export const AI_ATTACHMENT_MAX_PIXELS = 16_000_000;
export const AI_ATTACHMENT_TEXT_MAX_SCALARS = 200_000;
export const AI_ATTACHMENT_FILENAME_MAX_LENGTH = 180;

export type AiAttachmentValidationCode =
  | 'ai_attachment_filename_invalid'
  | 'ai_attachment_format_unsupported'
  | 'ai_attachment_empty'
  | 'ai_attachment_too_large'
  | 'ai_attachment_image_invalid'
  | 'ai_attachment_image_dimensions_invalid'
  | 'ai_attachment_animation_unsupported'
  | 'ai_attachment_text_invalid'
  | 'ai_attachment_text_too_long';

export class AiAttachmentValidationError extends Error {
  constructor(
    readonly code: AiAttachmentValidationCode,
    readonly status = 400,
  ) {
    super(code);
    this.name = 'AiAttachmentValidationError';
  }
}

export interface AiAttachmentFileDescription {
  readonly kind: 'image' | 'text';
  readonly mediaType: string;
  readonly extension: string;
  readonly maxBytes: number;
}

export type ValidatedAiAttachment =
  | {
      readonly kind: 'image';
      readonly mediaType: string;
      readonly extension: string;
      readonly width: number;
      readonly height: number;
      readonly text: null;
    }
  | {
      readonly kind: 'text';
      readonly mediaType: string;
      readonly extension: string;
      readonly width: null;
      readonly height: null;
      readonly text: string;
    };

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'c',
  'cpp',
  'h',
  'hpp',
  'ino',
  'json',
  'css',
  'html',
  'xml',
  'yaml',
  'yml',
  'sql',
  'sh',
  'java',
  'rs',
  'go',
]);
const IMAGE_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_DEPTHS = new Map([
  [0, new Set([1, 2, 4, 8, 16])],
  [2, new Set([8, 16])],
  [3, new Set([1, 2, 4, 8])],
  [4, new Set([8, 16])],
  [6, new Set([8, 16])],
]);
const PNG_BEFORE_PALETTE = new Set([
  'cHRM',
  'gAMA',
  'iCCP',
  'sBIT',
  'sRGB',
  'cICP',
  'mDCV',
  'cLLI',
]);
const PNG_BEFORE_DATA = new Set(['tRNS', 'bKGD', 'hIST', 'pHYs']);
const PNG_SINGLETONS = new Set([...PNG_BEFORE_PALETTE, ...PNG_BEFORE_DATA, 'tIME', 'eXIf']);
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function fail(code: AiAttachmentValidationCode, status = 400): never {
  throw new AiAttachmentValidationError(code, status);
}

function imageInvalid(): never {
  return fail('ai_attachment_image_invalid');
}

export function describeAiAttachmentFile(filename: string): AiAttachmentFileDescription {
  if (
    typeof filename !== 'string' ||
    filename.length === 0 ||
    filename.length > AI_ATTACHMENT_FILENAME_MAX_LENGTH ||
    filename.trim() !== filename ||
    filename.startsWith('.') ||
    filename.includes('..') ||
    // No paths, header controls, Windows alternate streams, bidi overrides or
    // unpaired surrogates. Unicode letters and ordinary spaces remain valid.
    /[\\/<>:"|?*\u2028\u2029\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(filename)
  ) {
    fail('ai_attachment_filename_invalid');
  }
  for (const scalar of filename) {
    const code = scalar.codePointAt(0) ?? 0;
    if (code < 32 || (code >= 127 && code <= 159)) fail('ai_attachment_filename_invalid');
  }
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  if (!filename.includes('.') || extension.length === 0)
    fail('ai_attachment_format_unsupported', 415);
  const imageType = IMAGE_TYPES.get(extension);
  if (imageType) {
    return {
      kind: 'image',
      mediaType: imageType,
      extension: extension === 'jpeg' ? 'jpg' : extension,
      maxBytes: AI_ATTACHMENT_IMAGE_MAX_BYTES,
    };
  }
  if (!TEXT_EXTENSIONS.has(extension)) fail('ai_attachment_format_unsupported', 415);
  return {
    kind: 'text',
    mediaType: extension === 'md' || extension === 'markdown' ? 'text/markdown' : 'text/plain',
    extension,
    maxBytes: AI_ATTACHMENT_TEXT_MAX_BYTES,
  };
}

function dimensions(width: number, height: number): { width: number; height: number } {
  if (
    width < 1 ||
    height < 1 ||
    width > AI_ATTACHMENT_MAX_DIMENSION ||
    height > AI_ATTACHMENT_MAX_DIMENSION ||
    width * height > AI_ATTACHMENT_MAX_PIXELS
  ) {
    fail('ai_attachment_image_dimensions_invalid');
  }
  return { width, height };
}

function pngCrc(bytes: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = PNG_CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function validatePng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) imageInvalid();
  let offset = 8;
  let size: { width: number; height: number } | null = null;
  let colorType = -1;
  let bitDepth = 0;
  let paletteEntries = 0;
  let dataSeen = false;
  let dataEnded = false;
  let dataBytes = 0;
  const zlibPrefix: number[] = [];
  const seen = new Set<string>();
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) imageInvalid();
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) imageInvalid();
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) imageInvalid();
    if (pngCrc(bytes, offset + 4, end) !== bytes.readUInt32BE(end)) imageInvalid();
    if (!size && type !== 'IHDR') imageInvalid();
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') {
      fail('ai_attachment_animation_unsupported');
    }
    if (dataSeen && type !== 'IDAT') dataEnded = true;
    if (PNG_SINGLETONS.has(type)) {
      if (seen.has(type)) imageInvalid();
      seen.add(type);
    }
    if (PNG_BEFORE_PALETTE.has(type) && (paletteEntries > 0 || dataSeen)) imageInvalid();
    if (PNG_BEFORE_DATA.has(type) && dataSeen) imageInvalid();
    if (type === 'IHDR') {
      if (size || offset !== 8 || length !== 13) imageInvalid();
      size = dimensions(bytes.readUInt32BE(start), bytes.readUInt32BE(start + 4));
      bitDepth = bytes[start + 8];
      colorType = bytes[start + 9];
      if (
        !PNG_DEPTHS.get(colorType)?.has(bitDepth) ||
        bytes[start + 10] !== 0 ||
        bytes[start + 11] !== 0 ||
        bytes[start + 12] > 1
      )
        imageInvalid();
    } else if (type === 'PLTE') {
      if (
        paletteEntries > 0 ||
        dataSeen ||
        colorType === 0 ||
        colorType === 4 ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0
      )
        imageInvalid();
      paletteEntries = length / 3;
      if (colorType === 3 && paletteEntries > 2 ** bitDepth) imageInvalid();
    } else if (type === 'IDAT') {
      if (dataEnded || (colorType === 3 && paletteEntries === 0)) imageInvalid();
      dataSeen = true;
      for (let index = start; index < end && zlibPrefix.length < 3; index += 1) {
        zlibPrefix.push(bytes[index]);
      }
      dataBytes += length;
    } else if (type === 'IEND') {
      if (length !== 0 || !size || !dataSeen || dataBytes < 8 || end + 4 !== bytes.length)
        imageInvalid();
      // IDAT is one zlib stream, even when its header spans multiple chunks.
      // Check its framing only: never inflate attacker-controlled image data.
      const [cmf, flags, firstBlock] = zlibPrefix;
      if (
        (cmf & 0x0f) !== 8 ||
        cmf >>> 4 > 7 ||
        ((cmf << 8) | flags) % 31 !== 0 ||
        (flags & 0x20) !== 0 ||
        ((firstBlock >>> 1) & 3) === 3
      )
        imageInvalid();
      return size;
    } else if (type === 'tRNS') {
      if (
        (colorType === 3 && (paletteEntries === 0 || length < 1 || length > paletteEntries)) ||
        (colorType === 0 && length !== 2) ||
        (colorType === 2 && length !== 6) ||
        colorType === 4 ||
        colorType === 6
      )
        imageInvalid();
    } else if (type === 'hIST') {
      if (paletteEntries === 0 || length !== 2 * paletteEntries) imageInvalid();
    } else if (type === 'bKGD') {
      const expected = colorType === 3 ? 1 : colorType === 0 || colorType === 4 ? 2 : 6;
      if (
        length !== expected ||
        (colorType === 3 && (paletteEntries === 0 || bytes[start] >= paletteEntries))
      )
        imageInvalid();
    } else if (type === 'pHYs') {
      if (length !== 9 || bytes[start + 8] > 1) imageInvalid();
    } else if (type === 'gAMA' || type === 'cICP') {
      if (length !== 4) imageInvalid();
    } else if (type === 'cHRM') {
      if (length !== 32) imageInvalid();
    } else if (type === 'sRGB') {
      if (length !== 1 || bytes[start] > 3 || seen.has('iCCP')) imageInvalid();
    } else if (type === 'iCCP') {
      if (seen.has('sRGB')) imageInvalid();
    } else if (type === 'sBIT') {
      const expected = colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 3;
      if (length !== expected) imageInvalid();
      for (let index = start; index < end; index += 1) {
        if (bytes[index] < 1 || bytes[index] > (colorType === 3 ? 8 : bitDepth)) imageInvalid();
      }
    } else if (type === 'tIME') {
      if (length !== 7) imageInvalid();
    } else if (type.charCodeAt(0) < 97) {
      // An unknown critical chunk changes the meaning of the image.
      imageInvalid();
    }
    offset = end + 4;
  }
  return imageInvalid();
}

interface JpegComponent {
  readonly quantization: number;
  readonly blocks: number;
  readonly progression: Int8Array;
}

function jpegQuantizationTables(
  bytes: Buffer,
  start: number,
  end: number,
  tables: Map<number, number>,
): void {
  if (start === end) imageInvalid();
  let offset = start;
  while (offset < end) {
    const selector = bytes[offset++];
    const precision = selector >>> 4;
    if (precision > 1 || (selector & 15) > 3) imageInvalid();
    const size = 64 * (precision + 1);
    if (end - offset < size) imageInvalid();
    for (let index = offset; index < offset + size; index += precision + 1) {
      if ((precision === 0 ? bytes[index] : bytes.readUInt16BE(index)) === 0) imageInvalid();
    }
    tables.set(selector & 15, precision);
    offset += size;
  }
}

function jpegHuffmanTables(bytes: Buffer, start: number, end: number, tables: Set<number>): void {
  if (start === end) imageInvalid();
  let offset = start;
  while (offset < end) {
    if (end - offset < 17) imageInvalid();
    const selector = bytes[offset++];
    if (selector >>> 4 > 1 || (selector & 15) > 3) imageInvalid();
    let symbols = 0;
    let availableCodes = 1;
    for (let length = 0; length < 16; length += 1) {
      const count = bytes[offset++];
      symbols += count;
      availableCodes = 2 * availableCodes - count;
      // JPEG leaves the all-ones code unused; oversubscribed trees are invalid.
      if (availableCodes < 1) imageInvalid();
    }
    if (symbols < 1 || symbols > 256 || symbols > end - offset) imageInvalid();
    tables.add(selector);
    offset += symbols;
  }
}

function jpegScanEnd(bytes: Buffer, start: number, restartInterval: number): number {
  let offset = start;
  let entropyBytes = 0;
  let restart = 0;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      entropyBytes += 1;
      offset += 1;
      continue;
    }
    const markerStart = offset;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset === bytes.length) imageInvalid();
    const marker = bytes[offset];
    if (marker === 0) {
      if (offset !== markerStart + 1) imageInvalid();
      entropyBytes += 1;
      offset += 1;
    } else if (marker >= 0xd0 && marker <= 0xd7) {
      if (restartInterval === 0 || entropyBytes === 0 || marker !== 0xd0 + restart) imageInvalid();
      restart = (restart + 1) % 8;
      entropyBytes = 0;
      offset += 1;
    } else {
      if (entropyBytes === 0) imageInvalid();
      return markerStart;
    }
  }
  return imageInvalid();
}

function validateJpeg(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) imageInvalid();
  let offset = 2;
  let size: { width: number; height: number } | null = null;
  let frameMarker = 0;
  let precision = 0;
  let scans = 0;
  let restartInterval = 0;
  const components = new Map<number, JpegComponent>();
  const quantization = new Map<number, number>();
  const huffman = new Set<number>();
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) imageInvalid();
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset === bytes.length) imageInvalid();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!size || scans === 0 || offset !== bytes.length) imageInvalid();
      for (const component of components.values()) {
        if (component.progression[0] < 0) imageInvalid();
      }
      return size;
    }
    if (
      marker !== 0xc0 &&
      marker !== 0xc1 &&
      marker !== 0xc2 &&
      marker !== 0xc4 &&
      marker !== 0xdb &&
      marker !== 0xdd &&
      marker !== 0xda &&
      marker !== 0xfe &&
      !(marker >= 0xe0 && marker <= 0xef)
    )
      imageInvalid();
    if (bytes.length - offset < 2) imageInvalid();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || length > bytes.length - offset) imageInvalid();
    const start = offset + 2;
    const end = offset + length;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (size || length < 11) imageInvalid();
      precision = bytes[start];
      if (precision !== 8 && (marker === 0xc0 || precision !== 12)) imageInvalid();
      size = dimensions(bytes.readUInt16BE(start + 3), bytes.readUInt16BE(start + 1));
      const count = bytes[start + 5];
      if (count < 1 || count > 4 || length !== 8 + 3 * count) imageInvalid();
      for (let index = start + 6; index < end; index += 3) {
        const id = bytes[index];
        const horizontal = bytes[index + 1] >>> 4;
        const vertical = bytes[index + 1] & 15;
        if (
          components.has(id) ||
          horizontal < 1 ||
          horizontal > 4 ||
          vertical < 1 ||
          vertical > 4 ||
          bytes[index + 2] > 3
        )
          imageInvalid();
        components.set(id, {
          quantization: bytes[index + 2],
          blocks: horizontal * vertical,
          progression: new Int8Array(64).fill(-1),
        });
      }
      frameMarker = marker;
    } else if (marker === 0xdb) {
      jpegQuantizationTables(bytes, start, end, quantization);
    } else if (marker === 0xc4) {
      jpegHuffmanTables(bytes, start, end, huffman);
    } else if (marker === 0xdd) {
      if (length !== 4) imageInvalid();
      restartInterval = bytes.readUInt16BE(start);
    } else if (marker === 0xda) {
      if (!size || length < 8) imageInvalid();
      const count = bytes[start];
      if (count < 1 || count > 4 || count > components.size || length !== 6 + 2 * count)
        imageInvalid();
      const spectralStart = bytes[end - 3];
      const spectralEnd = bytes[end - 2];
      const high = bytes[end - 1] >>> 4;
      const low = bytes[end - 1] & 15;
      if (frameMarker === 0xc2) {
        if (
          spectralStart > spectralEnd ||
          spectralEnd > 63 ||
          high > 13 ||
          low > 13 ||
          (spectralStart === 0 ? spectralEnd !== 0 : count !== 1) ||
          (high !== 0 && high !== low + 1)
        )
          imageInvalid();
      } else if (spectralStart !== 0 || spectralEnd !== 63 || high !== 0 || low !== 0)
        imageInvalid();
      const selected = new Set<number>();
      let blocks = 0;
      for (let index = start + 1; index < end - 3; index += 2) {
        const id = bytes[index];
        const component = components.get(id);
        if (!component || selected.has(id)) imageInvalid();
        selected.add(id);
        blocks += component.blocks;
        const dc = bytes[index + 1] >>> 4;
        const ac = bytes[index + 1] & 15;
        const maxTable = frameMarker === 0xc0 ? 1 : 3;
        if (dc > maxTable || ac > maxTable) imageInvalid();
        if (
          !quantization.has(component.quantization) ||
          (precision === 8 && quantization.get(component.quantization) !== 0)
        )
          imageInvalid();
        if (spectralStart === 0 && high === 0 && !huffman.has(dc)) imageInvalid();
        if (spectralEnd > 0 && !huffman.has(0x10 | ac)) imageInvalid();
        if (
          frameMarker === 0xc2 &&
          ((spectralStart === 0 && ac !== 0) ||
            (spectralStart > 0 && (dc !== 0 || component.progression[0] < 0)))
        )
          imageInvalid();
        for (let coefficient = spectralStart; coefficient <= spectralEnd; coefficient += 1) {
          if (component.progression[coefficient] !== (high === 0 ? -1 : high)) imageInvalid();
          component.progression[coefficient] = low;
        }
      }
      if (count > 1 && blocks > 10) imageInvalid();
      scans += 1;
      offset = jpegScanEnd(bytes, end, restartInterval);
      continue;
    }
    offset = end;
  }
  return imageInvalid();
}

function webpFrame(
  bytes: Buffer,
  start: number,
  length: number,
  lossless: boolean,
): { width: number; height: number } {
  if (lossless) {
    if (length < 6 || bytes[start] !== 0x2f) imageInvalid();
    const header = bytes.readUInt32LE(start + 1);
    if (header >>> 29 !== 0) imageInvalid();
    // The VP8L alpha bit is only a hint, not a decoder or ownership decision.
    return dimensions((header & 0x3fff) + 1, ((header >>> 14) & 0x3fff) + 1);
  }
  if (length < 11) imageInvalid();
  const tag = bytes.readUIntLE(start, 3);
  const partitionLength = tag >>> 5;
  if (
    (tag & 1) !== 0 ||
    ((tag >>> 1) & 7) > 3 ||
    (tag & 16) === 0 ||
    bytes[start + 3] !== 0x9d ||
    bytes[start + 4] !== 1 ||
    bytes[start + 5] !== 0x2a ||
    partitionLength === 0 ||
    partitionLength >= length - 10
  )
    imageInvalid();
  return dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
}

function validateWebp(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 20 ||
    bytes.toString('latin1', 0, 4) !== 'RIFF' ||
    bytes.toString('latin1', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.length % 2 !== 0
  )
    imageInvalid();
  let offset = 12;
  let canvas: { width: number; height: number } | null = null;
  let frame: { width: number; height: number } | null = null;
  let flags = 0;
  let alpha = false;
  const metadata = new Set<string>();
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) imageInvalid();
    const type = bytes.toString('latin1', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    if (length > bytes.length - offset - 8) imageInvalid();
    const start = offset + 8;
    const end = start + length;
    const next = end + (length % 2);
    if (next > bytes.length || (length % 2 !== 0 && bytes[end] !== 0)) imageInvalid();
    if (type === 'ANIM' || type === 'ANMF') fail('ai_attachment_animation_unsupported');
    if (type === 'VP8X') {
      if (offset !== 12 || canvas || length !== 10) imageInvalid();
      flags = bytes[start];
      if ((flags & 2) !== 0) fail('ai_attachment_animation_unsupported');
      if ((flags & 0xc1) !== 0 || bytes.readUIntLE(start + 1, 3) !== 0) imageInvalid();
      canvas = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (
        frame ||
        (!canvas && (offset !== 12 || next !== bytes.length)) ||
        (type === 'VP8L' && alpha)
      )
        imageInvalid();
      frame = webpFrame(bytes, start, length, type === 'VP8L');
      if (canvas && (frame.width !== canvas.width || frame.height !== canvas.height))
        imageInvalid();
      if (canvas && type === 'VP8 ' && Boolean(flags & 16) !== alpha) imageInvalid();
    } else if (type === 'ALPH') {
      if (!canvas || frame || alpha || (flags & 16) === 0 || length < 2) imageInvalid();
      const header = bytes[start];
      if (header >>> 6 !== 0 || ((header >>> 4) & 3) > 1 || (header & 3) > 1) imageInvalid();
      if ((header & 3) === 0 && length !== 1 + canvas.width * canvas.height) imageInvalid();
      alpha = true;
    } else if (type === 'ICCP' || type === 'EXIF' || type === 'XMP ') {
      const flag = type === 'ICCP' ? 32 : type === 'EXIF' ? 8 : 4;
      if (!canvas || metadata.has(type) || length === 0 || (flags & flag) === 0) imageInvalid();
      if (type === 'ICCP' && (frame || alpha)) imageInvalid();
      metadata.add(type);
    } else if (!canvas || !/^[\x20-\x7e]{4}$/.test(type)) {
      imageInvalid();
    }
    offset = next;
  }
  if (!frame) imageInvalid();
  if (
    Boolean(flags & 32) !== metadata.has('ICCP') ||
    Boolean(flags & 8) !== metadata.has('EXIF') ||
    Boolean(flags & 4) !== metadata.has('XMP ')
  )
    imageInvalid();
  return frame;
}

/**
 * Synchronous, linear, byte-bounded validation of an already captured upload.
 * Image validation covers signatures, container structure and encoded dimensions.
 * It does not inflate PNG/metadata, decode JPEG/WebP pixels, sanitize arbitrary
 * codec input, execute source text, or change the bytes used by the caller's hash.
 */
export function validateAiAttachment(bytes: Uint8Array, filename: string): ValidatedAiAttachment {
  const file = describeAiAttachmentFile(filename);
  if (bytes.byteLength === 0) fail('ai_attachment_empty');
  if (bytes.byteLength > file.maxBytes) fail('ai_attachment_too_large', 413);
  if (file.kind === 'text') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      fail('ai_attachment_text_invalid');
    }
    let scalars = 0;
    for (const scalar of text) {
      const code = scalar.codePointAt(0) ?? 0;
      if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
        fail('ai_attachment_text_invalid');
      scalars += 1;
      if (scalars > AI_ATTACHMENT_TEXT_MAX_SCALARS) fail('ai_attachment_text_too_long', 413);
    }
    return {
      kind: 'text',
      mediaType: file.mediaType,
      extension: file.extension,
      width: null,
      height: null,
      text,
    };
  }
  // A view, not a rewrite/copy of the captured bytes. The synchronous parsers do
  // not retain this view or write to it.
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size =
    file.extension === 'png'
      ? validatePng(buffer)
      : file.extension === 'jpg'
        ? validateJpeg(buffer)
        : validateWebp(buffer);
  return {
    kind: 'image',
    mediaType: file.mediaType,
    extension: file.extension,
    ...size,
    text: null,
  };
}
