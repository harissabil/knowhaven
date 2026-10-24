// Simplified inline marks for the integration cards. Swap in the official brand assets before launch.
const P = { viewBox: "0 0 24 24", width: 28, height: 28, "aria-hidden": true } as const;

export function SlackLogo() {
  return (
    <svg {...P}>
      <rect x="9" y="2" width="3" height="8" rx="1.5" fill="#36C5F0" />
      <rect x="14" y="9" width="8" height="3" rx="1.5" fill="#2EB67D" />
      <rect x="12" y="14" width="3" height="8" rx="1.5" fill="#ECB22E" />
      <rect x="2" y="12" width="8" height="3" rx="1.5" fill="#E01E5A" />
    </svg>
  );
}

export function AtlassianLogo() {
  return (
    <svg {...P}>
      <path d="M7.1 11.2c-.3-.3-.7-.3-.9.1L1.1 20.4c-.2.4.1.8.5.8h7.1c.2 0 .4-.1.5-.3 1.5-3.1.6-7.8-2.1-9.7z" fill="#2684FF" />
      <path d="M11.5 2.5c-2.6 4.100-2.400 8.500-.5 12.300l3.400 6.800c.1.200.3.300.5.300h7.100c.4 0 .7-.4.5-.8L12.500 2.500c-.2-.4-.8-.4-1 0z" fill="#2684FF" />
    </svg>
  );
}

export function WhatsAppLogo() {
  return (
    <svg {...P}>
      <path d="M12 2a10 10 0 0 0-8.600 15L2 22l5.200-1.400A10 10 0 1 0 12 2z" fill="#25D366" />
      <path d="M8.500 7.500c-.4.400-.9 1.200-.5 2.400.8 2.200 2.600 4 4.700 4.900 1.200.5 2-.1 2.400-.5l.4-.9-1.600-.9-.7.700c-.8-.3-2.200-1.700-2.500-2.500l.7-.7-.9-1.600z" fill="#fff" />
    </svg>
  );
}

export function TelegramLogo() {
  return (
    <svg {...P}>
      <circle cx="12" cy="12" r="10" fill="#29A9EB" />
      <path d="M5.500 11.800 17.700 7.100c.6-.2 1.100.1.9.9l-2 9.400c-.1.700-.5.900-1.100.600l-3-2.200-1.400 1.400c-.2.200-.3.300-.6.300l.2-3 5.500-5c.2-.2 0-.3-.4-.1l-6.800 4.300-2.900-.9c-.6-.2-.6-.6.100-.9z" fill="#fff" />
    </svg>
  );
}

export const LOGOS: Record<string, () => React.JSX.Element> = {
  Slack: SlackLogo, Atlassian: AtlassianLogo, WhatsApp: WhatsAppLogo, Telegram: TelegramLogo,
};
