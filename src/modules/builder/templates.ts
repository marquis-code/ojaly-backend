export interface StorefrontTemplate {
  key: string;
  name: string;
  description: string;
  vibe: string;
  colors: {
    ink: string;
    background: string;
    surface: string;
    primary: string;
    accent: string;
    muted: string;
    onPrimary: string;
  };
  fonts: { display: string; body: string };
  layout: 'split' | 'centered' | 'editorial' | 'poster' | 'soft' | 'campus' | 'sunset';
  heroStyle: 'block' | 'photo' | 'type' | 'ticker' | 'stack' | 'grid';
  cardStyle: 'rounded' | 'sharp' | 'editorial' | 'dark' | 'soft';
  radius: string;
  motif: string;
  isPaid: boolean;
}

export const STOREFRONT_TEMPLATES: StorefrontTemplate[] = [
  {
    key: 'lagos-pop',
    name: 'Lagos Pop',
    description: 'Bold orange, deep green, big type. Made for fashion and culture.',
    vibe: 'Loud, confident, unmistakably Lagos.',
    colors: { ink: '#06231A', background: '#FBF7EF', surface: '#FFFFFF', primary: '#FF5A1F', accent: '#F5D547', muted: '#5F6B64', onPrimary: '#FFFFFF' },
    fonts: { display: 'Space Grotesk', body: 'DM Sans' },
    layout: 'split',
    heroStyle: 'block',
    cardStyle: 'rounded',
    radius: '24px',
    motif: 'dots',
    isPaid: false,
  },
  {
    key: 'market-bright',
    name: 'Market Bright',
    description: 'Sunny yellow, cobalt blue and a market-day bounce.',
    vibe: 'Cheerful, busy, full of life.',
    colors: { ink: '#10243E', background: '#FFF8E1', surface: '#FFFFFF', primary: '#1F4FD8', accent: '#FFC93C', muted: '#5D6575', onPrimary: '#FFFFFF' },
    fonts: { display: 'Bricolage Grotesque', body: 'DM Sans' },
    layout: 'centered',
    heroStyle: 'ticker',
    cardStyle: 'rounded',
    radius: '20px',
    motif: 'stripes',
    isPaid: false,
  },
  {
    key: 'editorial-green',
    name: 'Editorial Green',
    description: 'Cream paper, forest green, quiet confidence.',
    vibe: 'Considered, premium, grown.',
    colors: { ink: '#0B2B1C', background: '#F3EFE4', surface: '#FBF9F3', primary: '#0B3D2E', accent: '#C9A227', muted: '#65705F', onPrimary: '#FBF9F3' },
    fonts: { display: 'Fraunces', body: 'DM Sans' },
    layout: 'editorial',
    heroStyle: 'type',
    cardStyle: 'editorial',
    radius: '6px',
    motif: 'lines',
    isPaid: true,
  },
  {
    key: 'midnight-studio',
    name: 'Midnight Studio',
    description: 'Black, acid lime, sharp edges. For tech, sneakers and streetwear.',
    vibe: 'Late-night, future-facing, cool.',
    colors: { ink: '#F4F4EC', background: '#0A0A0A', surface: '#141414', primary: '#C8FF00', accent: '#8B5CF6', muted: '#A3A39A', onPrimary: '#0A0A0A' },
    fonts: { display: 'Space Grotesk', body: 'DM Sans' },
    layout: 'poster',
    heroStyle: 'photo',
    cardStyle: 'dark',
    radius: '12px',
    motif: 'grid',
    isPaid: true,
  },
  {
    key: 'campus-ink',
    name: 'Campus Ink',
    description: 'Cobalt blue, cream paper and campus-poster energy.',
    vibe: 'Young, graphic, made for halls and hostels.',
    colors: { ink: '#0B1533', background: '#F4F5FF', surface: '#FFFFFF', primary: '#2547F4', accent: '#FFCC33', muted: '#5B6480', onPrimary: '#FFFFFF' },
    fonts: { display: 'Bricolage Grotesque', body: 'DM Sans' },
    layout: 'campus',
    heroStyle: 'grid',
    cardStyle: 'sharp',
    radius: '8px',
    motif: 'grid',
    isPaid: true,
  },
  {
    key: 'sunset-grid',
    name: 'Sunset Grid',
    description: 'Plum, burnt orange and a golden-hour glow.',
    vibe: 'Warm, bold, after-hours.',
    colors: { ink: '#FFF7ED', background: '#2A0F1E', surface: '#3B1628', primary: '#FF7A3D', accent: '#FFD166', muted: '#D8B4C2', onPrimary: '#2A0F1E' },
    fonts: { display: 'Fraunces', body: 'DM Sans' },
    layout: 'sunset',
    heroStyle: 'photo',
    cardStyle: 'dark',
    radius: '18px',
    motif: 'sun',
    isPaid: true,
  },
  {
    key: 'soft-serve',
    name: 'Soft Serve',
    description: 'Blush pink, cocoa and soft curves. Beauty, food and self-care.',
    vibe: 'Warm, gentle, a little playful.',
    colors: { ink: '#3B2528', background: '#FFF1F0', surface: '#FFFFFF', primary: '#E85D75', accent: '#F4B860', muted: '#80686B', onPrimary: '#FFFFFF' },
    fonts: { display: 'Fraunces', body: 'DM Sans' },
    layout: 'soft',
    heroStyle: 'stack',
    cardStyle: 'soft',
    radius: '32px',
    motif: 'blobs',
    isPaid: true,
  },
];

export function getTemplate(key: string): StorefrontTemplate {
  return STOREFRONT_TEMPLATES.find((t) => t.key === key) || STOREFRONT_TEMPLATES[0];
}

