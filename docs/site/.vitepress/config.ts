/** VitePress settings for the docs site (static output, no tracking scripts). Build with `pnpm docs:build`. */
const guide = (pages: [string, string][]) => pages.map(([p, text]) => ({ text, link: `/guide/${p}` }));
export default {
  title: 'Centcom', description: 'Documentation for Centcom', cleanUrls: true, lastUpdated: false,
  head: [],
  themeConfig: {
    search: { provider: 'local' },
    nav: [{ text: 'Guide', link: '/guide/getting-started' }, { text: 'Reference', link: '/reference/cli/' }],
    sidebar: [
      { text: 'Start', items: guide([['getting-started', 'Getting started'], ['install', 'Install'], ['login', 'Login'], ['billing', 'Accounts and plans']]) },
      { text: 'Working with others', items: guide([['sessions', 'Sessions'], ['command-post', 'Command post and branch mode'], ['cross-computer', 'Working across computers'], ['teams', 'Teams and sharing'], ['roles', 'Roles and permissions'], ['queue-approvals', 'Queue and approvals'], ['webhooks', 'Webhooks and notifications']]) },
      { text: 'Safety', items: guide([['privacy', 'Privacy and encryption'], ['security', 'Security']]) },
      { text: 'More', items: guide([['terminal-app', 'The terminal app'], ['keyboard', 'Keyboard'], ['releases', 'Releases'], ['troubleshooting', 'Troubleshooting'], ['faq', 'Questions']]) },
      { text: 'Reference', items: [{ text: 'Command line', link: '/reference/cli/' }, { text: 'Configuration', link: '/reference/config' }, { text: 'Environment variables', link: '/reference/env' }, { text: 'Exit codes', link: '/reference/exit-codes' }] },
    ],
  },
};
