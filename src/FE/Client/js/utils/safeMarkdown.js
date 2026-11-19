import { escapeHtml } from './dom.js';

/**
 * A small Markdown renderer for text written by someone else (the bot's report.md). Every character of the source
 * is escaped first; only the markup below is then built from the escaped text, so a `<script>`, an `onerror=` or a
 * raw `<img>` in the report stays visible text and never becomes HTML.
 *
 * Supported: headings, paragraphs, bullet and numbered lists (with [ ] / [x] task boxes), fenced code, block quotes,
 * pipe tables, horizontal rules, `code`, **bold**, *italic*, ~~struck~~ and [links](https://...) to http(s) only.
 */
export function renderSafeMarkdown(source, { maxLength = 200_000 } = {}) {
  const lines = String(source ?? '').slice(0, maxLength).replace(/\r\n?/g, '\n').split('\n');
  return renderBlocks(lines);
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function renderBlocks(lines) {
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(FENCE);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) code.push(lines[index++]);
      index += 1; // the closing fence (or the end)
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(HEADING);
    if (heading) {
      // Inside a page that already has h1-h2: report headings start at h3.
      const level = Math.min(6, heading[1].length + 2);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push('<hr>');
      index += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) quoted.push(lines[index++].replace(QUOTE, ''));
      out.push(`<blockquote>${renderBlocks(quoted)}</blockquote>`);
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]) && lines[index + 1].includes('-')) {
      const header = cells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(cells(lines[index++]));
      out.push(`<div class="md-table"><table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((row) => `<tr>${header.map((_, column) => `<td>${inline(row[column] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(LIST_ITEM);
        if (match && /\d/.test(match[2]) === ordered) {
          items.push(match[3]);
          index += 1;
        } else if (items.length && lines[index].trim() && /^\s{2,}/.test(lines[index]) && !LIST_ITEM.test(lines[index])) {
          items[items.length - 1] += ` ${lines[index].trim()}`; // a wrapped line of the same item
          index += 1;
        } else {
          break;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((text) => `<li>${taskBox(text)}</li>`).join('')}</${tag}>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) paragraph.push(lines[index++].trim());
    if (!paragraph.length) paragraph.push(lines[index++].trim());
    out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}

function startsBlock(lines, index) {
  const line = lines[index];
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line)
    || (line.includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]) && lines[index + 1].includes('-'));
}

function cells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function taskBox(text) {
  const task = text.match(/^\[([ xX])\]\s+(.*)$/);
  if (!task) return inline(text);
  const done = task[1].toLowerCase() === 'x';
  return `<span class="md-task${done ? ' is-done' : ''}" aria-hidden="true">${done ? '☑' : '☐'}</span> <span class="md-sr">${done ? '[x] ' : '[ ] '}</span>${inline(task[2])}`;
}

/** Inline markup on escaped text. Code spans are cut out first so nothing inside them is formatted. */
function inline(text) {
  return String(text).split(/(`[^`]+`)/g).map((part) => {
    if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    let html = escapeHtml(part);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    html = html.replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(?=\S)(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>');
    html = html.replace(/(^|[^_\w])_(?=\S)([^_]+?)_(?![_\w])/g, '$1<em>$2</em>');
    html = html.replace(/~~(?=\S)(.+?)~~/g, '<del>$1</del>');
    return html;
  }).join('');
}
