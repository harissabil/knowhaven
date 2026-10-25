// Document mentions inside a chat message.
// In the input the user sees plain "@Title"; the message sent to (and stored by) the backend carries
// "@[Title](DOC-id)" so the tag survives in history. The backend turns it back into "@Title" for the
// model and fetches the document by id under the user's permissions.

export interface Mention { id: string; title: string }

const MARKUP = /@\[([^\]\n]{1,200})\]\(([A-Za-z0-9#._:-]{1,200})\)/g;

export type Segment = { kind: "text"; text: string } | { kind: "mention"; id: string; title: string };

/** "@Title" → "@[Title](id)" for every mention still present in the text (longest titles first). */
export function toMarkup(text: string, mentions: Mention[]): string {
  let out = text;
  for (const m of [...mentions].sort((a, b) => b.title.length - a.title.length)) {
    out = out.split(`@${m.title}`).join(`@[${m.title}](${m.id})`);
  }
  return out;
}

export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index) });
    out.push({ kind: "mention", title: m[1], id: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** "@[Title](id)" → "@Title" (what a reader or the model should see). */
export function plain(text: string): string {
  return text.replace(MARKUP, (_, title) => `@${title}`);
}

/** Mentions whose "@Title" token is still in the text (the user may have deleted some). */
export function present(text: string, mentions: Mention[]): Mention[] {
  return mentions.filter((m) => text.includes(`@${m.title}`));
}
