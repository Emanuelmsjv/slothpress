import { describe, expect, it } from 'vitest';
import { canvasToBlob, safeFilename } from '../src/lib/export';

function canvasReturning(type: string): HTMLCanvasElement {
  return {
    toBlob: (callback: BlobCallback) => callback(new Blob(['card'], { type })),
  } as unknown as HTMLCanvasElement;
}

describe('canvasToBlob', () => {
  it('returns the blob when the browser encodes the requested type', async () => {
    const blob = await canvasToBlob(canvasReturning('image/png'), 'image/png');
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('fails loudly when the browser silently falls back to another format', async () => {
    await expect(canvasToBlob(canvasReturning('image/png'), 'image/jpeg')).rejects.toThrow(/cannot encode JPEG/i);
  });

  it('fails loudly when the browser refuses to encode at all', async () => {
    const canvas = {
      toBlob: (callback: BlobCallback) => callback(null),
    } as unknown as HTMLCanvasElement;
    await expect(canvasToBlob(canvas, 'image/png')).rejects.toThrow(/refused/i);
  });
});

describe('safeFilename', () => {
  it('slugifies the card text', () => {
    expect(safeFilename('Hello, world!', 'png')).toBe('hello-world.png');
  });

  it('falls back when there is nothing usable', () => {
    expect(safeFilename('!!!', 'png')).toBe('card.png');
    expect(safeFilename('', 'png')).toBe('card.png');
  });

  it('keeps the name short', () => {
    const name = safeFilename('a'.repeat(200), 'png');
    expect(name.length).toBeLessThanOrEqual(52);
  });
});
