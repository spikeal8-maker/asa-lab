import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AI_ATTACHMENT_FILENAME_MAX_LENGTH,
  AI_ATTACHMENT_IMAGE_MAX_BYTES,
  AI_ATTACHMENT_MAX_DIMENSION,
  AI_ATTACHMENT_MAX_PIXELS,
  AI_ATTACHMENT_TEXT_MAX_BYTES,
  AI_ATTACHMENT_TEXT_MAX_SCALARS,
  AiAttachmentValidationError,
  describeAiAttachmentFile,
  validateAiAttachment,
  type AiAttachmentValidationCode,
} from './validation.js';
import {
  aiAttachmentImageFixture,
  type AiAttachmentImageFixtureFormat,
} from './validation.fixture.js';

const IMAGE_CASES: readonly [AiAttachmentImageFixtureFormat, string, string, string][] = [
  ['png', 'image.PNG', 'image/png', 'png'],
  ['png-palette', 'image.png', 'image/png', 'png'],
  ['png-grayscale16', 'image.png', 'image/png', 'png'],
  ['jpeg', 'image.JPEG', 'image/jpeg', 'jpg'],
  ['jpeg-progressive', 'image.jpg', 'image/jpeg', 'jpg'],
  ['webp', 'image.webp', 'image/webp', 'webp'],
  ['webp-lossless', 'image.webp', 'image/webp', 'webp'],
  ['webp-alpha', 'image.webp', 'image/webp', 'webp'],
  ['webp-alpha-lossless', 'image.webp', 'image/webp', 'webp'],
];

function invalid(
  bytes: Uint8Array,
  filename: string,
  code: AiAttachmentValidationCode = 'ai_attachment_image_invalid',
  status = 400,
): void {
  let actual: unknown;
  try {
    validateAiAttachment(bytes, filename);
  } catch (error) {
    actual = error;
  }
  expect(actual).toBeInstanceOf(AiAttachmentValidationError);
  expect(actual).toMatchObject({ code, status, message: code });
}

function crc(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

function pngParts(): { header: Buffer; data: Buffer; end: Buffer } {
  const png = aiAttachmentImageFixture('png');
  return { header: png.subarray(16, 29), data: png.subarray(41, 69), end: Buffer.alloc(0) };
}

function png(...chunks: Buffer[]): Buffer {
  return Buffer.concat([aiAttachmentImageFixture('png').subarray(0, 8), ...chunks]);
}

function pngHeader(change: (header: Buffer) => void): Buffer {
  const parts = pngParts();
  change(parts.header);
  return png(
    pngChunk('IHDR', parts.header),
    pngChunk('IDAT', parts.data),
    pngChunk('IEND', parts.end),
  );
}

function webpChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2));
  chunk.write(type, 0, 4, 'latin1');
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

function webp(...chunks: Buffer[]): Buffer {
  const bytes = Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBP'), ...chunks]);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  return bytes;
}

function webpExtended(flags = 0, width = 3, height = 2): Buffer {
  const header = Buffer.alloc(10);
  header[0] = flags;
  header.writeUIntLE(width - 1, 4, 3);
  header.writeUIntLE(height - 1, 7, 3);
  return webpChunk('VP8X', header);
}

