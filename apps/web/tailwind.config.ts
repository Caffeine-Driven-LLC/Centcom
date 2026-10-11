import type { Config } from 'tailwindcss';

/** A colour read from one of the app's CSS variables; `bg-primary/15` mixes it with transparent. */
const token = (name: string) => ({ opacityValue }: { opacityValue?: string }): string =>
  opacityValue === undefined || opacityValue === '1' ? `var(${name})` : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`;

/** shadcn/ui's colour names, mapped onto the semantic tokens of assets/theme (dark, light and the desktop palette all apply). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        background: token('--bg-base'), foreground: token('--text-primary'),
        card: token('--bg-surface'), 'card-foreground': token('--text-primary'),
        popover: token('--bg-overlay'), 'popover-foreground': token('--text-primary'),
        primary: token('--accent-fill'), 'primary-foreground': token('--accent-on'),
        secondary: token('--bg-selected'), 'secondary-foreground': token('--text-primary'),
        muted: token('--bg-sunken'), 'muted-foreground': token('--text-muted'),
        accent: token('--bg-hover'), 'accent-foreground': token('--text-primary'),
        destructive: token('--status-danger'), success: token('--status-success'), warning: token('--status-warning'),
        border: token('--border-subtle'), input: token('--border-default'), ring: token('--focus-ring'),
      },
      borderRadius: { sm: '8px', md: '12px', lg: '18px', xl: '24px' },
      fontFamily: { sans: ['var(--font-sans)'], serif: ['var(--font-serif)'], mono: ['var(--font-mono)'] },
    },
  },
} satisfies Config;
