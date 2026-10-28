import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCircle2, Circle, Globe, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  ANALYZE_STEPS, PLATFORMS, PLATFORM_PRESETS, type AnalyzeProgress, type AnalyzeStep, type BrandColor, type BrandProfileInput,
  type CompanySummary, type OnboardingState, type OnboardingStep, type SuggestedProduct,
} from '@mh/shared';
import { api, errorMessage, queryClient } from '../lib/api';
import { isAdmin, useSession } from '../lib/session';
import type { KnowledgeSource } from '../lib/types';
import { BrandFileUploader, ColorTiersEditor, useBrandFiles } from '../components/BrandKit';
import { BrandMark } from '../components/BrandMark';
import { Button, ErrorText, Field, Spinner } from '../components/ui';

const WIZARD_STEPS: OnboardingStep[] = ['name', 'about', 'summary', 'logos', 'colors', 'voice', 'analyze', 'done'];
const ANALYZE_LABELS: Record<AnalyzeStep, string> = {
  website: 'Reading your website',
  samples: 'Studying your sample posts',
  logos: 'Looking at your logos',
  voice: 'Writing your voice guide',
};

interface OnboardingInfo {
  state: OnboardingState;
  analysis: AnalyzeProgress;
}

export function useOnboarding() {
  const { user } = useSession();
  return useQuery({ queryKey: ['onboarding'], queryFn: () => api.get<OnboardingInfo>('/onboarding'), enabled: isAdmin(user) });
}

function useBrand() {
  return useQuery({ queryKey: ['brand'], queryFn: () => api.get<BrandProfileInput>('/brand') });
}

async function saveBrand(patch: Partial<BrandProfileInput>) {
  const b = await api.patch<BrandProfileInput>('/brand', patch);
  queryClient.setQueryData(['brand'], b);
  return b;
}

/** Assistant speech bubble. */
function Say({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <BrandMark variant="icon" className="mt-0.5 h-8 w-8 shrink-0" />
      <div className="rounded-2xl rounded-tl-sm bg-slate-800/80 px-4 py-3 text-[15px] leading-relaxed">{children}</div>
    </div>
  );
}

function StepFrame({ say, children, onBack, footer }: { say: ReactNode; children?: ReactNode; onBack?: () => void; footer: ReactNode }) {
  return (
    <div className="space-y-5">
      <Say>{say}</Say>
      {children && <div className="ml-11 space-y-4">{children}</div>}
      <div className="ml-11 flex items-center gap-3">
        {onBack && (
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        )}
        <div className="flex-1" />
        {footer}
      </div>
    </div>
  );
}