function jpegMarker(bytes: Buffer, marker: number): number {
  const index = bytes.indexOf(Buffer.from([0xff, marker]));
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('AI attachment descriptor and inert text', () => {
  it.each([
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
  ])('uses one reservation and validation allowlist for .%s', (extension) => {
    const filename = `Учебный пример.${extension.toUpperCase()}`;
    const mediaType = ['md', 'markdown'].includes(extension) ? 'text/markdown' : 'text/plain';
    expect(describeAiAttachmentFile(filename)).toEqual({
      kind: 'text',
      mediaType,
      extension,
      maxBytes: AI_ATTACHMENT_TEXT_MAX_BYTES,
    });
    expect(validateAiAttachment(Buffer.from('текст'), filename)).toEqual({
      kind: 'text',
      mediaType,
      extension,
      width: null,
      height: null,
      text: 'текст',
    });
  });

  it.each([
    '',
    '.secret.txt',
    '../note.txt',
    'a..b.txt',
    '/tmp/note.txt',
    'dir\\note.txt',
    'C:note.txt',
    ' note.txt',
    'note.txt ',
    'note.txt\r\nX-Foo: yes',
    'note\u0000.txt',
    'note\u0085.txt',
    'note\u2028.txt',
    'note\u2029.txt',
    '\u202enote.txt',
    'note\u2066.txt',
    'note".txt',
    'note?.txt',
    'note<.txt',
    'note\ud800.txt',
  ])('rejects unsafe filename %j before accepting metadata', (filename) => {
    expect(() => describeAiAttachmentFile(filename)).toThrowError('ai_attachment_filename_invalid');
    invalid(Buffer.from('ok'), filename, 'ai_attachment_filename_invalid');
  });

  it.each([
    'image.svg',
    'document.pdf',
    'image.gif',
    'image.avif',
    'payload.exe',
    'archive.tar.gz',
    'README',
    'image.',
    'prototype.__proto__',
    'prototype.constructor',
  ])('rejects unimplemented extension %s', (filename) =>
    invalid(Buffer.from('ok'), filename, 'ai_attachment_format_unsupported', 415),
  );

  it('bounds the filename and supports ordinary Unicode characters without rewriting it', () => {
    const filename = `${'a'.repeat(AI_ATTACHMENT_FILENAME_MAX_LENGTH - 4)}.txt`;
    expect(describeAiAttachmentFile(filename).kind).toBe('text');
    expect(() => describeAiAttachmentFile(`a${filename}`)).toThrowError(
      'ai_attachment_filename_invalid',
    );
    expect(describeAiAttachmentFile('Наблюдения 😀.txt').extension).toBe('txt');
  });

  it('preserves BOM, combining characters, CRLF, tabs and the original digest', () => {
    const text = '\ufeffПривет, 世界 😀 e\u0301\r\n\tСледующая строка\n';
    const bytes = Buffer.from(text);
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(validateAiAttachment(bytes, 'note.md').text).toBe(text);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  });

  it.each(['html', 'xml', 'js', 'md'])(
    'keeps .%s markup, URLs and executable-looking source inert',
    (extension) => {
      const text =
        '<script>throw new Error("must not execute")</script>\n![image](https://example.test/private)\n<!DOCTYPE x SYSTEM "file:///etc/passwd">';
      const result = validateAiAttachment(Buffer.from(text), `source.${extension}`);
      expect(result).toMatchObject({ kind: 'text', text, width: null, height: null });
      expect(result.mediaType).toBe(extension === 'md' ? 'text/markdown' : 'text/plain');
    },
  );

  it.each(
    [
      [0x80],
      [0xff],
      [0xc0, 0xaf],
      [0xe2, 0x82],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xff, 0xfe, 0x61, 0x00],
    ].map((bytes) => ({ bytes })),
  )('rejects malformed/overlong UTF-8 or UTF-16 bytes %#', ({ bytes }) =>
    invalid(Buffer.from(bytes), 'note.txt', 'ai_attachment_text_invalid'),
  );

  it.each([0, 1, 8, 11, 12, 31, 127])('rejects binary control byte %i', (control) => {
    invalid(Buffer.from([65, control, 66]), 'note.txt', 'ai_attachment_text_invalid');
  });

  it('checks the byte limit independently of the Unicode scalar limit', () => {
    const text =
      '界'.repeat(Math.floor(AI_ATTACHMENT_TEXT_MAX_BYTES / 3)) +
      'a'.repeat(AI_ATTACHMENT_TEXT_MAX_BYTES % 3);
    const bytes = Buffer.from(text);
    expect(bytes.length).toBe(AI_ATTACHMENT_TEXT_MAX_BYTES);
    expect(validateAiAttachment(bytes, 'note.txt').text).toBe(text);
    invalid(Buffer.concat([bytes, Buffer.from('a')]), 'note.txt', 'ai_attachment_too_large', 413);
  });

  it('counts Unicode scalar values rather than UTF-16 code units', () => {
    const text =
      '😀'.repeat(AI_ATTACHMENT_TEXT_MAX_SCALARS / 2) +
      'a'.repeat(AI_ATTACHMENT_TEXT_MAX_SCALARS / 2);
    expect(text.length).toBe(300_000);
    expect(validateAiAttachment(Buffer.from(text), 'note.txt').text).toBe(text);
    invalid(Buffer.from(`${text}a`), 'note.txt', 'ai_attachment_text_too_long', 413);
  });

  it.each(['image.png', 'note.txt'])('rejects an empty upload for %s', (filename) => {
    invalid(Buffer.alloc(0), filename, 'ai_attachment_empty');
  });
});

