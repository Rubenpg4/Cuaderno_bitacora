import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Attachment } from '../../shared/model.js';

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENTS_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export const attachmentInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(240),
    mime: z.string().max(100),
    size: z.number().int().nonnegative().optional(),
    data: z
      .string()
      .max(Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 8)
      .optional(),
    text: z.string().max(MAX_ATTACHMENT_BYTES).optional(),
  })
  .strict();

const formats = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'text/markdown': '.md',
  'application/pdf': '.pdf',
} as const;

function matchesContent(mime: string, bytes: Buffer) {
  if (mime === 'image/png')
    return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (mime === 'image/jpeg') return bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'));
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
  if (mime === 'image/webp')
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (mime === 'application/pdf') return bytes.toString('ascii', 0, 5) === '%PDF-';
  if (mime === 'text/markdown') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function normalizeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS)
    throw Error('Se admiten hasta diez adjuntos por registro.');
  const ids = new Set<string>();
  let total = 0;
  return value.map((raw) => {
    const input = attachmentInputSchema.parse(raw);
    const extension = formats[input.mime as keyof typeof formats];
    if (!extension || /[\\/\x00-\x1f]/.test(input.name))
      throw Error('Nombre o tipo de adjunto inválido.');
    const lower = input.name.toLowerCase();
    if (!lower.endsWith(extension) && !(input.mime === 'image/jpeg' && lower.endsWith('.jpeg')))
      throw Error('La extensión del adjunto no coincide con su tipo.');
    if ((input.data === undefined) === (input.text === undefined))
      throw Error('Indica el contenido del adjunto una sola vez.');
    if (input.text !== undefined && input.mime !== 'text/markdown')
      throw Error('Solo Markdown admite contenido de texto.');
    const bytes =
      input.text !== undefined
        ? Buffer.from(input.text, 'utf8')
        : Buffer.from(input.data!, 'base64');
    if (input.data !== undefined && bytes.toString('base64') !== input.data)
      throw Error('El contenido del adjunto debe estar en Base64 válido.');
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES || !matchesContent(input.mime, bytes))
      throw Error('Adjunto vacío, demasiado grande o de formato inválido.');
    total += bytes.length;
    if (total > MAX_ATTACHMENTS_BYTES) throw Error('Los adjuntos superan 8 MiB en total.');
    if (input.size !== undefined && input.size !== bytes.length)
      throw Error('El tamaño del adjunto no coincide con su contenido.');
    const id = input.id ?? randomUUID();
    if (ids.has(id)) throw Error('Adjunto duplicado.');
    ids.add(id);
    return {
      id,
      name: input.name,
      mime: input.mime,
      size: bytes.length,
      data: bytes.toString('base64'),
    };
  });
}
