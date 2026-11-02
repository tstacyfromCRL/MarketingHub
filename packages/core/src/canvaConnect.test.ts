import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canvaAutofillData, canvaAuthorizeUrl, canvaCodeChallenge, canvaEditLink, canvaMissingImageFrame, canvaTemplateUsesAutofill, verifyCanvaReturnJwt } from './canvaConnect';

describe('Canva Connect', () => {
  it('builds an authorize URL with a PKCE challenge', () => {
    const verifier = 'a'.repeat(50);
    const url = new URL(canvaAuthorizeUrl({ clientId: 'OC-test', redirectUri: 'http://127.0.0.1:4000/canva/callback', state: 'state-1', verifier }));
    expect(url.origin + url.pathname).toBe('https://www.canva.com/api/oauth/authorize');
    expect(url.searchParams.get('code_challenge')).toBe(canvaCodeChallenge(verifier));
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    expect(url.searchParams.get('client_id')).toBe('OC-test');
    expect(url.searchParams.get('scope')).toContain('design:content:write');
    expect(url.searchParams.get('scope')).toContain('brandtemplate:content:read');
  });

  it('fills the first text field and the first image field', () => {
    const data = canvaAutofillData(
      [{ name: 'HEADLINE', type: 'text' }, { name: 'PHOTO', type: 'image' }, { name: 'SUBLINE', type: 'text' }],
      { headline: 'CardShark', assetId: 'asset-1' },
    );
    expect(data).toEqual({
      HEADLINE: { type: 'text', text: 'CardShark' },
      PHOTO: { type: 'image', asset_id: 'asset-1' },
    });
  });

  it('refuses a photo when the template has no image frame to fill', () => {
    expect(canvaMissingImageFrame([{ name: 'HEADLINE', type: 'text' }], true)).toBe(true);
    expect(canvaMissingImageFrame([{ name: 'PHOTO', type: 'image' }], true)).toBe(false);
    expect(canvaMissingImageFrame([], false)).toBe(false);
  });

  it('copies a template that has no fill-in fields', () => {
    expect(canvaTemplateUsesAutofill([], { headline: 'CardShark', assetId: 'asset-1' })).toBe(false);
    expect(canvaTemplateUsesAutofill([{ name: 'HEADLINE', type: 'text' }], { headline: 'CardShark' })).toBe(true);
  });

  it('puts the graphic id on the Canva edit link', () => {
    const link = canvaEditLink('https://www.canva.com/api/design/token/edit', 'design-1');
    expect(new URL(link).searchParams.get('correlation_state')).toBe('design-1');
  });

  it('accepts a return token signed by a known key and rejects a changed one', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & { kid?: string };
    jwk.kid = 'test-key';
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      design_id: 'canva-1',
      correlation_state: 'mantis-1',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
    const token = `${header}.${payload}.${signature}`;
    expect(verifyCanvaReturnJwt(token, [jwk])).toEqual({ designId: 'canva-1', correlationState: 'mantis-1' });
    expect(() => verifyCanvaReturnJwt(`${header}.${payload}.${signature.slice(0, -2)}aa`, [jwk])).toThrow(/failed verification/);
  });
});
