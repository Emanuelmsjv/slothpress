import { useEffect, useRef } from 'react';

interface EditorProps {
  content: string;
  author: string;
  onContentChange: (value: string) => void;
  onAuthorChange: (value: string) => void;
}

const MAX_CHARACTERS = 600;

export function Editor({ content, author, onContentChange, onAuthorChange }: EditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 420)}px`;
  }, [content]);

  const remaining = MAX_CHARACTERS - content.length;

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Words</h2>
        <span className={remaining < 0 ? 'counter counter-over' : 'counter'}>
          {content.length} / {MAX_CHARACTERS}
        </span>
      </header>

      <label className="field">
        <span className="field-label">Quote</span>
        <textarea
          ref={textareaRef}
          className="textarea"
          value={content}
          spellCheck
          placeholder={'Type or paste the words.\nBlank lines are kept.'}
          onChange={(event) => onContentChange(event.target.value)}
        />
      </label>

      <label className="field">
        <span className="field-label">Attribution</span>
        <input
          className="input"
          type="text"
          value={author}
          placeholder="Who said it"
          onChange={(event) => onAuthorChange(event.target.value)}
        />
      </label>
    </section>
  );
}
