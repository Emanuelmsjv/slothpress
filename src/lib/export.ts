/**
 * Getting the card out of the browser.
 *
 * One trap lives here: `canvas.toBlob` silently falls back to PNG when the
 * requested type is not supported, and the only way to notice is to read
 * `blob.type`. A "JPEG export" that quietly hands back a PNG is the kind of
 * bug that only shows up after it has already been posted somewhere.
 */

export type ImageFormat = 'image/png' | 'image/jpeg';

export const FORMAT_LABELS: Record<ImageFormat, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
};

export async function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: ImageFormat,
  quality = 0.92,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });

  if (!blob) throw new Error('The browser refused to encode the card.');
  if (blob.type !== type) {
    throw new Error(
      `This browser cannot encode ${FORMAT_LABELS[type]} images (it produced ${blob.type}).`,
    );
  }
  return blob;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** True when this browser can share files through the native share sheet. */
export function canShareFiles(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([new Blob()], 'probe.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export async function shareBlob(blob: Blob, filename: string, title?: string): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    throw new Error('Sharing is not available on this browser.');
  }

  const file = new File([blob], filename, { type: blob.type });
  if (typeof navigator.canShare === 'function' && !navigator.canShare({ files: [file] })) {
    throw new Error('This browser cannot share image files.');
  }

  await navigator.share({ files: [file], title: title ?? filename });
}

/** A filesystem-safe filename derived from the card's own words. */
export function safeFilename(text: string, extension: string): string {
  const slug = (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'card'}.${extension}`;
}
