import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  closestCorners, DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Calendar, ChevronRight, Pencil, Plus, Settings2, Tags, Trash2 } from 'lucide-react';
import { api, errorMessage, queryClient } from '../lib/api';
import { isAdmin, useSession } from '../lib/session';
import { formatDate } from '../lib/format';
import { useUsers } from '../lib/hooks';
import type { Category, Stage, Task } from '../lib/types';
import { Badge, Button, ErrorText, Field, Modal, PageHeader, Spinner } from '../components/ui';

interface Board {
  stages: Stage[];
  tasks: Task[];
  categories: Category[];
}

const boardKey = ['board'];
const refresh = () => queryClient.invalidateQueries({ queryKey: boardKey });

export function TasksPage() {
  const { user } = useSession();
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: boardKey, queryFn: () => api.get<Board>('/board') });
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState('');
  const [filterUser, setFilterUser] = useState('');
  const [newIn, setNewIn] = useState<string | null>(null);
  const [manageStages, setManageStages] = useState(false);
  const [manageCats, setManageCats] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirming, setConfirming] = useState<{ task: Task; action: 'delete' | 'archive' | 'restore' } | null>(null);
  const users = useUsers();

  useEffect(() => {
    if (data && !activeId) setTasks(data.tasks);
  }, [data, activeId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const move = useMutation({
    mutationFn: (v: { id: string; stageId: string; order: number }) => api.put(`/tasks/${v.id}/move`, { stageId: v.stageId, order: v.order }),
    onSettled: refresh,
  });

  const visible = useMemo(
    () => tasks.filter((t) => (showArchived ? t.active === false : t.active !== false) && (!filterCat || t.categories.some((c) => c.id === filterCat)) && (!filterUser || t.assigneeId === filterUser)),
    [tasks, filterCat, filterUser, showArchived],
  );

  if (isLoading || !data) return <Spinner />;
  const stageOf = (id: string) => (data.stages.some((s) => s.id === id) ? id : tasks.find((t) => t.id === id)?.stageId);
  const column = (stageId: string) => visible.filter((t) => t.stageId === stageId).sort((a, b) => a.order - b.order);

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragOver = (e: DragOverEvent) => {
    if (!e.over) return;
    const to = stageOf(String(e.over.id));
    const id = String(e.active.id);
    if (to && tasks.find((t) => t.id === id)?.stageId !== to) {
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, stageId: to, order: Number.MAX_SAFE_INTEGER } : t)));
    }
  };
  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    setActiveId(null);
    if (!e.over) return setTasks(data.tasks);
    const stageId = stageOf(String(e.over.id))!;
    const others = column(stageId).filter((t) => t.id !== id);
    let index = others.findIndex((t) => t.id === String(e.over!.id));
    if (index < 0) index = others.length;
    const before = others[index - 1]?.order;
    const after = others[index]?.order;
    const order = before === undefined && after === undefined ? 1000 : before === undefined ? after! - 1000 : after === undefined ? before + 1000 : (before + after) / 2;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, stageId, order } : t)));
    move.mutate({ id, stageId, order });
  };

  const openTask = taskId ? tasks.find((t) => t.id === taskId) : undefined;
  const active = activeId ? tasks.find((t) => t.id === activeId) : undefined;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Tasks"
        actions={
          <>
            <Button variant="secondary" onClick={() => setManageCats(true)}><Tags className="h-4 w-4" /> Categories</Button>
            {isAdmin(user) && <Button variant="secondary" onClick={() => setManageStages(true)}><Settings2 className="h-4 w-4" /> Stages</Button>}
            <Button onClick={() => setNewIn(data.stages[0]?.id ?? null)}><Plus className="h-4 w-4" /> New task</Button>
          </>
        }
      />
      <div className="mb-4 flex gap-2">
        <select className="input w-48" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="">All categories</option>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input w-48" value={filterUser} onChange={(e) => setFilterUser(e.target.value)}>
          <option value="">Anyone</option>
          {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-mist/80">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archived
        </label>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setTasks(data.tasks); }}>
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4">
          {data.stages.map((s, index) => (
            <Column
              key={s.id}
              stage={s}
              tasks={column(s.id)}
              nextStage={data.stages[index + 1]}
              onAdd={() => setNewIn(s.id)}
              onOpen={(id) => navigate(`/tasks/${id}`)}
              onProgress={(task) => {
                const next = data.stages[index + 1];
                if (!next) return;
                const orders = tasks.filter((t) => t.stageId === next.id).map((t) => t.order);
                const order = (orders.length ? Math.max(...orders) : 0) + 1000;
                setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, stageId: next.id, order } : t)));
                move.mutate({ id: task.id, stageId: next.id, order });
              }}
              onArchive={(task) => setConfirming({ task, action: task.active === false ? 'restore' : 'archive' })}
              onDelete={(task) => setConfirming({ task, action: 'delete' })}
            />
          ))}
        </div>
        <DragOverlay>{active && <TaskCard task={active} />}</DragOverlay>
      </DndContext>

      {(newIn || openTask) && (
        <TaskModal
          task={openTask}
          stageId={newIn ?? undefined}
          board={data}
          onRequestDelete={openTask ? () => setConfirming({ task: openTask, action: 'delete' }) : undefined}
          onClose={() => {
            setNewIn(null);
            if (taskId) navigate('/tasks');
          }}
        />
      )}
      {confirming && (
        <ConfirmTask
          task={confirming.task}
          action={confirming.action}
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            if (taskId && confirming.task.id === taskId) navigate('/tasks');
            void refresh();
          }}
        />
      )}
      {manageStages && <StagesModal stages={data.stages} onClose={() => setManageStages(false)} />}
      {manageCats && <CategoriesModal categories={data.categories} onClose={() => setManageCats(false)} />}
    </div>
  );
}

