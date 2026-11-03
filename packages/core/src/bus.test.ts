import { describe, expect, it } from 'vitest';
import { bus, publishDesignUpdate } from './bus';

describe('design updates', () => {
  it('tells every open Mantis window to reload a graphic', () => {
    const seen: unknown[] = [];
    const stop = bus.subscribe((message) => seen.push(message));
    publishDesignUpdate('design-1');
    stop();
    expect(seen).toEqual([{ userId: '*', type: 'design', payload: { id: 'design-1' } }]);
  });
});
