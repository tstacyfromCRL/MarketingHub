const LIVE = new Set(['SCHEDULED', 'POSTED']);

/**
 * A graphic that is already on a scheduled or posted item stays.
 * Drafts and graphics in review can be deleted with the rest of the selection.
 */
export function partitionDesignDeletion(rows: { id: string; statuses: string[] }[]): { deleteIds: string[]; kept: string[] } {
  const deleteIds: string[] = [];
  const kept: string[] = [];
  for (const row of rows) {
    if (row.statuses.some((status) => LIVE.has(status))) kept.push(row.id);
    else deleteIds.push(row.id);
  }
  return { deleteIds, kept };
}

/** Tagging adds products. Tags already on the graphic stay until someone removes them. */
export function addedProductIds(existing: string[], adding: string[]): string[] {
  const have = new Set(existing);
  return [...new Set(adding.filter((id) => !have.has(id)))];
}
