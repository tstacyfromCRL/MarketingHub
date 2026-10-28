import { describe, expect, it } from 'vitest';
import { intentFromModel, interpretPrompt, resolveWhen, withFollowUp, type Person } from './promptIntent';

const tony: Person = { id: 'tony', name: 'Tony Stacy' };
const other: Person = { id: 'other', name: 'Tony Nguyen' };
const sam: Person = { id: 'sam', name: 'Sam Lee' };

describe('workflow prompts', () => {
  it('reads a LinkedIn post aimed at next week', () => {
    const intent = interpretPrompt("Let's create a LinkedIn post about xyz for next week", [tony]);
    expect(intent).toMatchObject({ kind: 'post', platform: 'linkedin', brief: 'xyz', when: 'next week' });
  });

  it('reads a task for a teammate due tomorrow', () => {
    const intent = interpretPrompt('Create a new task for tony to get some footage of the xyz tomorrow', [tony, sam]);
    expect(intent).toMatchObject({
      kind: 'task',
      title: 'Get some footage of the xyz',
      assigneeId: 'tony',
      assigneeName: 'Tony Stacy',
      when: 'tomorrow',
    });
  });

  it('asks which person when a first name matches two teammates', () => {
    const intent = interpretPrompt('Create a task for tony to film the booth tomorrow', [tony, other]);
    expect(intent.kind).toBe('clarify');
    if (intent.kind === 'clarify') expect(intent.question).toMatch(/Tony Stacy/);
    expect(withFollowUp('Create a task for tony to film the booth tomorrow', 'Tony Nguyen')).toMatch(/Tony Nguyen/);
  });

  it('does not publish, approve, or delete from a sentence', () => {
    expect(interpretPrompt('Publish the LinkedIn post', [tony]).kind).toBe('refuse');
    expect(interpretPrompt('Delete the task for tony', [tony]).kind).toBe('refuse');
    expect(interpretPrompt('Approve the draft', [tony]).kind).toBe('refuse');
  });

  it('asks which network when a post does not name one', () => {
    expect(interpretPrompt('Create a post about the new sensor', [tony])).toMatchObject({
      kind: 'clarify',
      question: expect.stringMatching(/Which network/),
    });
  });

  it('places tomorrow at 9 and next week on the following Monday', () => {
    const wednesday = new Date(2026, 9, 28, 15, 0, 0);
    expect(resolveWhen('tomorrow', wednesday)?.getDate()).toBe(29);
    expect(resolveWhen('tomorrow', wednesday)?.getHours()).toBe(9);
    const monday = resolveWhen('next week', wednesday);
    expect(monday?.getDay()).toBe(1);
    expect(monday?.getDate()).toBe(2);
  });

  it('accepts a model answer only as a draft or a task', () => {
    const post = intentFromModel(JSON.stringify({ action: 'create-post', platform: 'linkedin', brief: 'the sensor', when: 'next week' }), [tony]);
    expect(post).toMatchObject({ kind: 'post', platform: 'linkedin', brief: 'the sensor' });
    const bad = intentFromModel('not json', [tony]);
    expect(bad.kind).toBe('clarify');
  });
});
