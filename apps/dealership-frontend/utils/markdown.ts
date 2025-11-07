export function markdownToHtml(markdown: string): string {
  if (!markdown) {
    return '';
  }

  let html = markdown
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Process block elements first
  html = html
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Process lists (unordered and ordered) line-by-line to group them
  const lines = html.split('\n');
  const newLines = [];
  let inList: 'ul' | 'ol' | null = null;

  for (const line of lines) {
    const isUl = /^\s*([*+-]) (.*)/.exec(line);
    const isOl = /^\s*(\d+)\. (.*)/.exec(line);

    if (isUl) {
      if (inList !== 'ul') {
        if (inList) newLines.push(`</${inList}>`);
        newLines.push('<ul>');
        inList = 'ul';
      }
      newLines.push(`<li>${isUl[2]}</li>`);
    } else if (isOl) {
      if (inList !== 'ol') {
        if (inList) newLines.push(`</${inList}>`);
        newLines.push('<ol>');
        inList = 'ol';
      }
      newLines.push(`<li>${isOl[2]}</li>`);
    } else {
      if (inList) {
        newLines.push(`</${inList}>`);
        inList = null;
      }
      newLines.push(line);
    }
  }
  if (inList) {
    newLines.push(`</${inList}>`);
  }
  html = newLines.join('\n');

  // Process paragraphs for lines that are not already block elements
  html = html.split(/\n\s*\n/).map(block => {
      if (block.trim().startsWith('<')) { // It's an HTML block we made
          return block;
      }
      if (!block.trim()) return '';
      return `<p>${block.trim().replace(/\n/g, '<br />')}</p>`;
  }).join('');

  // Process inline elements
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
  
  return html;
}
