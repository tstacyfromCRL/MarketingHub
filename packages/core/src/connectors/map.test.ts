import { describe, expect, it } from 'vitest';
import { parseProductFile } from './csv';
import { shopifyProductToNormalized } from './shopify';

describe('product connectors', () => {
  it('maps a Shopify Admin product', () => {
    const product = shopifyProductToNormalized(
      {
        id: 'gid://shopify/Product/1',
        title: 'Row Scout',
        handle: 'row-scout',
        descriptionHtml: '<p>Walks the rows.</p>',
        status: 'ARCHIVED',
        onlineStoreUrl: null,
        variants: { nodes: [{ sku: 'ACME-ROW-1', price: '12.00' }] },
      },
      'acme.myshopify.com',
    );
    expect(product).toMatchObject({
      externalId: 'gid://shopify/Product/1',
      name: 'Row Scout',
      sku: 'ACME-ROW-1',
      description: 'Walks the rows.',
      pricing: '$12.00',
      url: 'https://acme.myshopify.com/products/row-scout',
      active: false,
      features: [],
    });
  });

  it('maps a CSV product file', () => {
    const [row] = parseProductFile(
      'name,sku,description,price,url,features\nRow Scout,ACME-ROW-1,Walks the rows,12,https://example.com/row,camera;lidar\n',
      'csv',
    );
    expect(row).toMatchObject({
      name: 'Row Scout',
      sku: 'ACME-ROW-1',
      description: 'Walks the rows',
      pricing: '12',
      features: ['camera', 'lidar'],
      active: true,
    });
  });
});
