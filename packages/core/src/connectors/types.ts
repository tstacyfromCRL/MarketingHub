import type { z } from 'zod';

export interface NormalizedProduct {
  externalId: string;
  name: string;
  sku: string;
  description: string;
  pricing: string;
  url: string;
  features: string[];
  active: boolean;
}

export interface ProductSourceConnector {
  id: string;
  displayName: string;
  /** Field names that must never be sent back to the client. */
  secretFields: string[];
  configSchema: z.ZodTypeAny;
  fetchProducts(config: unknown): AsyncIterable<NormalizedProduct>;
}