describe('AI image structural validation', () => {
  it.each(IMAGE_CASES)(
    'accepts actual %s bytes with canonical MIME and dimensions',
    (format, filename, mediaType, extension) => {
      const bytes = aiAttachmentImageFixture(format);
      const original = Buffer.from(bytes);
      expect(describeAiAttachmentFile(filename)).toEqual({
        kind: 'image',
        mediaType,
        extension,
        maxBytes: AI_ATTACHMENT_IMAGE_MAX_BYTES,
      });
      expect(validateAiAttachment(bytes, filename)).toEqual({
        kind: 'image',
        mediaType,
        extension,
        width: 3,
        height: 2,
        text: null,
      });
      expect(bytes).toEqual(original);
    },
  );

  it.each(IMAGE_CASES)(
    'rejects every truncated prefix of real %s without native bounds errors',
    (format, filename) => {
      const bytes = aiAttachmentImageFixture(format);
      for (let end = 0; end < bytes.length; end += 1) {
        expect(
          () => validateAiAttachment(bytes.subarray(0, end), filename),
          `prefix ${end}`,
        ).toThrowError(AiAttachmentValidationError);
      }
    },
  );

  it.each(IMAGE_CASES)('rejects trailing HTML or a second image after %s', (format, filename) => {
    const bytes = aiAttachmentImageFixture(format);
    invalid(Buffer.concat([bytes, Buffer.from('<script>alert(1)</script>')]), filename);
    invalid(Buffer.concat([bytes, bytes]), filename);
  });

  it.each(['png', 'jpg', 'webp'])('rejects HTML/SVG masquerading as .%s', (extension) => {
    invalid(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
      `image.${extension}`,
    );
    invalid(Buffer.from('<!doctype html><html><script/></html>'), `image.${extension}`);
  });

  it('rejects signatures that do not match the descriptor extension', () => {
    invalid(aiAttachmentImageFixture('png'), 'image.jpg');
    invalid(aiAttachmentImageFixture('jpeg'), 'image.webp');
    invalid(aiAttachmentImageFixture('webp'), 'image.png');
    invalid(aiAttachmentImageFixture('png'), 'image.txt', 'ai_attachment_text_invalid');
  });

  it('uses only the given Uint8Array view and keeps neighboring bytes unchanged', () => {
    const image = aiAttachmentImageFixture('png');
    const backing = Buffer.concat([Buffer.from('before'), image, Buffer.from('after')]);
    const original = Buffer.from(backing);
    const view = new Uint8Array(backing.buffer, backing.byteOffset + 6, image.length);
    expect(validateAiAttachment(view, 'image.png').width).toBe(3);
    expect(backing).toEqual(original);
  });

  it('enforces the actual image byte limit before parsing a signature', () => {
    const oversized = Buffer.alloc(AI_ATTACHMENT_IMAGE_MAX_BYTES + 1);
    aiAttachmentImageFixture('png').copy(oversized);
    invalid(oversized, 'image.png', 'ai_attachment_too_large', 413);
  });
});

