import { useQuery } from '@tanstack/react-query';
import { appendArticleLink } from '@mh/shared';
import { api } from '../lib/api';
import { Field } from './ui';

type SavedArticle = { id: string; title: string; url: string | null };

/**
 * Inserts one saved article into the copy the parent is editing.
 * The value stays empty so the same article can be chosen again later, and
 * appendArticleLink refuses to stack the address a second time.
 */
export function ArticleLinkSelect({ body, onChange, disabled }: { body: string; onChange: (next: string) => void; disabled?: boolean }) {
  const articles = useQuery({
    queryKey: ['article-links'],
    queryFn: () => api.get<SavedArticle[]>('/article-links'),
  });
  const choices = (articles.data ?? []).filter((article) => article.url);
  return (
    <Field label="Add a saved article" hint="Puts the title and link into this copy.">
      <select
        className="input"
        value=""
        disabled={disabled || choices.length === 0}
        onChange={(e) => {
          const article = choices.find((item) => item.id === e.target.value);
          if (!article?.url) return;
          onChange(appendArticleLink(body, article.title, article.url));
        }}
      >
        <option value="">{choices.length ? 'Choose an article' : 'No saved articles yet'}</option>
        {choices.map((article) => (
          <option key={article.id} value={article.id}>{article.title || article.url}</option>
        ))}
      </select>
    </Field>
  );
}