/**
 * A large, deterministic catalogue so every business can find a look that
 * feels like its own. The first few handcrafted templates stay untouched;
 * generated templates are free and safe to preview without a plan upgrade.
 */
const GENERATED_PALETTES = [
  { background: '#FBF7EF', surface: '#FFFFFF', ink: '#06231A', primary: '#FF5A1F', accent: '#F5D547', muted: '#5F6B64', onPrimary: '#FFFFFF' },
  { background: '#FFF8E1', surface: '#FFFFFF', ink: '#10243E', primary: '#1F4FD8', accent: '#FFC93C', muted: '#5D6575', onPrimary: '#FFFFFF' },
  { background: '#F3EFE4', surface: '#FBF9F3', ink: '#0B2B1C', primary: '#0B3D2E', accent: '#C9A227', muted: '#65705F', onPrimary: '#FBF9F3' },
  { background: '#0A0A0A', surface: '#141414', ink: '#F4F4EC', primary: '#C8FF00', accent: '#8B5CF6', muted: '#A3A39A', onPrimary: '#0A0A0A' },
  { background: '#FFF1F0', surface: '#FFFFFF', ink: '#3B2528', primary: '#E85D75', accent: '#F4B860', muted: '#80686B', onPrimary: '#FFFFFF' },
  { background: '#F4F5FF', surface: '#FFFFFF', ink: '#0B1533', primary: '#2547F4', accent: '#FFCC33', muted: '#5B6480', onPrimary: '#FFFFFF' },
  { background: '#2A0F1E', surface: '#3B1628', ink: '#FFF7ED', primary: '#FF7A3D', accent: '#FFD166', muted: '#D8B4C2', onPrimary: '#2A0F1E' },
  { background: '#F0F7F4', surface: '#FFFFFF', ink: '#12352A', primary: '#0F766E', accent: '#99F6E4', muted: '#5B7068', onPrimary: '#FFFFFF' },
  { background: '#FDF2F8', surface: '#FFFFFF', ink: '#4A1D3F', primary: '#C026D3', accent: '#F9A8D4', muted: '#7E5A72', onPrimary: '#FFFFFF' },
  { background: '#FFF7ED', surface: '#FFFFFF', ink: '#431407', primary: '#D97706', accent: '#FDE68A', muted: '#7C5A45', onPrimary: '#FFFFFF' },
];
const GENERATED_LAYOUTS: StorefrontTemplate['layout'][] = ['split', 'centered', 'editorial', 'poster', 'soft', 'campus', 'sunset'];
const GENERATED_HEROES: StorefrontTemplate['heroStyle'][] = ['block', 'photo', 'type', 'ticker', 'stack', 'grid'];
const GENERATED_CARDS: StorefrontTemplate['cardStyle'][] = ['rounded', 'sharp', 'editorial', 'dark', 'soft'];
const GENERATED_FONTS = [
  { display: 'Space Grotesk', body: 'DM Sans' }, { display: 'Bricolage Grotesque', body: 'DM Sans' },
  { display: 'Fraunces', body: 'DM Sans' }, { display: 'DM Sans', body: 'DM Sans' }, { display: 'Space Grotesk', body: 'DM Sans' },
];
const GENERATED_MOTIFS = ['dots', 'stripes', 'lines', 'grid', 'blobs', 'sun', 'checks', 'arches'];
const GENERATED_ADJECTIVES = ['Lagos', 'Market', 'Editorial', 'Midnight', 'Soft', 'Campus', 'Sunset', 'Mint', 'Cocoa', 'Lilac', 'Amber', 'Studio', 'Paper', 'Street', 'Coral', 'Indigo', 'Palm', 'Clay', 'Pearl', 'Neon'];
const GENERATED_NOUNS = ['Pop', 'Bright', 'Green', 'Studio', 'Serve', 'Ink', 'Grid', 'Glow', 'Market', 'Edit', 'Room', 'Canvas', 'Street', 'Story', 'Signal', 'Type', 'House', 'Club', 'Shop', 'Press'];

function generatedTemplates(): StorefrontTemplate[] {
  const templates: StorefrontTemplate[] = [];
  for (let index = 1; index <= 2000; index++) {
    const palette = GENERATED_PALETTES[(index - 1) % GENERATED_PALETTES.length];
    const adjective = GENERATED_ADJECTIVES[(index * 7) % GENERATED_ADJECTIVES.length];
    const noun = GENERATED_NOUNS[(index * 11) % GENERATED_NOUNS.length];
    const layout = GENERATED_LAYOUTS[(index * 3) % GENERATED_LAYOUTS.length];
    const heroStyle = GENERATED_HEROES[(index * 5) % GENERATED_HEROES.length];
    const cardStyle = GENERATED_CARDS[(index * 2) % GENERATED_CARDS.length];
    const fonts = GENERATED_FONTS[(index * 7) % GENERATED_FONTS.length];
    const motif = GENERATED_MOTIFS[index % GENERATED_MOTIFS.length];
    templates.push({
      key: `studio-${String(index).padStart(4, '0')}`,
      name: `${adjective} ${noun} ${String(index).padStart(3, '0')}`,
      description: `${adjective} ${noun.toLowerCase()} — a ${layout} layout with ${motif} details and a ${heroStyle} hero.`,
      vibe: `${adjective}, ${layout}, ${motif}.`,
      colors: { ...palette },
      fonts: { ...fonts },
      layout, heroStyle, cardStyle,
      radius: ['2px', '6px', '10px', '16px', '24px', '32px'][index % 6],
      motif,
      isPaid: false,
    });
  }
  return templates;
}

STOREFRONT_TEMPLATES.push(...generatedTemplates());
