import { describe, expect, it } from 'vitest';
import { addedProductIds, partitionDesignDeletion } from './designLibrary';

describe('graphic library', () => {
  it('keeps a graphic that is already scheduled or posted', () => {
    const result = partitionDesignDeletion([
      { id: 'draft', statuses: ['DRAFT'] },
      { id: 'review', statuses: ['IN_REVIEW'] },
      { id: 'scheduled', statuses: ['SCHEDULED'] },
      { id: 'posted', statuses: ['DRAFT', 'POSTED'] },
      { id: 'loose', statuses: [] },
    ]);
    expect(result.deleteIds).toEqual(['draft', 'review', 'loose']);
    expect(result.kept).toEqual(['scheduled', 'posted']);
  });

  it('adds product tags without removing the ones already on the graphic', () => {
    expect(addedProductIds(['cardshark'], ['cardshark', 'duro', 'duro'])).toEqual(['duro']);
    expect(addedProductIds([], [])).toEqual([]);
  });
});