describe('PNG chunks and encoded dimensions', () => {
  it('checks every CRC, including opaque ancillary chunks and the end marker', () => {
    const parts = pngParts();
    const image = png(
      pngChunk('IHDR', parts.header),
      pngChunk('tEXt', Buffer.from('name\0value')),
      pngChunk('IDAT', parts.data),
      pngChunk('IEND', parts.end),
    );
    expect(validateAiAttachment(image, 'image.png').width).toBe(3);
    for (const index of [29, 49, image.length - 1]) {
      const broken = Buffer.from(image);
      broken[index] ^= 1;
      invalid(broken, 'image.png');
    }
  });

  it('accepts contiguous IDAT splits even inside the zlib header', () => {
    const parts = pngParts();
    const image = png(
      pngChunk('IHDR', parts.header),
      pngChunk('IDAT', Buffer.alloc(0)),
      ...[parts.data.subarray(0, 1), parts.data.subarray(1, 2), parts.data.subarray(2)].map(
        (data) => pngChunk('IDAT', data),
      ),
      pngChunk('IEND', parts.end),
    );
    expect(validateAiAttachment(image, 'image.png').height).toBe(2);
  });

  it.each([
    [0, 1],
    [1, 0],
    [8193, 1],
    [1, 8193],
    [4001, 4000],
    [0xffffffff, 0xffffffff],
  ])('rejects encoded dimensions %i by %i before any decoding', (width, height) =>
    invalid(
      pngHeader((header) => {
        header.writeUInt32BE(width, 0);
        header.writeUInt32BE(height, 4);
      }),
      'image.png',
      'ai_attachment_image_dimensions_invalid',
    ),
  );

  it('keeps the declared dimension and pixel-count ceilings distinct', () => {
    expect(AI_ATTACHMENT_MAX_DIMENSION).toBe(8192);
    expect(AI_ATTACHMENT_MAX_PIXELS).toBe(16_000_000);
    // These mutations exercise the container header boundary, not pixel decoding.
    expect(
      validateAiAttachment(
        pngHeader((header) => {
          header.writeUInt32BE(4000, 0);
          header.writeUInt32BE(4000, 4);
        }),
        'image.png',
      ).width,
    ).toBe(4000);
    expect(
      validateAiAttachment(
        pngHeader((header) => {
          header.writeUInt32BE(8192, 0);
          header.writeUInt32BE(1, 4);
        }),
        'image.png',
      ).height,
    ).toBe(1);
  });

  it.each([
    [8, 4],
    [8, 1],
    [9, 1],
    [10, 1],
    [11, 1],
    [12, 2],
  ])('rejects invalid IHDR field at byte %i', (index, value) => {
    invalid(
      pngHeader((header) => {
        header[index] = value;
      }),
      'image.png',
    );
  });

  it.each(['acTL', 'fcTL', 'fdAT'])(
    'rejects the %s animation chunk, even without other animation flags',
    (type) => {
      const parts = pngParts();
      invalid(
        png(
          pngChunk('IHDR', parts.header),
          pngChunk(type, Buffer.alloc(8)),
          pngChunk('IDAT', parts.data),
          pngChunk('IEND', parts.end),
        ),
        'image.png',
        'ai_attachment_animation_unsupported',
      );
    },
  );

  it('rejects missing, repeated and reordered critical chunks', () => {
    const parts = pngParts();
    const header = pngChunk('IHDR', parts.header);
    const data = pngChunk('IDAT', parts.data);
    const end = pngChunk('IEND', parts.end);
    const extra = pngChunk('tEXt', Buffer.from('a\0b'));
    for (const chunks of [
      [data, end],
      [header, header, data, end],
      [header, end],
      [header, data],
      [header, data, extra, data, end],
      [header, data, pngChunk('IEND', Buffer.from([0]))],
      [header, pngChunk('IDAT', Buffer.alloc(0)), end],
      [header, pngChunk('ABCD', Buffer.from([1])), data, end],
      [header, pngChunk('abca', Buffer.from([1])), data, end],
    ]) {
      invalid(png(...chunks), 'image.png');
    }
  });

  it('rejects overflowed chunk lengths without attempting to allocate or read them', () => {
    const bytes = aiAttachmentImageFixture('png');
    bytes.writeUInt32BE(0xffffffff, 33);
    invalid(bytes, 'image.png');
  });

  it('rejects impossible zlib framing even with valid PNG CRCs', () => {
    const parts = pngParts();
    for (const prefix of [
      [0, 0, 0],
      [0x78, 0x20, 0],
      [0x78, 0x9c, 6],
    ]) {
      const data = Buffer.from(parts.data);
      data.set(prefix);
      invalid(
        png(pngChunk('IHDR', parts.header), pngChunk('IDAT', data), pngChunk('IEND', parts.end)),
        'image.png',
      );
    }
  });

  it('rejects missing, oversized or late palettes and invalid transparency', () => {
    const parts = pngParts();
    const indexed = Buffer.from(parts.header);
    indexed[8] = 1;
    indexed[9] = 3;
    const data = pngChunk('IDAT', parts.data);
    const end = pngChunk('IEND', parts.end);
    const palette = pngChunk('PLTE', Buffer.from([0, 0, 0, 255, 255, 255]));
    for (const chunks of [
      [pngChunk('IHDR', indexed), data, end],
      [pngChunk('IHDR', indexed), pngChunk('PLTE', Buffer.alloc(9)), data, end],
      [pngChunk('IHDR', parts.header), data, palette, end],
      [pngChunk('IHDR', indexed), palette, palette, data, end],
      [pngChunk('IHDR', indexed), palette, pngChunk('tRNS', Buffer.alloc(3)), data, end],
      [pngChunk('IHDR', parts.header), pngChunk('tRNS', Buffer.alloc(1)), data, end],
    ])
      invalid(png(...chunks), 'image.png');
  });
});

