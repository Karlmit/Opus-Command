import { useMemo, useRef, useState } from 'react';
import './SyntaxHighlightedEditor.css';

const LANGUAGE_BY_EXT = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'javascript', tsx: 'javascript',
  py: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'shell',
  css: 'css', scss: 'css', sass: 'css',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown', mdx: 'markdown',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  java: 'java',
  c: 'c', cpp: 'c', h: 'c', hpp: 'c',
  toml: 'toml', ini: 'toml', env: 'shell',
};

const KEYWORDS = {
  javascript: /\b(?:abstract|as|async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|instanceof|interface|let|new|of|private|protected|public|return|set|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|true|false|null|undefined)\b/,
  python: /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b/,
  shell: /\b(?:case|do|done|elif|else|esac|fi|for|function|if|in|select|then|until|while|export|local|readonly|return|set|unset|true|false)\b/,
  sql: /\b(?:ADD|ALTER|AND|AS|ASC|BETWEEN|BY|CASE|CREATE|DELETE|DESC|DISTINCT|DROP|ELSE|EXISTS|FROM|GROUP|HAVING|IN|INDEX|INSERT|INTO|IS|JOIN|KEY|LIKE|LIMIT|NOT|NULL|ON|OR|ORDER|PRIMARY|SELECT|SET|TABLE|THEN|UPDATE|VALUES|WHEN|WHERE)\b/i,
  go: /\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|true|false|nil)\b/,
  rust: /\b(?:as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while)\b/,
  ruby: /\b(?:BEGIN|END|alias|and|begin|break|case|class|def|defined|do|else|elsif|end|ensure|false|for|if|in|module|next|nil|not|or|redo|rescue|retry|return|self|super|then|true|undef|unless|until|when|while|yield)\b/,
  php: /\b(?:abstract|and|array|as|break|callable|case|catch|class|clone|const|continue|declare|default|die|do|echo|else|elseif|empty|enddeclare|endfor|endforeach|endif|endswitch|endwhile|eval|exit|extends|final|finally|fn|for|foreach|function|global|if|implements|include|include_once|instanceof|interface|isset|list|namespace|new|or|print|private|protected|public|require|require_once|return|static|switch|throw|trait|try|unset|use|var|while|xor|yield|true|false|null)\b/,
  java: /\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|true|false|null)\b/,
  c: /\b(?:auto|bool|break|case|char|class|const|continue|default|delete|do|double|else|enum|extern|false|float|for|if|inline|int|long|namespace|new|nullptr|private|protected|public|return|short|signed|sizeof|static|struct|switch|template|this|true|typedef|typename|union|unsigned|using|void|volatile|while)\b/,
};

function languageForFile(fileName = '') {
  const lower = fileName.toLowerCase();
  const base = lower.split('/').pop();
  if (base === '.gitignore' || base === '.env' || base?.startsWith('.env.')) return 'shell';
  const ext = base?.includes('.') ? base.split('.').pop() : base;
  return LANGUAGE_BY_EXT[ext] || 'plain';
}

function token(type, pattern) {
  return { type, pattern: new RegExp(`^(?:${pattern.source})`, pattern.flags.replace('g', '')) };
}

