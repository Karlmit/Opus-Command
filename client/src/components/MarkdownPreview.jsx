import { useMemo } from 'react';
import './MarkdownPreview.css';

// Small hand-rolled Markdown → React renderer (no external dependency, same
// spirit as SyntaxHighlightedEditor's regex-based highlighter). Covers the
// common GitHub-flavored subset: headings, emphasis, code (inline/fenced),
// links, images, lists (ordered/unordered/task), blockquotes, rules, tables.

// Inline-level parsing: returns an array of React nodes/strings.
function renderInline(text, keyPrefix) {
  const nodes = [];
  let rest = text;
  let index = 0;

  const patterns = [
    { type: 'code', re: /^`([^`]+)`/ },
    { type: 'image', re: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
    { type: 'link', re: /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/ },
    { type: 'bold', re: /^\*\*([^*]+)\*\*/ },
    { type: 'bold', re: /^__([^_]+)__/ },
    { type: 'italic', re: /^\*([^*]+)\*/ },
    { type: 'italic', re: /^_([^_]+)_/ },
    { type: 'strike', re: /^~~([^~]+)~~/ },
  ];

  while (rest.length) {
    let matched = false;
    for (const { type, re } of patterns) {
      const m = rest.match(re);
      if (!m) continue;
      matched = true;
      const key = `${keyPrefix}-${index++}`;
      if (type === 'code') nodes.push(<code key={key} className="md-code-inline">{m[1]}</code>);
      else if (type === 'image') nodes.push(<img key={key} src={m[2]} alt={m[1]} className="md-image" />);
      else if (type === 'link') nodes.push(<a key={key} href={m[2]} target="_blank" rel="noreferrer">{renderInline(m[1], key)}</a>);
      else if (type === 'bold') nodes.push(<strong key={key}>{renderInline(m[1], key)}</strong>);
      else if (type === 'italic') nodes.push(<em key={key}>{renderInline(m[1], key)}</em>);
      else if (type === 'strike') nodes.push(<del key={key}>{renderInline(m[1], key)}</del>);
      rest = rest.slice(m[0].length);
      break;
    }
    if (!matched) {
      // Consume one plain character (or run up to the next special char) at a time.
      const next = rest.search(/[`!\[\*_~]/);
      const chunkLen = next === -1 ? rest.length : (next === 0 ? 1 : next);
      const chunk = rest.slice(0, chunkLen);
      const last = nodes[nodes.length - 1];
      if (typeof last === 'string') nodes[nodes.length - 1] = last + chunk;
      else nodes.push(chunk);
      rest = rest.slice(chunkLen);
    }
  }
  return nodes;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && /-/.test(line);
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map(cell => cell.trim());
}

function renderBlocks(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  function flushList(items, ordered) {
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={key++} className="md-list">
        {items.map((item, idx) => (
          <li key={idx} className={item.checked !== undefined ? 'md-task-item' : undefined}>
            {item.checked !== undefined && (
              <input type="checkbox" checked={item.checked} readOnly disabled />
            )}
            {renderInline(item.text, `li-${key}-${idx}`)}
          </li>
        ))}
      </Tag>
    );
  }

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    // Fenced code block
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1];
      const codeLines = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(lines[i]); i += 1; }
      i += 1; // skip closing fence
      blocks.push(
        <pre key={key++} className="md-code-block">
          <code className={lang ? `md-lang-${lang}` : undefined}>{codeLines.join('\n')}</code>
        </pre>
      );
      continue;
    }

    // Heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}`;
      blocks.push(<Tag key={key++} className="md-heading">{renderInline(heading[2].trim(), `h-${key}`)}</Tag>);
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="md-rule" />);
      i += 1;
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(<blockquote key={key++} className="md-quote">{renderBlocks(quoteLines.join('\n'))}</blockquote>);
      continue;
    }

    // Table
    if (line.includes('|') && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key++} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{headerCells.map((c, idx) => <th key={idx}>{renderInline(c, `th-${key}-${idx}`)}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, ridx) => (
                <tr key={ridx}>{row.map((c, cidx) => <td key={cidx}>{renderInline(c, `td-${key}-${ridx}-${cidx}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Task / unordered / ordered lists
    const taskMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    const bulletMatch = !taskMatch && line.match(/^\s*[-*+]\s+(.*)$/);
    const orderedMatch = !taskMatch && !bulletMatch && line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (taskMatch || bulletMatch || orderedMatch) {
      const ordered = !!orderedMatch;
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        const t = l.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
        const b = !t && l.match(/^\s*[-*+]\s+(.*)$/);
        const o = !t && !b && l.match(/^\s*\d+[.)]\s+(.*)$/);
        if (ordered && o) items.push({ text: o[1] });
        else if (!ordered && t) items.push({ text: t[2], checked: /x/i.test(t[1]) });
        else if (!ordered && b) items.push({ text: b[1] });
        else break;
        i += 1;
      }
      flushList(items, ordered);
      continue;
    }

    // Paragraph — gather contiguous non-blank, non-block lines
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s|^```|^\s*>|^\s*(?:---+|\*\*\*+|___+)\s*$|^\s*[-*+]\s+|^\s*\d+[.)]\s+/.test(lines[i])) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length) {
      blocks.push(<p key={key++} className="md-paragraph">{renderInline(paraLines.join(' ').trim(), `p-${key}`)}</p>);
    } else {
      // Fallback safety: avoid infinite loop on an unhandled line shape.
      blocks.push(<p key={key++} className="md-paragraph">{renderInline(line, `p-${key}`)}</p>);
      i += 1;
    }
  }

  return blocks;
}

export default function MarkdownPreview({ value, className = '' }) {
  const content = useMemo(() => renderBlocks(value || ''), [value]);
  return <div className={`md-preview ${className}`}>{content}</div>;
}
