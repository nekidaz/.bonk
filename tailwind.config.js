import forms from '@tailwindcss/forms';

/**
 * Big Sur token layer. Every colour resolves to a CSS variable so the whole app
 * themes via `:root` (light) / `.dark` (dark) defined in app.css. The Material-3
 * token NAMES are kept so existing component classes keep working.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,ts,js}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-container-lowest': 'var(--surface)',
        'surface-container-low': 'var(--s1)',
        'surface-container': 'var(--s2)',
        'surface-container-high': 'var(--s3)',
        'surface-container-highest': 'var(--s4)',
        'surface-bright': 'var(--surface)',
        'surface-dim': 'var(--sdim)',
        'surface-variant': 'var(--s2)',
        'surface-tint': 'var(--accent)',

        primary: 'var(--accent)',
        'primary-container': 'var(--accent)',
        'on-primary': 'var(--on-accent)',
        'on-primary-container': 'var(--on-accent)',
        'inverse-primary': 'var(--accent)',

        secondary: 'var(--text2)',
        'secondary-container': 'var(--s3)',
        'on-secondary': 'var(--on-accent)',
        'on-secondary-container': 'var(--text)',

        tertiary: 'var(--text)',
        'tertiary-container': 'var(--s3)',
        'on-tertiary': 'var(--on-accent)',
        'on-tertiary-container': 'var(--text)',

        'on-surface': 'var(--text)',
        'on-surface-variant': 'var(--text2)',
        'on-background': 'var(--text)',
        'inverse-surface': 'var(--text)',
        'inverse-on-surface': 'var(--surface)',

        outline: 'var(--border)',
        'outline-variant': 'var(--border2)',

        error: 'var(--error)',
        'on-error': '#ffffff',
        'error-container': 'var(--error-c)',
        'on-error-container': 'var(--error)',

        success: 'var(--success)',
        warning: 'var(--warning)',

        'primary-fixed': 'var(--s3)',
        'primary-fixed-dim': 'var(--text2)',
        'on-primary-fixed': 'var(--text)',
        'on-primary-fixed-variant': 'var(--text)',
        'secondary-fixed': 'var(--s3)',
        'secondary-fixed-dim': 'var(--text2)',
        'on-secondary-fixed': 'var(--text)',
        'on-secondary-fixed-variant': 'var(--text)',
        'tertiary-fixed': 'var(--s3)',
        'tertiary-fixed-dim': 'var(--text2)',
        'on-tertiary-fixed': 'var(--text)',
        'on-tertiary-fixed-variant': 'var(--text)',
      },
      borderRadius: {
        none: '0px',
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '10px',
        '2xl': '12px',
        full: '9999px',
      },
      spacing: {
        editor_margin: '48px',
        gutter: '16px',
        sidebar_width: '264px',
        unit: '4px',
        margin: '24px',
      },
      fontFamily: {
        'body-sm': ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Helvetica Neue', 'sans-serif'],
        'headline-md': ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Helvetica Neue', 'sans-serif'],
        'headline-lg': ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Helvetica Neue', 'sans-serif'],
        'body-lg': ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Helvetica Neue', 'sans-serif'],
        'label-caps': ['SF Mono', 'JetBrains Mono', 'ui-monospace', 'Menlo', 'monospace'],
        'code-block': ['SF Mono', 'JetBrains Mono', 'ui-monospace', 'Menlo', 'monospace'],
      },
      fontSize: {
        'body-sm': ['13px', { lineHeight: '1.5', fontWeight: '400' }],
        'headline-md': ['15px', { lineHeight: '1.3', fontWeight: '700', letterSpacing: '-0.01em' }],
        'headline-lg': ['24px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '700' }],
        'label-caps': ['11px', { lineHeight: '1.0', letterSpacing: '0.02em', fontWeight: '700' }],
        'body-lg': ['15px', { lineHeight: '1.5', fontWeight: '400' }],
        'code-block': ['12.5px', { lineHeight: '1.7', fontWeight: '400' }],
      },
    },
  },
  plugins: [forms],
};
