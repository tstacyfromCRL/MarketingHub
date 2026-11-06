import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, Download, Sparkles, Trash2 } from 'lucide-react';
import type { ContentType } from '@mh/shared';
import { api, errorMessage, queryClient } from '../lib/api';
import { formatWhen } from '../lib/format';
import { VoiceField } from '../components/VoiceField';
import { Button, Card, ErrorText, Field, Spinner } from '../components/ui';

interface Doc { id: string; type: ContentType; title: string; body: string; updatedAt: string }

export function ContentDocPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['content', id], queryFn: () => api.get<Doc>(`/content/${id}`) });
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [instruction, setInstruction] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (data) {
      setTitle(data.title);
      setBody(data.body);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.put<Doc>(`/content/${id}`, { title, body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['content'] }),
  });
  const del = useMutation({
    mutationFn: () => api.del(`/content/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['content'] }); navigate('/studio?tab=write'); },
  });
  const revise = useMutation({
    mutationFn: () => api.post<{ text: string }>('/generate/text', { type: data!.type, brief: `Revise the following draft. Instruction: ${instruction}\n\n---\n${body}` }),
    onSuccess: (r) => { setBody(r.text); setInstruction(''); },
  });

  if (!data) return <Spinner />;
  const dirty = title !== data.title || body !== data.body;
  const exportMd = () => {
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^\w\- ]+/g, '').trim() || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/studio?tab=write')}><ArrowLeft className="h-4 w-4" /> Back</Button>
        <div className="flex-1" />
        <span className="text-xs text-slate-500">Saved {formatWhen(data.updatedAt)}</span>
        <Button variant="secondary" size="sm" onClick={() => { void navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500); }}><Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy'}</Button>
        <Button variant="secondary" size="sm" onClick={exportMd}><Download className="h-3.5 w-3.5" /> Markdown</Button>
        <Button variant="danger" size="sm" onClick={() => confirm('Delete this document?') && del.mutate()}><Trash2 className="h-3.5 w-3.5" /></Button>
        <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>Save</Button>
      </div>
      <input className="w-full bg-transparent text-2xl font-semibold outline-none" value={title} onChange={(e) => setTitle(e.target.value)} />
      <VoiceField label="Draft" field={`content.${data.type}`} contentType={data.type} multiline rows={22} value={body} onChange={setBody} />
      <Card>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); revise.mutate(); }}>
          <Field label="Ask AI to revise" className="flex-1"><input className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Make it shorter and add a clear call to action" /></Field>
          <Button type="submit" variant="secondary" loading={revise.isPending} disabled={!instruction.trim()}><Sparkles className="h-4 w-4" /> Revise</Button>
        </form>
        <div className="mt-2"><ErrorText error={revise.error ? errorMessage(revise.error) : save.error ? errorMessage(save.error) : null} /></div>
      </Card>
    </div>
  );
}