describe('JPEG frame, table and scan boundaries', () => {
  it.each([
    [0, 1],
    [1, 0],
    [8193, 1],
    [4001, 4000],
    [65535, 65535],
  ])('rejects encoded dimensions %i by %i', (width, height) => {
    const bytes = aiAttachmentImageFixture('jpeg');
    const frame = jpegMarker(bytes, 0xc0);
    bytes.writeUInt16BE(height, frame + 5);
    bytes.writeUInt16BE(width, frame + 7);
    invalid(bytes, 'image.jpg', 'ai_attachment_image_dimensions_invalid');
  });

  it('accepts the allowed sequential SOF1 process as well as baseline and progressive frames', () => {
    const bytes = aiAttachmentImageFixture('jpeg');
    bytes[jpegMarker(bytes, 0xc0) + 1] = 0xc1;
    expect(validateAiAttachment(bytes, 'image.jpg').width).toBe(3);
  });

  it.each([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])(
    'rejects unsupported SOF marker %i',
    (marker) => {
      const bytes = aiAttachmentImageFixture('jpeg');
      bytes[jpegMarker(bytes, 0xc0) + 1] = marker;
      invalid(bytes, 'image.jpg');
    },
  );

  it('rejects broken segment lengths, components and quantization/Huffman references', () => {
    const mutations: ((bytes: Buffer) => void)[] = [
      (bytes) => bytes.writeUInt16BE(1, 4),
      (bytes) => bytes.writeUInt16BE(65535, 4),
      (bytes) => {
        bytes[jpegMarker(bytes, 0xc0) + 4] = 16;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xc0) + 9] = 4;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xc0) + 11] = 0;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xc0) + 13] = bytes[jpegMarker(bytes, 0xc0) + 10];
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xc0) + 12] = 3;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xdb) + 4] = 0x20;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xdb) + 5] = 0;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xc4) + 5] = 255;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xc4) + 4] = 0x20;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xda) + 5] = 17;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xda) + 6] = 0x22;
      },
      (bytes) => {
        bytes[jpegMarker(bytes, 0xda) + 12] = 64;
      },
    ];
    for (const change of mutations) {
      const bytes = aiAttachmentImageFixture('jpeg');
      change(bytes);
      invalid(bytes, 'image.jpg');
    }
  });

  it('requires a frame and nonempty scan, handles stuffing and rejects orphan restarts', () => {
    const bytes = aiAttachmentImageFixture('jpeg');
    const scan = jpegMarker(bytes, 0xda);
    const entropy = scan + 2 + bytes.readUInt16BE(scan + 2);
    invalid(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), 'image.jpg');
    invalid(Buffer.concat([bytes.subarray(0, entropy), Buffer.from([0xff, 0xd9])]), 'image.jpg');
    invalid(
      Buffer.concat([
        bytes.subarray(0, entropy + 1),
        Buffer.from([0xff, 0xd0]),
        bytes.subarray(entropy + 1),
      ]),
      'image.jpg',
    );
    invalid(
      Buffer.concat([
        bytes.subarray(0, entropy),
        Buffer.from([0xff, 0xff, 0]),
        bytes.subarray(entropy),
      ]),
      'image.jpg',
    );
    expect(
      validateAiAttachment(
        Buffer.concat([
          bytes.subarray(0, entropy),
          Buffer.from([0xff, 0]),
          bytes.subarray(entropy),
        ]),
        'image.jpg',
      ).height,
    ).toBe(2);
  });

  it('rejects duplicate frames and invalid progressive scan transitions', () => {
    const bytes = aiAttachmentImageFixture('jpeg');
    const frame = jpegMarker(bytes, 0xc0);
    const frameEnd = frame + 2 + bytes.readUInt16BE(frame + 2);
    invalid(
      Buffer.concat([
        bytes.subarray(0, frameEnd),
        bytes.subarray(frame, frameEnd),
        bytes.subarray(frameEnd),
      ]),
      'image.jpg',
    );
    const progressive = aiAttachmentImageFixture('jpeg-progressive');
    const scan = jpegMarker(progressive, 0xda);
    const end = scan + 2 + progressive.readUInt16BE(scan + 2);
    progressive[end - 3] = 1;
    invalid(progressive, 'image.jpg');
  });
});

