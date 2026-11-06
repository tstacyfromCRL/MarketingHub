/** The line a post can publish: the article's title, then its address. */
export function articleLinkLine(title: string, url: string): string {
  const label = title.trim();
  return label ? `${label}: ${url}` : url;
}

/**
 * Add an article to post copy once. Choosing the same article again leaves the
 * text alone, so the link is not stacked every time the menu is used.
 */
export function appendArticleLink(body: string, title: string, url: string): string {
  if (body.includes(url)) return body;
  const line = articleLinkLine(title, url);
  const trimmed = body.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${line}` : line;
}
