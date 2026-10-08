/** VitePress settings for the docs site (static output, no tracking scripts). Build with `pnpm docs:build` once VitePress is installed. */
export default {
  title: 'Centcom', description: 'Documentation for Centcom', cleanUrls: true, lastUpdated: false,
  head: [],
  themeConfig: {
    nav: [{ text: 'Guide', link: '/guide/getting-started' }, { text: 'Reference', link: '/reference/cli/' }],
    sidebar: [
      { text: 'Guide', items: ['getting-started', 'install', 'login', 'sessions', 'command-post', 'roles', 'queue-approvals', 'privacy', 'billing', 'webhooks', 'troubleshooting', 'terminal-app', 'keyboard', 'faq'].map((p) => ({ text: p.replace(/-/g, ' '), link: `/guide/${p}` })) },
      { text: 'Reference', items: [{ text: 'Command line', link: '/reference/cli/' }, { text: 'Environment variables', link: '/reference/env' }, { text: 'Exit codes', link: '/reference/exit-codes' }] },
    ],
  },
};
