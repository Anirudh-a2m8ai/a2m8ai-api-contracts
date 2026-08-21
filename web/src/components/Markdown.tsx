/**
 * A small CommonMark subset, enough for the prose this contract actually
 * contains: headings, fenced code, lists, tables, blockquotes, rules, and
 * inline code / bold / italic / links.
 *
 * Safety: every character of input is HTML-escaped up front, and the only
 * markup in the output is what this file emits. Link hrefs are additionally
 * scheme-checked, so a `[click](javascript:...)` in a description — or in a
 * comment body, which is user input from anyone signed in — cannot become an
 * executable link.
 *
 * A full markdown library would be the right call if this grew; at this size
 * one auditable file beats a dependency whose sanitiser needs its own review.
 */

function escapeHtml(input: string): string {
  return input
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

/** Allows only schemes that cannot execute. Anything else renders as text. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  if (url.startsWith('#') || url.startsWith('/')) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url)) return url;
  return null;
}

function inline(text: string): string {
  let out = escapeHtml(text);

  // Code spans are lifted out first: nothing inside one should then be read
  // as emphasis or a link. The placeholder is delimited by U+0000, which
  // escaped HTML text cannot contain - a plainer marker such as " 3 " would
  // collide with ordinary prose ("retried 3 times") and swap that number
  // for an unrelated code span.
  const spans: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_match, code: string) => {
    spans.push(`<code>${code}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const safe = safeHref(href);
    if (!safe) return match;
    const external = /^https?:/i.test(safe);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(safe)}"${attrs}>${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

  return out.replace(/\u0000(\d+)\u0000/g, (_match, index: string) => spans[Number(index)]);
}

function renderTable(rows: string[]): string {
  const cells = (line: string) =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((cell) => cell.trim());

  const head = cells(rows[0]);
  const body = rows.slice(2).map(cells);

  const headHtml = head.map((cell) => `<th>${inline(cell)}</th>`).join('');
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('');

  return `<div class="table-scroll"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function toHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      const lang = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
      out.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 1, 6); // h1 in prose would fight the page title.
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flush();
      out.push('<hr />');
      continue;
    }

    // A table needs a header row and a `|---|` separator underneath it.
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      flush();
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      i -= 1;
      out.push(renderTable(rows));
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flush();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      i -= 1;
      out.push(`<blockquote>${toHtml(quote.join('\n'))}</blockquote>`);
      continue;
    }

    const bullet = /^\s*([-*+])\s+(.*)$/;
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/;
    if (bullet.test(line) || numbered.test(line)) {
      flush();
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (bullet.test(lines[i]) || numbered.test(lines[i]))) {
        const match = lines[i].match(ordered ? numbered : bullet);
        if (!match) break;
        items.push(`<li>${inline(match[2])}</li>`);
        i += 1;
      }
      i -= 1;
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return out.join('\n');
}

export function Markdown({ children, className }: { children?: string | null; className?: string }) {
  if (!children || !children.trim()) return null;
  return (
    <div
      className={className ? `md ${className}` : 'md'}
      dangerouslySetInnerHTML={{ __html: toHtml(children) }}
    />
  );
}

/** Single-line variant for places with no room for block markup. */
export function InlineMarkdown({ children }: { children?: string | null }) {
  if (!children || !children.trim()) return null;
  return <span dangerouslySetInnerHTML={{ __html: inline(children.replace(/\n+/g, ' ')) }} />;
}