/** "Create New Company" setup: a short conversation that builds the summary, brand kit and voice. */
export function OnboardingPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const info = useOnboarding();
  const brand = useBrand();
  const [step, setStep] = useState<OnboardingStep | null>(null);

  useEffect(() => {
    if (info.data && step === null) setStep(info.data.state.completedAt ? 'done' : info.data.state.step);
  }, [info.data, step]);

  if (!isAdmin(user)) {
    return (
      <Centered>
        <Say>Only an admin can set up the company. Ask your admin to finish setup.</Say>
        <div className="ml-11 mt-4"><Button onClick={() => navigate('/')}>Go to dashboard</Button></div>
      </Centered>
    );
  }
  if (!step || !brand.data) return <Spinner label="Loading setup..." />;

  const goto = (next: OnboardingStep) => {
    setStep(next);
    void api.put('/onboarding', { step: next, completedAt: null }).then(() => queryClient.invalidateQueries({ queryKey: ['onboarding'] }));
  };
  const back = () => goto(WIZARD_STEPS[Math.max(0, WIZARD_STEPS.indexOf(step) - 1)]);
  const finish = async (to = '/') => {
    await api.put('/onboarding', { step: 'done', completedAt: new Date().toISOString() });
    await queryClient.invalidateQueries({ queryKey: ['onboarding'] });
    navigate(to);
  };

  const index = WIZARD_STEPS.indexOf(step);
  return (
    <Centered>
      <div className="mb-8 flex items-center gap-3">
        <BrandMark className="h-8 w-auto shrink-0" />
        <div className="text-sm uppercase tracking-wider text-mist/70">Setup</div>
        <div className="flex flex-1 gap-1">
          {WIZARD_STEPS.slice(0, -1).map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${i < index ? 'bg-indigo-500' : i === index ? 'bg-indigo-400/60' : 'bg-slate-800'}`} />
          ))}
        </div>
        <button className="text-xs text-slate-500 hover:text-slate-300" onClick={() => navigate('/')} title="You can come back to setup from the dashboard">
          Finish later
        </button>
      </div>
      {step === 'name' && <NameStep brand={brand.data} onNext={() => goto('about')} />}
      {step === 'about' && <AboutStep brand={brand.data} onBack={back} onNext={() => goto('summary')} />}
      {step === 'summary' && <SummaryStep onBack={back} onNext={() => goto('logos')} />}
      {step === 'logos' && <LogosStep onBack={back} onNext={() => goto('colors')} />}
      {step === 'colors' && <ColorsStep brand={brand.data} onBack={back} onNext={() => goto('voice')} />}
      {step === 'voice' && <VoiceStep brand={brand.data} onBack={back} onNext={() => goto('analyze')} />}
      {step === 'analyze' && <AnalyzeStepView onBack={back} onNext={() => goto('done')} />}
      {step === 'done' && <DoneStep onFinish={(to) => void finish(to)} onRedo={() => goto('voice')} />}
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="h-full overflow-auto bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950">
      <div className="mx-auto max-w-3xl px-8 py-10">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NameStep({ brand, onNext }: { brand: BrandProfileInput; onNext: () => void }) {
  const [name, setName] = useState(brand.companyName);
  const save = useMutation({ mutationFn: () => saveBrand({ companyName: name.trim() }), onSuccess: onNext });
  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <StepFrame
        say="Welcome to your new marketing hub! What is your company's name?"
        footer={<Button type="submit" loading={save.isPending} disabled={!name.trim()}>Continue</Button>}
      >
        <input className="input text-lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" autoFocus />
        <ErrorText error={save.error ? errorMessage(save.error) : null} />
      </StepFrame>
    </form>
  );
}

const SUMMARY_DRAFT = 'mh.onboarding.summaryDraft';

function AboutStep({ brand, onBack, onNext }: { brand: BrandProfileInput; onBack: () => void; onNext: () => void }) {
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState(brand.website);
  const [pages, setPages] = useState<{ url: string; title: string; ok: boolean; error?: string }[]>([]);
  const summarize = useMutation({
    mutationFn: () => {
      const u = url.trim() && !/^https?:\/\//i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
      return api.post<{ summary: CompanySummary; pages: typeof pages }>('/onboarding/summarize', { description, url: u });
    },
    onSuccess: (r) => {
      setPages(r.pages);
      localStorage.setItem(SUMMARY_DRAFT, JSON.stringify(r.summary));
      onNext();
    },
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); summarize.mutate(); }}>
      <StepFrame
        say="Tell me about what your company does, or enter your website's url, and I'll take a look"
        onBack={onBack}
        footer={
          <Button type="submit" loading={summarize.isPending} disabled={!description.trim() && !url.trim()}>
            {summarize.isPending ? (url.trim() ? 'Reading your website...' : 'Thinking...') : 'Continue'}
          </Button>
        }
      >
        <Field label="Website">
          <div className="relative">
            <Globe className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input className="input pl-9" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="www.yourcompany.com" autoFocus />
          </div>
        </Field>
        <Field label="And/or describe what you do" hint="Products or services, who you serve, what makes you different.">
          <textarea className="input" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {pages.some((p) => !p.ok) && (
          <p className="text-xs text-amber-300">Some pages couldn't be read: {pages.filter((p) => !p.ok).map((p) => p.url).join(', ')}</p>
        )}
        <ErrorText error={summarize.error ? errorMessage(summarize.error) : null} />
      </StepFrame>
    </form>
  );
}

function SummaryStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const brand = useBrand();
  const [s, setS] = useState<CompanySummary | null>(null);
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    if (s || !brand.data) return;
    const draft = localStorage.getItem(SUMMARY_DRAFT);
    const b = brand.data;
    setS(draft ? (JSON.parse(draft) as CompanySummary) : { summary: b.summary, tagline: b.tagline, mission: b.mission, audience: b.audience });
  }, [brand.data, s]);
  const approve = useMutation({
    mutationFn: () => saveBrand(s!),
    onSuccess: () => {
      localStorage.removeItem(SUMMARY_DRAFT);
      setApproved(true);
    },
  });
  if (!s) return <Spinner />;
  if (approved) {
    return (
      <StepFrame
        say="Awesome! This summary will continue to grow as I learn more about your company. You'll always be able to make edits or add new information at any time."
        footer={<Button onClick={onNext} autoFocus>Let's build the brand kit</Button>}
      />
    );
  }
  const set = (k: keyof CompanySummary, v: string) => setS({ ...s, [k]: v });
  return (
    <StepFrame
      say="Here's what I've got. Does this look about right?"
      onBack={onBack}
      footer={<Button onClick={() => approve.mutate()} loading={approve.isPending} disabled={!s.summary.trim()}><Check className="h-4 w-4" /> Looks right</Button>}
    >
      <Field label="What the company does"><textarea className="input" rows={7} value={s.summary} onChange={(e) => set('summary', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tagline"><input className="input" value={s.tagline} onChange={(e) => set('tagline', e.target.value)} /></Field>
        <Field label="Mission"><input className="input" value={s.mission} onChange={(e) => set('mission', e.target.value)} /></Field>
      </div>
      <Field label="Who you serve"><textarea className="input" rows={2} value={s.audience} onChange={(e) => set('audience', e.target.value)} /></Field>
      <p className="text-xs text-slate-500">Edit anything that's off. Want a different take? Go back and add more detail.</p>
      <ErrorText error={approve.error ? errorMessage(approve.error) : null} />
    </StepFrame>
  );
}

function LogosStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const files = useBrandFiles();
  const count = (files.data ?? []).filter((f) => f.kind === 'LOGO').length;
  return (
    <StepFrame
      say="Now, let's build your brand kit. First, upload your logos"
      onBack={onBack}
      footer={<Button onClick={onNext}>{count ? 'Continue' : 'Skip for now'}</Button>}
    >
      <BrandFileUploader kind="LOGO" accept="image/*,.svg" hint="PNG or SVG work best: full logo, icon, light and dark versions." />
    </StepFrame>
  );
}

function ColorsStep({ brand, onBack, onNext }: { brand: BrandProfileInput; onBack: () => void; onNext: () => void }) {
  const [colors, setColors] = useState<BrandColor[]>(brand.colors);
  const save = useMutation({ mutationFn: () => saveBrand({ colors }), onSuccess: onNext });
  return (
    <StepFrame
      say="What are your brand colors?"
      onBack={onBack}
      footer={<Button onClick={() => save.mutate()} loading={save.isPending}>{colors.length ? 'Continue' : 'Skip for now'}</Button>}
    >
      <p className="text-sm text-slate-400">Enter each color as Hex, RGB, CMYK or Pantone. Primary colors are used most in designs.</p>
      <ColorTiersEditor colors={colors} onChange={setColors} />
      <ErrorText error={save.error ? errorMessage(save.error) : null} />
    </StepFrame>
  );
}

function VoiceStep({ brand, onBack, onNext }: { brand: BrandProfileInput; onBack: () => void; onNext: () => void }) {
  const [voice, setVoice] = useState(brand.voice);
  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api.get<KnowledgeSource[]>('/sources') });
  const samples = (sources.data ?? []).filter((s) => s.kind === 'SAMPLE_POST');
  const [draft, setDraft] = useState({ content: '', platform: '', url: '' });
  const add = useMutation({
    mutationFn: () =>
      api.post('/sources', { kind: 'SAMPLE_POST', content: draft.content, platform: draft.platform || null, url: draft.url.trim() || undefined }),
    onSuccess: () => {
      setDraft({ content: '', platform: draft.platform, url: '' });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
  const next = useMutation({
    mutationFn: async () => {
      await saveBrand({ voice });
      await api.post('/onboarding/analyze', { voiceNotes: voice });
    },
    onSuccess: onNext,
  });
  return (
    <StepFrame
      say="Find your voice. What is your company's brand voice?"
      onBack={onBack}
      footer={<Button onClick={() => next.mutate()} loading={next.isPending} disabled={!voice.trim() && !samples.length}>Build my profile</Button>}
    >
      <Field label="Describe how you sound" hint="For example: confident but friendly, plain English, no jargon, light humor, few emojis. Words you always or never use.">
        <textarea className="input" rows={5} value={voice} onChange={(e) => setVoice(e.target.value)} autoFocus />
      </Field>
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <div className="mb-1 text-sm font-medium">Sample posts (optional, but it helps a lot)</div>
        <p className="mb-3 text-xs text-slate-500">Paste a few past social posts you're proud of. I'll learn your style from them.</p>
        {samples.map((s) => (
          <div key={s.id} className="mb-2 flex items-start gap-2 rounded-md bg-slate-800/60 px-3 py-2 text-sm">
            <span className="flex-1">{s.title}</span>
            <Button size="sm" variant="ghost" title="Remove" onClick={() => void api.del(`/sources/${s.id}`).then(() => queryClient.invalidateQueries({ queryKey: ['sources'] }))}>
              <Trash2 className="h-3.5 w-3.5 text-rose-400" />
            </Button>
          </div>
        ))}
        <textarea className="input" rows={4} placeholder="Paste a post..." value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <div className="mt-2 flex gap-2">
          <select className="input w-40" value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })}>
            <option value="">Platform (optional)</option>
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_PRESETS[p].label}</option>)}
          </select>
          <input className="input flex-1" placeholder="Link to the post (optional)" value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          <Button variant="secondary" onClick={() => add.mutate()} loading={add.isPending} disabled={!draft.content.trim()}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
        <ErrorText error={add.error ? errorMessage(add.error) : null} />
      </div>
      <ErrorText error={next.error ? errorMessage(next.error) : null} />
    </StepFrame>
  );
}

function AnalyzeStepView({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const info = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api.get<OnboardingInfo>('/onboarding'),
    refetchInterval: (q) => (q.state.data?.analysis.state === 'running' ? 1500 : false),
  });
  const a = info.data?.analysis;
  useEffect(() => {
    if (a?.state === 'done') {
      void queryClient.invalidateQueries({ queryKey: ['brand'] });
      const t = setTimeout(onNext, 900);
      return () => clearTimeout(t);
    }
  }, [a?.state, onNext]);
  const retry = useMutation({ mutationFn: () => api.post('/onboarding/analyze', {}), onSuccess: () => info.refetch() });
  return (
    <StepFrame
      say="Thanks! Give me a minute to analyze everything and build a profile for you..."
      onBack={a?.state === 'running' ? undefined : onBack}
      footer={a?.state === 'error' ? <Button onClick={() => retry.mutate()} loading={retry.isPending}>Try again</Button> : null}
    >
      <div className="space-y-2">
        {ANALYZE_STEPS.map((s) => {
          const done = a?.done.includes(s);
          const current = a?.current === s && a.state === 'running';
          return (
            <div key={s} className={`flex items-center gap-2 text-sm ${done ? 'text-emerald-300' : current ? 'text-slate-100' : 'text-slate-500'}`}>
              {done ? <CheckCircle2 className="h-4 w-4" /> : current ? <Loader2 className="h-4 w-4 animate-spin" /> : <Circle className="h-4 w-4" />}
              {ANALYZE_LABELS[s]}
            </div>
          );
        })}
      </div>
      {a?.state === 'error' && <ErrorText error={`Something went wrong: ${a.error}`} />}
    </StepFrame>
  );
}

function DoneStep({ onFinish, onRedo }: { onFinish: (to?: string) => void; onRedo: () => void }) {
  const brand = useBrand();
  const info = useOnboarding();
  const [added, setAdded] = useState<string[]>([]);
  const addProduct = useMutation({
    mutationFn: (p: SuggestedProduct) => api.post('/products', { name: p.name, description: p.description, pricing: p.pricing, url: p.url }),
    onSuccess: (_r, p) => {
      setAdded((a) => [...a, p.name]);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const b = brand.data;
  if (!b) return <Spinner />;
  const suggestions = info.data?.analysis.suggestedProducts ?? [];
  const section = (title: string, to: string, body: ReactNode) => (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <button className="text-xs text-indigo-300 hover:underline" onClick={() => onFinish(to)}>Edit</button>
      </div>
      <div className="text-sm text-slate-300">{body}</div>
    </div>
  );
  return (
    <StepFrame
      say={<>Your profile is ready! Here's what I learned about <b>{b.companyName || 'your company'}</b>. Everything is saved in the Knowledge Base and Brand Kit, and you can edit it any time.</>}
      footer={
        <>
          <Button variant="ghost" onClick={onRedo}>Back to brand voice</Button>
          <Button onClick={() => onFinish()}>Go to my dashboard</Button>
        </>
      }
    >
      {section('Company summary', '/knowledge', <p className="whitespace-pre-line">{b.summary || 'Not set'}</p>)}
      {section('Brand voice', '/knowledge', (
        <div className="space-y-2">
          <p className="whitespace-pre-line">{b.voice || 'Not set'}</p>
          {b.dos.length > 0 && <p><span className="text-emerald-300">Always:</span> {b.dos.join('; ')}</p>}
          {b.donts.length > 0 && <p><span className="text-rose-300">Never:</span> {b.donts.join('; ')}</p>}
        </div>
      ))}
      {section('Brand kit', '/brand-kit', (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">{b.colors.map((c, i) => <span key={i} className="h-6 w-6 rounded border border-slate-700" style={{ backgroundColor: c.hex }} title={`${c.name || c.hex} (${c.tier.toLowerCase()})`} />)}</div>
          {b.visualIdentity && <p>{b.visualIdentity}</p>}
        </div>
      ))}
      {suggestions.length > 0 && section('Products I found on your website', '/products', (
        <div className="space-y-2">
          {suggestions.map((p) => (
            <div key={p.name} className="flex items-start gap-3">
              <div className="flex-1">
                <div className="font-medium">{p.name}{p.pricing && <span className="ml-2 text-xs text-slate-400">{p.pricing}</span>}</div>
                <div className="text-xs text-slate-400">{p.description}</div>
              </div>
              {added.includes(p.name) ? (
                <span className="text-xs text-emerald-300">Added</span>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => addProduct.mutate(p)} loading={addProduct.isPending && addProduct.variables?.name === p.name}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              )}
            </div>
          ))}
        </div>
      ))}
    </StepFrame>
  );
}
