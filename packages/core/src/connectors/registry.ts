import { csvConnector } from './csv';
import { shopifyConnector } from './shopify';
import type { ProductSourceConnector } from './types';

/** Shopify is one connector. CSV exists so the interface is not Shopify-shaped. */
export const productConnectors: ProductSourceConnector[] = [shopifyConnector, csvConnector];

export function connectorById(id: string): ProductSourceConnector | undefined {
  return productConnectors.find((connector) => connector.id === id);
}
