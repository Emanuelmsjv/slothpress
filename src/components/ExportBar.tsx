import { useState } from 'react';
import { canShareFiles, canvasToBlob, downloadBlob, shareBlob, safeFilename } from '../lib/export';
import { renderExportCanvas } from '../lib/render';
import type { StyleMetadata } from '../lib/style';

interface ExportBarProps {
  content: string;
  author: string;
  style: StyleMetadata;
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

export function ExportBar({ content, author, style }: ExportBarProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const shareAvailable = canShareFiles();

  const render = () => renderExportCanvas({ content, author, style }, 2);

  const download = async (type: 'image/png' | 'image/jpeg') => {
    setStatus({ kind: 'busy' });
    try {
      const canvas = render();
      const blob = await canvasToBlob(canvas, type);
      const extension = type === 'image/png' ? 'png' : 'jpg';
      downloadBlob(blob, safeFilename(content, extension));
      setStatus({ kind: 'done', message: `Saved ${canvas.width} x ${canvas.height} ${extension.toUpperCase()}.` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Export failed.' });
    }
  };

  const share = async () => {
    setStatus({ kind: 'busy' });
    try {
      const canvas = render();
      const blob = await canvasToBlob(canvas, 'image/png');
      await shareBlob(blob, safeFilename(content, 'png'), content.slice(0, 80));
      setStatus({ kind: 'done', message: 'Shared.' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Sharing failed.' });
    }
  };

  return (
    <div className="export-bar">
      <div className="export-buttons">
        <button type="button" className="button primary" onClick={() => void download('image/png')}>
          Download PNG
        </button>
        <button type="button" className="button" onClick={() => void download('image/jpeg')}>
          JPEG
        </button>
        {shareAvailable ? (
          <button type="button" className="button" onClick={() => void share()}>
            Share
          </button>
        ) : null}
      </div>

      <p className="export-note">
        Exports at 2160 x 2700. Everything is drawn on this device; nothing is uploaded.
      </p>

      {status.kind !== 'idle' ? (
        <p className={status.kind === 'error' ? 'export-status error' : 'export-status'}>
          {status.kind === 'busy' ? 'Working...' : status.message}
        </p>
      ) : null}
    </div>
  );
}
