/**
 * Word-level diffing inside one before/after pair.
 *
 * The API's change list gives whole strings, and most tailoring edits move a
 * handful of words inside a sentence that is otherwise identical. Highlighting
 * the whole line as "removed" and the whole line as "added" makes the reviewer
 * re-read both to find the actual edit; marking the differing runs turns that
 * into a glance. This is presentation only — the strings themselves are shown
 * verbatim, never reconstructed from the tokens.
 */

export interface DiffSpan {
  text: string;
  /** True when this run does not appear in the other side of the pair. */
  changed: boolean;
}

export interface WordDiff {
  before: DiffSpan[];
  after: DiffSpan[];
}

/**
 * Above this, the O(n·m) table stops being worth its memory and the highlight
 * stops being readable anyway. Callers fall back to plain text.
 */
const MAX_TOKENS = 320;

/** Words and the whitespace between them, so joins reproduce the input exactly. */
function tokenize(value: string): string[] {
  return value.match(/\s+|\S+/g) ?? [];
}

/** Collapse neighbouring runs with the same flag into one span. */
function coalesce(tokens: string[], changed: boolean[]): DiffSpan[] {
  const spans: DiffSpan[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const last = spans[spans.length - 1];
    if (last && last.changed === changed[index]) {
      last.text += tokens[index];
    } else {
      spans.push({ text: tokens[index], changed: changed[index] });
    }
  }
  return spans;
}

/**
 * Longest-common-subsequence diff over word tokens.
 *
 * Returns null when either side is empty or too long to diff usefully; the
 * caller then renders the strings plainly, which is always correct — the
 * highlight is an aid, never the source of truth.
 */
export function wordDiff(before: string, after: string): WordDiff | null {
  const beforeTokens = tokenize(before);
  const afterTokens = tokenize(after);

  if (beforeTokens.length === 0 || afterTokens.length === 0) return null;
  if (beforeTokens.length > MAX_TOKENS || afterTokens.length > MAX_TOKENS) {
    return null;
  }

  const rows = beforeTokens.length;
  const columns = afterTokens.length;
  const width = columns + 1;
  const table = new Int32Array((rows + 1) * width);

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        beforeTokens[i] === afterTokens[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }

  const beforeChanged = new Array<boolean>(rows).fill(true);
  const afterChanged = new Array<boolean>(columns).fill(true);

  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (beforeTokens[i] === afterTokens[j]) {
      beforeChanged[i] = false;
      afterChanged[j] = false;
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return {
    before: coalesce(beforeTokens, beforeChanged),
    after: coalesce(afterTokens, afterChanged),
  };
}
