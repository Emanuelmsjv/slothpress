import { useEffect, useRef } from 'react';
import { renderCard, type RenderResult } from '../lib/render';
import type { StyleMetadata } from '../lib/style';

interface CardPreviewProps {
  content: string;
  author: string;
  style: StyleMetadata;
  onRendered?: (result: RenderResult) => void;
}

export function CardPreview({ content, author, style, onRendered }: CardPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const callbackRef = useRef(onRendered);

  callbackRef.current = onRendered;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const frame = requestAnimationFrame(() => {
      try {
        const result = renderCard(canvas, { content, author, style }, 1);
        callbackRef.current?.(result);
      } catch (error) {
        console.error('Slothpress could not draw the preview.', error);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [content, author, style]);

  return (
    <div className="preview-frame">
      <canvas
        ref={canvasRef}
        className="preview-canvas"
        width={1080}
        height={1350}
        aria-label="Preview of the quote card"
      />
    </div>
  );
}