describe('WebP RIFF, still frames and canvas consistency', () => {
  it('accepts matching extended VP8/VP8L canvases and opaque bounded metadata', () => {
    const frame = aiAttachmentImageFixture('webp').subarray(12);
    const image = webp(
      webpExtended(8 | 4),
      webpChunk('EXIF', Buffer.from([1])),
      frame,
      webpChunk('XMP ', Buffer.from('<xml/>')),
      webpChunk('TEST', Buffer.from([0])),
    );
    expect(validateAiAttachment(image, 'image.webp').height).toBe(2);
    expect(
      validateAiAttachment(
        webp(webpExtended(), aiAttachmentImageFixture('webp-lossless').subarray(12)),
        'image.webp',
      ).width,
    ).toBe(3);
  });

  it.each([2, 3, 0xff])('rejects VP8X animation flag %i', (flags) => {
    invalid(
      webp(webpExtended(flags), aiAttachmentImageFixture('webp').subarray(12)),
      'image.webp',
      'ai_attachment_animation_unsupported',
    );
  });

  it.each(['ANIM', 'ANMF'])('rejects %s even when the VP8X animation flag is unset', (type) => {
    invalid(
      webp(
        webpExtended(),
        webpChunk(type, Buffer.alloc(16)),
        aiAttachmentImageFixture('webp').subarray(12),
      ),
      'image.webp',
      'ai_attachment_animation_unsupported',
    );
  });

  it('rejects oversized canvases and both lossy/lossless encoded dimensions', () => {
    const frame = aiAttachmentImageFixture('webp').subarray(12);
    invalid(
      webp(webpExtended(0, 8193, 1), frame),
      'image.webp',
      'ai_attachment_image_dimensions_invalid',
    );
    invalid(
      webp(webpExtended(0, 4001, 4000), frame),
      'image.webp',
      'ai_attachment_image_dimensions_invalid',
    );
    const lossy = aiAttachmentImageFixture('webp');
    lossy.writeUInt16LE(8193, 26);
    invalid(lossy, 'image.webp', 'ai_attachment_image_dimensions_invalid');
    const lossless = aiAttachmentImageFixture('webp-lossless');
    lossless.writeUInt32LE(8192, 21);
    invalid(lossless, 'image.webp', 'ai_attachment_image_dimensions_invalid');
  });

  it('rejects incorrect canvas, missing frames, duplicates and mismatched feature flags', () => {
    const frame = aiAttachmentImageFixture('webp').subarray(12);
    const lossless = aiAttachmentImageFixture('webp-lossless').subarray(12);
    for (const image of [
      webp(webpExtended(0, 4, 2), frame),
      webp(webpExtended()),
      webp(webpExtended(), frame, frame),
      webp(webpExtended(), frame, lossless),
      webp(webpExtended(), webpExtended(), frame),
      webp(webpExtended(16), frame),
      webp(webpExtended(32), frame),
      webp(webpExtended(), webpChunk('ICCP', Buffer.from([1])), frame),
      webp(webpExtended(32), frame, webpChunk('ICCP', Buffer.from([1]))),
      webp(
        webpExtended(8),
        frame,
        webpChunk('EXIF', Buffer.from([1])),
        webpChunk('EXIF', Buffer.from([2])),
      ),
      webp(frame, webpChunk('EXIF', Buffer.from([1]))),
    ])
      invalid(image, 'image.webp');
  });

  it('rejects invalid frame tags, version bits and partition lengths', () => {
    const mutations: ((bytes: Buffer) => void)[] = [
      (bytes) => {
        bytes[20] |= 1;
      },
      (bytes) => {
        bytes[20] &= ~16;
      },
      (bytes) => {
        bytes[20] |= 8;
      },
      (bytes) => {
        bytes[23] = 0;
      },
      (bytes) => bytes.writeUIntLE(0xfffff0, 20, 3),
      (bytes) => bytes.writeUInt16LE(0, 26),
    ];
    for (const change of mutations) {
      const bytes = aiAttachmentImageFixture('webp');
      change(bytes);
      invalid(
        bytes,
        'image.webp',
        bytes.readUInt16LE(26) === 0
          ? 'ai_attachment_image_dimensions_invalid'
          : 'ai_attachment_image_invalid',
      );
    }
    const lossless = aiAttachmentImageFixture('webp-lossless');
    lossless[24] |= 0x20;
    invalid(lossless, 'image.webp');
  });

  it('rejects length overflow, nonzero padding and illegal reserved fields', () => {
    const frame = aiAttachmentImageFixture('webp').subarray(12);
    const truncated = aiAttachmentImageFixture('webp');
    truncated.writeUInt32LE(0xffffffff, 16);
    invalid(truncated, 'image.webp');
    const wrongRiff = aiAttachmentImageFixture('webp');
    wrongRiff.writeUInt32LE(wrongRiff.length, 4);
    invalid(wrongRiff, 'image.webp');
    const padded = webp(webpExtended(), frame, webpChunk('TEST', Buffer.from([1])));
    padded[padded.length - 1] = 1;
    invalid(padded, 'image.webp');
    for (const position of [20, 21, 22, 23]) {
      const reserved = webp(webpExtended(), frame);
      reserved[position] = 1;
      invalid(reserved, 'image.webp');
    }
  });

  it('checks ALPH placement, flags, method and raw plane length', () => {
    const frame = aiAttachmentImageFixture('webp').subarray(12);
    const plane = webpChunk('ALPH', Buffer.from([0, 255, 70, 255, 255, 255, 255]));
    expect(validateAiAttachment(webp(webpExtended(16), plane, frame), 'image.webp').width).toBe(3);
    for (const image of [
      webp(webpExtended(), plane, frame),
      webp(webpExtended(16), frame, plane),
      webp(webpExtended(16), plane, plane, frame),
      webp(webpExtended(16), webpChunk('ALPH', Buffer.from([0, 255])), frame),
      webp(webpExtended(16), webpChunk('ALPH', Buffer.from([2, 255])), frame),
      webp(webpExtended(16), webpChunk('ALPH', Buffer.from([0x20, 255])), frame),
      webp(webpExtended(16), webpChunk('ALPH', Buffer.from([0x40, 255])), frame),
      webp(webpExtended(16), plane, aiAttachmentImageFixture('webp-alpha-lossless').subarray(12)),
    ])
      invalid(image, 'image.webp');
  });
});
