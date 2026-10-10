import {
  DocumentImageTooLargeException,
  UnsupportedDocumentImageException,
} from './exceptions/onboarding.exceptions.js';

export const MAX_DOCUMENT_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageFormat = 'jpeg' | 'png' | 'webp';

export interface DocumentImage {
  content: Uint8Array;
  format: ImageFormat;
}

const startsWith = (content: Uint8Array, bytes: number[], offset = 0) =>
  bytes.every((byte, index) => content[offset + index] === byte);

function detectFormat(content: Uint8Array): ImageFormat | null {
  if (startsWith(content, [0xff, 0xd8, 0xff])) {
    return 'jpeg';
  }
  if (startsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  // "RIFF" <size> "WEBP"
  if (startsWith(content, [0x52, 0x49, 0x46, 0x46]) && startsWith(content, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  return null;
}

/**
 * Validates an uploaded document photo by its leading bytes, never by the
 * client-supplied file name or MIME type, which an attacker controls.
 */
export function inspectDocumentImage(content: Uint8Array | undefined): DocumentImage {
  if (!content || content.length === 0) {
    throw new UnsupportedDocumentImageException();
  }
  if (content.length > MAX_DOCUMENT_IMAGE_BYTES) {
    throw new DocumentImageTooLargeException();
  }
  const format = detectFormat(content);
  if (!format) {
    throw new UnsupportedDocumentImageException();
  }
  return { content, format };
}
