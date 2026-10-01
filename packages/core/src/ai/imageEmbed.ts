import sharp from 'sharp';
import { config } from '../config';
import { normalize } from './providers';

/**
 * Image embeddings for product matching. `clip` runs CLIP ViT-B/32 locally through
 * transformers.js (model downloads on first use); `histogram` is a lightweight color/layout
 * signature that needs no model and works offline.
 */
export async function embedImage(png: Buffer): Promise<number[]> {
  if (config.IMAGE_EMBED_PROVIDER === 'clip') {
    try {
      return await clipEmbed(png);
    } catch (err) {
      console.warn('[imageEmbed] CLIP unavailable, falling back to histogram:', (err as Error).message);
    }
  }
  return histogramEmbed(png);
}

async function histogramEmbed(png: Buffer): Promise<number[]> {
  // 8x8 downsample (192 values) captures layout; a 4x4x4 color histogram (64) captures palette.
  const small = await sharp(png).removeAlpha().resize(8, 8, { fit: 'fill' }).raw().toBuffer();
  const layout = [...small].map((v) => v / 255 - 0.5);
  const px = await sharp(png).removeAlpha().resize(64, 64, { fit: 'inside' }).raw().toBuffer();
  const hist = new Array<number>(64).fill(0);
  for (let i = 0; i < px.length; i += 3) hist[(px[i] >> 6) * 16 + (px[i + 1] >> 6) * 4 + (px[i + 2] >> 6)]++;
  const total = px.length / 3;
  return normalize([...layout, ...hist.map((h) => (h / total) * 4)]);
}

type Extractor = (img: unknown) => Promise<{ data: Float32Array }>;
let extractor: Promise<{ run: Extractor; RawImage: { fromBlob(b: Blob): Promise<unknown> } }> | null = null;

async function clipEmbed(png: Buffer): Promise<number[]> {
  extractor ??= (async () => {
    const tf = (await import('@huggingface/transformers')) as unknown as {
      pipeline: (task: string, model: string) => Promise<Extractor>;
      RawImage: { fromBlob(b: Blob): Promise<unknown> };
    };
    const run = await tf.pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32');
    return { run, RawImage: tf.RawImage };
  })();
  const { run, RawImage } = await extractor;
  const image = await RawImage.fromBlob(new Blob([new Uint8Array(png)], { type: 'image/png' }));
  const out = await run(image);
  return normalize(Array.from(out.data));
}