function Column({ stage, tasks, nextStage, onAdd, onOpen, onProgress, onArchive, onDelete }: {
  stage: Stage;
  tasks: Task[];
  nextStage?: Stage;
  onAdd: () => void;
  onOpen: (id: string) => void;
  onProgress: (task: Task) => void;
  onArchive: (task: Task) => void;
  onDelete: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className="flex min-w-[11rem] flex-1 flex-col rounded-sm bg-chrome text-mist">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
        <span className="flex-1 text-sm">{stage.name}</span>
        <span className="text-xs text-mist/50">{tasks.length}</span>
        <button onClick={onAdd} className="text-mist/50 hover:text-mist"><Plus className="h-4 w-4" /></button>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className={`min-h-[80px] flex-1 space-y-2 overflow-y-auto px-2 pb-2 ${isOver ? 'bg-white/5' : ''}`}>
          {tasks.map((t) => (
            <SortableTask key={t.id} task={t} nextStage={nextStage} onOpen={() => onOpen(t.id)} onProgress={() => onProgress(t)} onArchive={() => onArchive(t)} onDelete={() => onDelete(t)} />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableTask({ task, nextStage, onOpen, onProgress, onArchive, onDelete }: {
  task: Task;
  nextStage?: Stage;
  onOpen: () => void;
  onProgress: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <TaskCard task={task} nextStage={nextStage} drag={{ ...attributes, ...listeners }} onOpen={onOpen} onProgress={onProgress} onArchive={onArchive} onDelete={onDelete} />
    </div>
  );
}

function TaskCard({ task, nextStage, drag, onOpen, onProgress, onArchive, onDelete }: {
  task: Task;
  nextStage?: Stage;
  drag?: Record<string, unknown>;
  onOpen?: () => void;
  onProgress?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}) {
  const overdue = task.dueDate && new Date(task.dueDate) < new Date();
  const archived = task.active === false;
  return (
    <div className="rounded-sm bg-mist p-2.5 text-inktext">
      {onOpen && (
        <div className="mb-1 flex justify-end">
          {nextStage && onProgress && <CardIcon title={`Move to ${nextStage.name}`} onClick={onProgress}><ChevronRight className="h-3.5 w-3.5" /></CardIcon>}
          {onArchive && <CardIcon title={archived ? 'Restore' : 'Archive'} onClick={onArchive}>{archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}</CardIcon>}
          <CardIcon title="Edit" onClick={onOpen}><Pencil className="h-3.5 w-3.5" /></CardIcon>
          {onDelete && <CardIcon title="Delete" onClick={onDelete} danger><Trash2 className="h-3.5 w-3.5" /></CardIcon>}
        </div>
      )}
      <div className="cursor-grab px-0.5" {...drag} onClick={onOpen}>
        {task.categories.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">{task.categories.map((c) => <Badge key={c.id} color={c.color}>{c.name}</Badge>)}</div>
        )}
        <div className="text-sm">{task.title}</div>
        <div className="mt-2 flex items-center gap-2 text-xs text-inktext/60">
          {task.dueDate && <span className={`inline-flex items-center gap-1 ${overdue ? 'text-[#6E4E4A]' : ''}`}><Calendar className="h-3 w-3" />{formatDate(task.dueDate)}</span>}
          <span className="flex-1" />
          {task.assignee && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sage text-[10px] text-mist" title={task.assignee.name}>
              {task.assignee.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CardIcon({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`rounded p-1 ${danger ? 'text-[#6E4E4A] hover:bg-[#6E4E4A]/10' : 'text-inktext/55 hover:bg-ink/10 hover:text-inktext'}`}
    >
      {children}
    </button>
  );
}

function ConfirmTask({ task, action, onClose, onDone }: { task: Task; action: 'delete' | 'archive' | 'restore'; onClose: () => void; onDone: () => void }) {
  const run = useMutation({
    mutationFn: () => action === 'delete' ? api.del(`/tasks/${task.id}`) : api.patch(`/tasks/${task.id}`, { active: action === 'restore' }),
    onSuccess: onDone,
  });
  const title = action === 'delete' ? 'Delete task' : action === 'archive' ? 'Archive task' : 'Restore task';
  const copy = action === 'delete'
    ? `Delete "${task.title}"? This cannot be undone.`
    : action === 'archive'
      ? `Archive "${task.title}"? It leaves the board and stays in Archived.`
      : `Put "${task.title}" back on the board?`;
  return (
    <Modal open onClose={onClose} title={title} width="max-w-md">
      <p className="text-sm text-mist/80">{copy}</p>
      <ErrorText error={run.error ? errorMessage(run.error) : null} />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant={action === 'restore' ? 'primary' : 'danger'} onClick={() => run.mutate()} loading={run.isPending}>
          {action === 'delete' ? 'Delete' : action === 'archive' ? 'Archive' : 'Restore'}
        </Button>
      </div>
    </Modal>
  );
}

function TaskModal({ task, stageId, board, onClose, onRequestDelete }: { task?: Task; stageId?: string; board: Board; onClose: () => void; onRequestDelete?: () => void }) {
  const users = useUsers();
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [stage, setStage] = useState(task?.stageId ?? stageId ?? board.stages[0].id);
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? '');
  const [due, setDue] = useState(task?.dueDate ? task.dueDate.slice(0, 10) : '');
  const [cats, setCats] = useState<string[]>(task?.categories.map((c) => c.id) ?? []);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title, description, stageId: stage, assigneeId: assigneeId || null, categoryIds: cats,
        dueDate: due ? new Date(`${due}T17:00:00`).toISOString() : null,
      };
      return task ? api.patch(`/tasks/${task.id}`, body) : api.post('/tasks', body);
    },
    onSuccess: () => { void refresh(); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={task ? 'Edit task' : 'New task'} width="max-w-xl">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></Field>
        <Field label="Description"><textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Stage">
            <select className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
              {board.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Assign to">
            <select className="input" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.data?.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Due date"><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label="Categories">
          <div className="flex flex-wrap gap-1.5">
            {board.categories.length === 0 && <span className="text-xs text-slate-500">No categories yet. Add some with the Categories button.</span>}
            {board.categories.map((c) => {
              const on = cats.includes(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => setCats(on ? cats.filter((x) => x !== c.id) : [...cats, c.id])}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-transparent' : 'border-slate-700 text-slate-400'}`}
                  style={on ? { backgroundColor: `${c.color}33`, color: c.color } : undefined}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </Field>
        {task && <p className="text-xs text-slate-500">Created by {task.creator.name}. Assignees are notified in-app, by email and on Slack, based on their preferences.</p>}
        <ErrorText error={save.error ? errorMessage(save.error) : null} />
        <div className="flex justify-between">
          {task ? <Button type="button" variant="danger" onClick={onRequestDelete}><Trash2 className="h-4 w-4" /> Delete</Button> : <span />}
          <Button type="submit" loading={save.isPending}>{task ? 'Save' : 'Create task'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function StagesModal({ stages, onClose }: { stages: Stage[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#64748b');
  const [deleting, setDeleting] = useState<Stage | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const reorder = (i: number, dir: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    void run(() => api.put('/stages/order', { stageIds: ids }));
  };

  return (
    <Modal open onClose={onClose} title="Board stages (admin)">
      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <input type="color" defaultValue={s.color} onBlur={(e) => e.target.value !== s.color && void run(() => api.patch(`/stages/${s.id}`, { color: e.target.value }))} className="h-8 w-8 rounded bg-transparent" />
            <input className="input flex-1" defaultValue={s.name} onBlur={(e) => e.target.value && e.target.value !== s.name && void run(() => api.patch(`/stages/${s.id}`, { name: e.target.value }))} />
            <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => reorder(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" disabled={i === stages.length - 1} onClick={() => reorder(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => { setDeleting(s); setMoveTo(stages.find((x) => x.id !== s.id)?.id ?? ''); }}><Trash2 className="h-3.5 w-3.5 text-rose-400" /></Button>
          </div>
        ))}
      </div>
      {deleting && (
        <div className="mt-4 space-y-2 rounded-md border border-rose-900 bg-rose-950/40 p-3 text-sm">
          <div>Remove "{deleting.name}"? Any tasks in it will be moved to:</div>
          <div className="flex gap-2">
            <select className="input flex-1" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              {stages.filter((s) => s.id !== deleting.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Button variant="danger" onClick={() => void run(() => api.del(`/stages/${deleting.id}?moveTo=${moveTo}`)).then(() => setDeleting(null))}>Remove</Button>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          </div>
        </div>
      )}
      <form className="mt-4 flex gap-2 border-t border-slate-800 pt-4" onSubmit={(e) => { e.preventDefault(); void run(() => api.post('/stages', { name, color })).then(() => setName('')); }}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-9 rounded bg-transparent" />
        <input className="input flex-1" placeholder="New stage name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit"><Plus className="h-4 w-4" /> Add</Button>
      </form>
      <div className="mt-3"><ErrorText error={error} /></div>
      <p className="mt-3 text-xs text-slate-500">The last stage is treated as "done" on dashboards.</p>
    </Modal>
  );
}

function CategoriesModal({ categories, onClose }: { categories: Category[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal open onClose={onClose} title="Task categories">
      <div className="space-y-2">
        {categories.length === 0 && <p className="text-sm text-slate-500">No categories yet.</p>}
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <input type="color" defaultValue={c.color} onBlur={(e) => e.target.value !== c.color && void run(() => api.patch(`/categories/${c.id}`, { color: e.target.value }))} className="h-8 w-8 rounded bg-transparent" />
            <input className="input flex-1" defaultValue={c.name} onBlur={(e) => e.target.value && e.target.value !== c.name && void run(() => api.patch(`/categories/${c.id}`, { name: e.target.value }))} />
            <Button size="sm" variant="ghost" onClick={() => void run(() => api.del(`/categories/${c.id}`))}><Trash2 className="h-3.5 w-3.5 text-rose-400" /></Button>
          </div>
        ))}
      </div>
      <form className="mt-4 flex gap-2 border-t border-slate-800 pt-4" onSubmit={(e) => { e.preventDefault(); void run(() => api.post('/categories', { name, color })).then(() => setName('')); }}>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-9 rounded bg-transparent" />
        <input className="input flex-1" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit"><Plus className="h-4 w-4" /> Add</Button>
      </form>
      <div className="mt-3"><ErrorText error={error} /></div>
    </Modal>
  );
}
