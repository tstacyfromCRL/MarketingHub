import { beforeEach, describe, expect, it } from 'vitest';
import { useAssistantStore } from './assistantStore';

beforeEach(() => {
  useAssistantStore.setState({ open: false, draft: null });
});

describe('assistant panel store', () => {
  it('opens with a draft message from a screen, such as Rewrite on a post', () => {
    useAssistantStore.getState().openWith('Rewrite this post: ');
    expect(useAssistantStore.getState()).toMatchObject({ open: true, draft: 'Rewrite this post: ' });
  });

  it('hands the draft to the input once, so it does not refill after the person sends it', () => {
    useAssistantStore.getState().openWith('Rewrite this post: ');
    expect(useAssistantStore.getState().takeDraft()).toBe('Rewrite this post: ');
    expect(useAssistantStore.getState().takeDraft()).toBeNull();
  });

  it('can be opened and closed without a draft', () => {
    useAssistantStore.getState().setOpen(true);
    expect(useAssistantStore.getState().open).toBe(true);
    useAssistantStore.getState().setOpen(false);
    expect(useAssistantStore.getState().open).toBe(false);
  });
});
