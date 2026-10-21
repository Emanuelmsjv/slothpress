/**
 * Local persistence.
 *
 * The whole point of Slothpress is that there is no account and no server, so
 * the only place a draft can live is this browser. Everything read back is
 * validated, because localStorage is exactly the kind of thing that can be
 * half-written, hand-edited, or left over from an older version of the app.
 */

const STORAGE_KEY = 'slothpress.draft.v1';

export interface Draft {
  content: string;
  author: string;
  style: unknown;
}

export function saveDraft(draft: Draft): void {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ content: draft.content, author: draft.author, style: draft.style }),
    );
  } catch {
    // A full or disabled localStorage is not worth interrupting the user for.
  }
}

export function loadDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return {
      content: typeof parsed.content === 'string' ? parsed.content : '',
      author: typeof parsed.author === 'string' ? parsed.author : '',
      style: parsed.style,
    };
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
