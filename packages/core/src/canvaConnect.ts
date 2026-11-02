import crypto from 'node:crypto';

/** Scopes the Canva app must enable. Read and write are separate permissions. */
export const CANVA_SCOPES = [
  'asset:read',
  'asset:write',
  'design:content:read',
  'design:content:write',
  'design:meta:read',
  'brandtemplate:meta:read',
  'brandtemplate:content:read',
  'profile:read',
].join(' ');

export interface CanvaField {
  name: string;
  type: string;
}

/** PKCE S256 challenge. Canva's authorize URL expects the lowercase method name s256. */
export function canvaCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function canvaAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string; verifier: string }): string {
  const url = new URL('https://www.canva.com/api/oauth/authorize');
  url.searchParams.set('code_challenge', canvaCodeChallenge(input.verifier));
  url.searchParams.set('code_challenge_method', 's256');
  url.searchParams.set('scope', CANVA_SCOPES);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('state', input.state);
  url.searchParams.set('redirect_uri', input.redirectUri);
  return url.toString();
}

/**
 * Fill the first text field and the first image field on a brand template.
 * Other fields keep the template's own defaults.
 */
export function canvaAutofillData(fields: CanvaField[], input: { headline?: string; assetId?: string }): Record<string, { type: string; text?: string; asset_id?: string }> {
  const data: Record<string, { type: string; text?: string; asset_id?: string }> = {};
  const text = fields.find((field) => field.type.toLowerCase() === 'text');
  const image = fields.find((field) => field.type.toLowerCase() === 'image');
  if (text && input.headline) data[text.name] = { type: 'text', text: input.headline };
  if (image && input.assetId) data[image.name] = { type: 'image', asset_id: input.assetId };
  return data;
}

/** A template is autofilled only when it has a field we can fill. Otherwise it is copied as-is. */
export function canvaTemplateUsesAutofill(fields: CanvaField[], input: { headline?: string; assetId?: string }): boolean {
  return Object.keys(canvaAutofillData(fields, input)).length > 0;
}

/** Canva can only replace an image frame that was marked as a data field. An ordinary frame stays as the template drew it. */
export function canvaMissingImageFrame(fields: CanvaField[], hasImage: boolean): boolean {
  return hasImage && !fields.some((field) => field.type.toLowerCase() === 'image');
}

/** The return button sends this id back. Canva allows 50 characters. */
export function canvaEditLink(editUrl: string, correlationState: string): string {
  if (correlationState.length === 0 || correlationState.length > 50) throw new Error('The graphic id cannot be sent back from Canva.');
  const url = new URL(editUrl);
  url.searchParams.set('correlation_state', correlationState);
  return url.toString();
}

/** Checks Canva's signature on the return token and reads which design came back. */
export function verifyCanvaReturnJwt(token: string, keys: (JsonWebKey & { kid?: string })[]): { designId: string; correlationState: string } {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('Canva return token is not a JWT');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString()) as { alg?: string; kid?: string };
  const key = keys.find((item) => item.kid === header.kid);
  if (!key || !header.alg) throw new Error('Canva return token was not signed by a known key');
  const algorithm = header.alg === 'RS256' ? 'RSA-SHA256' : header.alg === 'ES256' ? 'SHA256' : header.alg === 'EdDSA' ? null : undefined;
  if (algorithm === undefined) throw new Error(`Unsupported Canva signature ${header.alg}`);
  const signed = Buffer.from(`${headerPart}.${payloadPart}`);
  const ok = crypto.verify(algorithm, signed, crypto.createPublicKey({ key: key as unknown as crypto.JsonWebKey, format: 'jwk' }), Buffer.from(signaturePart, 'base64url'));
  if (!ok) throw new Error('Canva return token failed verification');
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString()) as { exp?: number; design_id?: string; correlation_state?: string };
  if (claims.exp !== undefined && claims.exp < Date.now() / 1000) throw new Error('Canva return token has expired');
  if (!claims.design_id || !claims.correlation_state) throw new Error('Canva return token is missing the design');
  return { designId: claims.design_id, correlationState: claims.correlation_state };
}
