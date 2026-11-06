import { z } from 'zod';

/**
 * A layered design document. Every export format (PNG, PSD, SVG, PDF, IDML) is generated
 * from this model, which is what keeps AI-generated graphics editable.
 */
const base = {
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
};

export const rectLayerSchema = z.object({
  ...base,
  type: z.literal('rect'),
  fill: z.string(),
  cornerRadius: z.number().default(0),
  stroke: z.string().optional(),
  strokeWidth: z.number().default(0),
});

export const ellipseLayerSchema = z.object({
  ...base,
  type: z.literal('ellipse'),
  fill: z.string(),
  stroke: z.string().optional(),
  strokeWidth: z.number().default(0),
});

export const imageLayerSchema = z.object({
  ...base,
  type: z.literal('image'),
  /** Storage key on the server (uploaded asset, generated image, brand logo). */
  src: z.string(),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  role: z.enum(['background', 'generated', 'product', 'logo', 'other']).default('other'),
});

export const pathPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  /** Handle arriving at this anchor, relative to the anchor. Absent means that side is a corner. */
  inX: z.number().optional(),
  inY: z.number().optional(),
  outX: z.number().optional(),
  outY: z.number().optional(),
});
export type PathPoint = z.infer<typeof pathPointSchema>;

export const pathLayerSchema = z.object({
  ...base,
  type: z.literal('path'),
  /** Anchors in the layer box. Page position is x + point.x. */
  points: z.array(pathPointSchema).min(2),
  closed: z.boolean().default(false),
  /** "none" draws no fill, so an open pen stroke stays hollow. */
  fill: z.string().default('none'),
  stroke: z.string().default('#111827'),
  strokeWidth: z.number().default(2),
});

export const textLayerSchema = z.object({
  ...base,
  type: z.literal('text'),
  text: z.string(),
  fontFamily: z.string().default('Arial'),
  fontSize: z.number().positive(),
  fontWeight: z.union([z.literal('normal'), z.literal('bold')]).default('normal'),
  italic: z.boolean().default(false),
  color: z.string(),
  align: z.enum(['left', 'center', 'right']).default('left'),
  lineHeight: z.number().default(1.2),
  /** Extra space between characters, in pixels. Illustrator calls this tracking. */
  letterSpacing: z.number().optional(),
  underline: z.boolean().optional(),
});

export const layerSchema = z.discriminatedUnion('type', [
  rectLayerSchema,
  ellipseLayerSchema,
  imageLayerSchema,
  textLayerSchema,
  pathLayerSchema,
]);
export type Layer = z.infer<typeof layerSchema>;
export type TextLayer = z.infer<typeof textLayerSchema>;
export type ImageLayer = z.infer<typeof imageLayerSchema>;
export type RectLayer = z.infer<typeof rectLayerSchema>;
export type EllipseLayer = z.infer<typeof ellipseLayerSchema>;
export type PathLayer = z.infer<typeof pathLayerSchema>;

/** A layout guide. x is a vertical line, y is a horizontal line. Guides are not printed. */
export const guideSchema = z.object({
  id: z.string(),
  axis: z.enum(['x', 'y']),
  position: z.number(),
});
export type Guide = z.infer<typeof guideSchema>;

export const designDocSchema = z.object({
  version: z.literal(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  background: z.string().default('#ffffff'),
  /** Bottom-most layer first. */
  layers: z.array(layerSchema),
  /** Page guides. Omitted documents simply have none. */
  guides: z.array(guideSchema).optional(),
});
export type DesignDoc = z.infer<typeof designDocSchema>;

export const EXPORT_FORMATS = ['png', 'psd', 'svg', 'pdf', 'idml'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

let counter = 0;
export function newLayerId(): string {
  counter = (counter + 1) % 1e6;
  return `L${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * A background sits at the back and replaces the previous one, so picking another plate
 * does not leave the old plate underneath. An overlay covers the canvas and stays in front.
 */
export function placeBrandPiece(doc: DesignDoc, piece: { src: string; name: string; slot: 'background' | 'overlay' }): { doc: DesignDoc; layerId: string } {
  const layerId = newLayerId();
  const layer: ImageLayer = {
    id: layerId,
    name: piece.name,
    type: 'image',
    src: piece.src,
    fit: 'cover',
    role: piece.slot === 'background' ? 'background' : 'other',
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  if (piece.slot === 'background') {
    const rest = doc.layers.filter((item) => !(item.type === 'image' && item.role === 'background'));
    return { doc: { ...doc, layers: [layer, ...rest] }, layerId };
  }
  return { doc: { ...doc, layers: [...doc.layers, layer] }, layerId };
}
