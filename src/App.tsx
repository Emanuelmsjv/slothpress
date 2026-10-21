import { useCallback, useEffect, useMemo, useState } from 'react';
import { CardPreview } from './components/CardPreview';
import { Editor } from './components/Editor';
import { ExportBar } from './components/ExportBar';
import { StylePicker } from './components/StylePicker';
import type { RenderResult } from './lib/render';
import { DEFAULT_STYLE, normalizeStyle, type StyleMetadata } from './lib/style';
import { clearDraft, loadDraft, saveDraft } from './lib/storage';

export function App() {
  const initial = useMemo(() => {
    const draft = loadDraft();
    return {
      content: draft?.content ?? '',
      author: draft?.author ?? '',
      style: normalizeStyle(draft?.style ?? DEFAULT_STYLE),
    };
  }, []);

  const [content, setContent] = useState(initial.content);
  const [author, setAuthor] = useState(initial.author);
  const [style, setStyle] = useState<StyleMetadata>(initial.style);
  const [rendered, setRendered] = useState<RenderResult | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDraft({ content, author, style });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [content, author, style]);

  const handleRendered = useCallback((result: RenderResult) => setRendered(result), []);

  const reset = () => {
    if (content.trim() && !window.confirm('Clear the text and the style?')) return;
    setContent('');
    setAuthor('');
    setStyle(DEFAULT_STYLE);
    clearDraft();
  };

  const shrunk = rendered ? style.font_size - rendered.fontSize : 0;

  return (
    <div className="app">
      <header className="app-head">
        <div className="brand">
          <img src="./icon.svg" alt="" width={36} height={36} />
          <div>
            <h1>Slothpress</h1>
            <p>Quote cards, typeset entirely in your browser.</p>
          </div>
        </div>
        <button type="button" className="button ghost" onClick={reset}>
          Reset
        </button>
      </header>

      <main className="layout">
        <div className="controls">
          <Editor
            content={content}
            author={author}
            onContentChange={setContent}
            onAuthorChange={setAuthor}
          />
          <StylePicker style={style} onChange={setStyle} text={content} />
        </div>

        <div className="preview">
          <CardPreview content={content} author={author} style={style} onRendered={handleRendered} />

          {rendered ? (
            <div className="metrics">
              <span>
                {rendered.fontSize}px {shrunk > 0 ? <em>auto-fitted down from {style.font_size}px</em> : null}
              </span>
              <span>{rendered.lines.length} lines</span>
              <span>{rendered.renderMs.toFixed(1)}ms</span>
            </div>
          ) : null}

          {rendered?.overflow ? (
            <p className="warning">
              This text is too long for the card even at the smallest size. Shorten it, or raise the margin
              and lower the largest size.
            </p>
          ) : null}

          <ExportBar content={content} author={author} style={style} />
        </div>
      </main>

      <footer className="app-foot">
        <p>
          No account, no upload, no server. The card is drawn on your device and never leaves it.
        </p>
      </footer>
    </div>
  );
}
