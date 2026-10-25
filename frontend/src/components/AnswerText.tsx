"use client";
// Renders Havi's answer: paragraphs, "- " / "1. " lists, **bold**, and source ids in square brackets
// ("[DOC-sop-cuti#2]") as small numbered markers that match the numbered source chips below the answer.
import { Fragment, type ReactNode } from "react";

const ID = String.raw`(?:CHAT|DOC|TASK|COMPANY)-[^\[\]\s,;]+`;
const CITE = new RegExp(String.raw`\[(${ID}(?:[,;\s]+${ID})*)\]`, "g");
const CITE_TOKEN = new RegExp(String.raw`^\[${ID}(?:[,;\s]+${ID})*\]$`);
const INLINE = new RegExp(String.raw`(\*\*[^*\n]+\*\*|\[${ID}(?:[,;\s]+${ID})*\])`, "g");
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,2})[.)]\s+(.*)$/;
// While streaming, a citation may be cut in half ("... [DOC-sop-cu"): hide it until it closes.
const OPEN_TAIL = /\s*\[(?:[A-Z]{0,7}(?:-[^\]\n]*)?)?$/;

/** Source ids in order of first appearance: the same order the backend numbers its citations. */
export function citationOrder(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CITE)) {
    for (const id of m[1].split(/[,;\s]+/)) if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

type Props = {
  text: string;
  /** Ids of the source chips shown under the answer, in their numbered order. */
  sources?: string[];
  onOpen?: (id: string) => void;
};

export function AnswerText({ text, sources, onOpen }: Props) {
  const clean = text.replace(OPEN_TAIL, "");
  const order = sources && sources.length ? sources : citationOrder(clean);
  const numberOf = (id: string) => {
    const i = order.indexOf(id);
    return i >= 0 ? i + 1 : order.indexOf(id.split("#")[0]) + 1 || null;
  };

  const inline = (line: string): ReactNode[] =>
    line.replace(/\s+(?=\[(?:CHAT|DOC|TASK|COMPANY)-)/g, "").split(INLINE).map((part, k) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <b key={k}>{part.slice(2, -2)}</b>;
      if (CITE_TOKEN.test(part)) {
        const ids = part.slice(1, -1).split(/[,;\s]+/).filter(Boolean);
        return (
          <Fragment key={k}>
            {ids.map((id) => {
              const n = numberOf(id);
              return (
                <sup key={id} className="ml-0.5">
                  <button type="button" onClick={() => onOpen?.(id)} title={id}
                    className="inline-grid place-items-center min-w-[1.15rem] h-[1.15rem] px-1 rounded-full bg-tint text-brand text-[0.68rem] font-semibold leading-none hover:bg-brand hover:text-brand-fg transition-colors align-super">
                    {n ?? "•"}
                  </button>
                </sup>
              );
            })}
          </Fragment>
        );
      }
      return <Fragment key={k}>{part}</Fragment>;
    });

  // Group lines into paragraphs and lists.
  const blocks: ReactNode[] = [];
  let list: { kind: "ul" | "ol"; start: number; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, k) => <li key={k} className="pl-1">{inline(it)}</li>);
    blocks.push(list.kind === "ul"
      ? <ul key={blocks.length} className="list-disc pl-5 flex flex-col gap-1 marker:text-muted">{items}</ul>
      : <ol key={blocks.length} start={list.start} className="list-decimal pl-5 flex flex-col gap-1 marker:text-muted">{items}</ol>);
    list = null;
  };
  for (const raw of clean.split("\n")) {
    const b = raw.match(BULLET);
    const n = raw.match(NUMBERED);
    if (b || n) {
      const kind = b ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        flush();
        list = { kind, start: n ? Number(n[1]) : 1, items: [] };
      }
      list.items.push(b ? b[1] : n![2]);
      continue;
    }
    flush();
    if (raw.trim()) blocks.push(<p key={blocks.length}>{inline(raw)}</p>);
  }
  flush();

  return <div className="flex flex-col gap-2">{blocks}</div>;
}