function patternsFor(language) {
  if (language === 'json') {
    return [
      token('key', /"(?:\\.|[^"\\])*"(?=\s*:)/),
      token('string', /"(?:\\.|[^"\\])*"/),
      token('number', /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i),
      token('keyword', /\b(?:true|false|null)\b/),
    ];
  }

  if (language === 'yaml' || language === 'toml') {
    return [
      token('comment', /#.*/),
      token('key', /[A-Za-z0-9_.-]+(?=\s*[:=])/),
      token('string', /"(?:\\.|[^"\\])*"|'(?:''|[^'])*'/),
      token('number', /-?\b\d+(?:\.\d+)?\b/),
      token('keyword', /\b(?:true|false|null|yes|no|on|off)\b/i),
    ];
  }

  if (language === 'css') {
    return [
      token('comment', /\/\*.*?\*\//),
      token('string', /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/),
      token('keyword', /@[A-Za-z-]+/),
      token('number', /#[0-9a-f]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms|deg)?\b/i),
      token('key', /--?[A-Za-z_][\w-]*(?=\s*:)/),
      token('function', /[A-Za-z_][\w-]*(?=\()/),
    ];
  }

  if (language === 'markup') {
    return [
      token('comment', /<!--.*?-->/),
      token('tag', /<\/?[A-Za-z][\w:-]*/),
      token('key', /[A-Za-z_:][\w:.-]*(?=\=)/),
      token('string', /"(?:&quot;|[^"])*"|'(?:&apos;|[^'])*'/),
      token('punctuation', /\/?>/),
    ];
  }

  if (language === 'markdown') {
    return [
      token('comment', /^#{1,6}\s.*$/),
      token('string', /`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*/),
      token('keyword', /^\s*(?:[-*+]|\d+\.)\s/),
      token('tag', /\[[^\]]+\]\([^)]+\)/),
    ];
  }

  const keyword = KEYWORDS[language];
  const common = [
    token('comment', /\/\/.*|#.*|--.*/),
    token('comment', /\/\*.*?\*\//),
    token('string', /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/),
    token('number', /-?\b(?:0x[\da-f]+|\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?\b/),
    token('variable', /\$[A-Za-z_][\w]*/),
    token('function', /[A-Za-z_$][\w$]*(?=\s*\()/),
  ];
  if (keyword) common.splice(2, 0, token('keyword', keyword));
  return common;
}

function highlightLine(line, language, lineIndex) {
  if (!line) return '\u00a0';

  const patterns = patternsFor(language);
  const nodes = [];
  let index = 0;
  let plain = '';

  function flushPlain() {
    if (plain) {
      nodes.push(plain);
      plain = '';
    }
  }

  while (index < line.length) {
    const rest = line.slice(index);
    const match = patterns.find(({ pattern }) => pattern.test(rest));

    if (!match) {
      plain += line[index];
      index += 1;
      continue;
    }

    const value = rest.match(match.pattern)[0];
    flushPlain();
    nodes.push(
      <span key={`${lineIndex}-${index}-${match.type}`} className={`syntax-token syntax-${match.type}`}>
        {value}
      </span>
    );
    index += value.length;
  }

  flushPlain();
  return nodes.length ? nodes : '\u00a0';
}

function getLineNumber(value, position) {
  return value.slice(0, position).split('\n').length;
}

function getSelectedLines(value, selectionStart, selectionEnd) {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const firstLine = getLineNumber(value, start);
  const lastLine = getLineNumber(value, end);
  const lines = new Set();

  for (let line = firstLine; line <= lastLine; line += 1) {
    lines.add(line);
  }

  return lines;
}

function HighlightedCode({ value, fileName, selectedLines }) {
  const language = languageForFile(fileName);
  const lines = value.split('\n');

  return lines.map((line, index) => (
    <span
      className={`syntax-line${selectedLines.has(index + 1) ? ' is-selected' : ''}`}
      key={index}
    >
      <span className="syntax-line-number" aria-hidden="true">{index + 1}</span>
      <span className="syntax-line-code">{highlightLine(line, language, index)}</span>
    </span>
  ));
}

export default function SyntaxHighlightedEditor({
  value,
  onChange,
  fileName,
  className = '',
  textareaClassName = '',
  onKeyDown,
  spellCheck = false,
}) {
  const highlightRef = useRef(null);
  const [selectedLines, setSelectedLines] = useState(() => new Set([1]));
  const textValue = value || '';
  const lineCount = textValue.split('\n').length;
  const lineNumberDigits = Math.max(2, String(lineCount).length);
  const highlighted = useMemo(() => (
    <HighlightedCode value={textValue} fileName={fileName} selectedLines={selectedLines} />
  ), [textValue, fileName, selectedLines]);

  function updateSelectedLines(target) {
    setSelectedLines(getSelectedLines(target.value || '', target.selectionStart || 0, target.selectionEnd || 0));
  }

  function handleScroll(e) {
    const highlighter = highlightRef.current;
    if (!highlighter) return;
    highlighter.scrollTop = e.currentTarget.scrollTop;
    highlighter.scrollLeft = e.currentTarget.scrollLeft;
  }

  return (
    <div
      className={`syntax-editor ${className}`}
      style={{ '--syntax-line-number-digits': lineNumberDigits }}
    >
      <pre ref={highlightRef} className="syntax-editor-highlight" aria-hidden="true">
        <code>{highlighted}</code>
      </pre>
      <textarea
        className={`syntax-editor-textarea ${textareaClassName}`}
        value={textValue}
        onChange={e => {
          updateSelectedLines(e.currentTarget);
          onChange?.(e);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={e => updateSelectedLines(e.currentTarget)}
        onMouseUp={e => updateSelectedLines(e.currentTarget)}
        onSelect={e => updateSelectedLines(e.currentTarget)}
        onFocus={e => updateSelectedLines(e.currentTarget)}
        onClick={e => updateSelectedLines(e.currentTarget)}
        onScroll={handleScroll}
        spellCheck={spellCheck}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
      />
    </div>
  );
}
