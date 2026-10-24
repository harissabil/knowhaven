import { useId } from "react";

// Official brand marks (Knowhaven, Slack, Confluence, Jira, Atlassian, WhatsApp, Telegram, WorkBuddy).
// All marks share a tight 24x24 (or proportional) bounding box so they have equal visual weight.

export function KnowhavenLogo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="96 56 808 598"
      width={size}
      height={Math.round((size * 598) / 808)}
      role="img"
      aria-labelledby="knowhaven-logo-title"
      className={className}
    >
      <title id="knowhaven-logo-title">Knowhaven</title>
      <g fill="none" stroke="currentColor" strokeWidth="72" strokeLinecap="round">
        <path d="M142 608V460A358 358 0 0 1 858 460V608" />
        <path d="M250 608V460A250 250 0 0 1 750 460V608" />
        <path d="M358 608V460A142 142 0 0 1 642 460V608" />
      </g>
    </svg>
  );
}

export function SlackLogo({ size = 24 }: { size?: number } = {}) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden className="shrink-0">
      <path d="M22,12 a6,6 0 1 1 6,-6 v6z M22,16 a6,6 0 0 1 0,12 h-16 a6,6 0 1 1 0,-12z" fill="#36C5F0" />
      <path d="M48,22 a6,6 0 1 1 6,6 h-6z M32,6 a6,6 0 1 1 12,0v16a6,6 0 0 1 -12,0z" fill="#2EB67D" />
      <path d="M38,48 a6,6 0 1 1 -6,6 v-6z M54,32 a6,6 0 0 1 0,12 h-16 a6,6 0 1 1 0,-12z" fill="#ECB22E" />
      <path d="M12,38 a6,6 0 1 1 -6,-6 h6z M16,38 a6,6 0 1 1 12,0v16a6,6 0 0 1 -12,0z" fill="#E01E5A" />
    </svg>
  );
}

export function JiraLogo({ size = 24 }: { size?: number } = {}) {
  const id = useId();
  return (
    <svg viewBox="0.5 0.5 17 17" width={size} height={size} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${id}-j1`} x1="12.82" y1="5.02" x2="9.6" y2="8.34" gradientUnits="userSpaceOnUse">
          <stop offset="0.18" stopColor="#0052CC" />
          <stop offset="1" stopColor="#2684FF" />
        </linearGradient>
        <linearGradient id={`${id}-j2`} x1="10.82" y1="7.02" x2="7.6" y2="10.34" gradientUnits="userSpaceOnUse">
          <stop offset="0.18" stopColor="#0052CC" />
          <stop offset="1" stopColor="#2684FF" />
        </linearGradient>
      </defs>
      <path d="M16.36 1H8.78a3.42 3.42 0 0 0 3.42 3.42h1.4v1.35A3.42 3.42 0 0 0 17 9.2V1.66a.66.66 0 0 0-.64-.66Z" fill="#2684FF" />
      <path d="M12.33 5H4.74a3.42 3.42 0 0 0 3.42 3.43h1.4v1.35a3.42 3.42 0 0 0 3.42 3.42V5.66a.66.66 0 0 0-.65-.66Z" fill={`url(#${id}-j1)`} />
      <path d="M8.36 9H.76a3.42 3.42 0 0 0 3.44 3.42h1.4v1.35a3.42 3.42 0 0 0 3.42 3.43V9.66A.66.66 0 0 0 8.36 9Z" fill={`url(#${id}-j2)`} />
    </svg>
  );
}

export function ConfluenceLogo({ size = 24 }: { size?: number } = {}) {
  const id = useId();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${id}-c1`} x1="22" y1="22" x2="6" y2="13" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0052CC" />
          <stop offset="1" stopColor="#2684FF" />
        </linearGradient>
        <linearGradient id={`${id}-c2`} x1="2" y1="2" x2="18" y2="11" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0052CC" />
          <stop offset="1" stopColor="#2684FF" />
        </linearGradient>
      </defs>
      <path d="M.87 18.257c-.248.382-.53.875-.763 1.245a.764.764 0 0 0 .255 1.04l4.965 3.054a.764.764 0 0 0 1.058-.26c.199-.332.454-.763.733-1.221 1.967-3.247 3.945-2.853 7.508-1.146l4.957 2.337a.764.764 0 0 0 1.028-.382l2.364-5.346a.764.764 0 0 0-.382-1 599.851 599.851 0 0 1-4.965-2.361C10.911 10.97 5.224 11.185.87 18.257z" fill={`url(#${id}-c1)`} />
      <path d="M23.131 5.743c.249-.405.531-.875.764-1.25a.764.764 0 0 0-.256-1.034L18.675.404a.764.764 0 0 0-1.058.26c-.195.335-.451.763-.734 1.225-1.966 3.246-3.945 2.85-7.508 1.146L4.437.694a.764.764 0 0 0-1.027.382L1.046 6.422a.764.764 0 0 0 .382 1c1.039.49 3.105 1.467 4.965 2.361 6.698 3.246 12.392 3.029 16.738-4.04z" fill={`url(#${id}-c2)`} />
    </svg>
  );
}

export function AtlassianLogo({ size = 24 }: { size?: number } = {}) {
  const id = useId();
  return (
    <svg viewBox="1 2 22 20" width={size} height={size} aria-hidden className="shrink-0">
      <defs>
        <linearGradient id={`${id}-a1`} x1="9.5" y1="12" x2="4" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0052CC" />
          <stop offset="0.92" stopColor="#2684FF" />
        </linearGradient>
      </defs>
      <path d="M7.1 11.2c-.3-.3-.7-.3-.9.1L1.1 20.4c-.2.4.1.8.5.8h7.1c.2 0 .4-.1.5-.3 1.5-3.1.6-7.8-2.1-9.7z" fill={`url(#${id}-a1)`} />
      <path d="M11.5 2.5c-2.6 4.1-2.4 8.5-.5 12.3l3.4 6.8c.1.2.3.3.5.3h7.1c.4 0 .7-.4.5-.8L12.5 2.5c-.2-.4-.8-.4-1 0z" fill="#2684FF" />
    </svg>
  );
}

/** Official Tencent WorkBuddy mark extracted from https://www.workbuddy.ai/ (assets/logo.svg). */
export function WorkBuddyLogo({ size = 24 }: { size?: number } = {}) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden className="shrink-0">
      <g clipPath={`url(#${id}-clip)`}>
        <rect width="40" height="40" rx="20" fill={`url(#${id}-p0)`} />
        <g filter={`url(#${id}-f0)`}>
          <circle cx="31.3411" cy="43.6183" r="12.8704" fill="#FFE355" fillOpacity="0.49" />
        </g>
        <path
          d="M28.5931 3.12762C28.9853 2.77585 29.0091 2.76226 29.2968 2.74499C29.7628 2.71096 30.1894 2.93488 30.916 3.59634C32.6132 5.13875 34.9769 8.30904 36.4462 11.0168L37.0138 12.0682L37.8156 12.4668C38.5896 12.8579 39.8593 13.6593 40.3898 14.0895C40.6297 14.2878 40.6638 14.2925 40.9133 14.1954C42.0388 13.7572 43.6506 14.3382 45.0727 15.7024C46.3529 16.9294 47.5794 19.026 48.0491 20.7757C48.1177 21.0574 48.2087 21.6628 48.2419 22.1134C48.349 23.6964 47.8414 24.9608 46.8637 25.5331C46.664 25.6484 46.6505 25.6795 46.6561 26.1774C46.7011 28.5481 46.0621 30.9144 44.7785 33.2221C43.3293 35.8133 40.7489 38.4945 37.2566 41.0199C35.3813 42.3846 30.9445 44.9701 28.9382 45.8778C24.1324 48.0414 20.2794 48.8709 16.9329 48.4609C14.9368 48.219 12.6769 47.44 11.34 46.5355C10.9885 46.2925 10.9325 46.2774 10.6637 46.3543C9.2327 46.7651 7.35867 45.9207 5.76659 44.1535C5.13165 43.4471 4.1065 41.7127 3.77404 40.7843C3.0054 38.6118 3.15852 36.6506 4.18236 35.4799C4.44671 35.1785 4.45511 35.1658 4.39735 34.6589C4.30195 33.8289 4.25837 32.6008 4.30192 31.808L4.33666 31.0674L3.22502 29.101C1.5033 26.0375 0.409325 23.4645 -0.012563 21.4992C-0.235219 20.4218 -0.221193 19.9436 0.0522186 19.5899C0.21871 19.3763 0.764928 19.1545 1.42322 19.0329C3.08041 18.742 6.69466 19.0056 10.7155 19.7155L11.1329 19.788L12.0511 18.976C13.5747 17.6264 14.587 16.8696 16.4531 15.706C18.3981 14.4891 20.5929 13.4877 23.0648 12.695L23.8577 12.4414L24.2939 11.2964C25.8547 7.17615 27.4533 4.13844 28.5931 3.12762ZM15.5182 24.243C13.7542 25.2615 12.8718 25.7706 12.2236 26.3413C9.59893 28.6526 8.61811 32.3134 9.73545 35.6274C10.0114 36.4457 10.5201 37.3283 11.5386 39.0923C12.5571 40.8564 13.0671 41.7383 13.6378 42.3864C15.9491 45.0112 19.6103 45.9929 22.9243 44.8755C23.7426 44.5995 24.6249 44.0899 26.3888 43.0714L36.5375 37.2121C38.3016 36.1936 39.184 35.6845 39.8321 35.1137C42.4568 32.8024 43.4373 29.1409 42.3198 25.8269C42.0438 25.0086 41.5342 24.1264 40.5158 22.3624C39.4973 20.5983 38.9882 19.7159 38.4175 19.0678C36.1062 16.4432 32.4454 15.4622 29.1314 16.5796C28.3131 16.8556 27.431 17.3651 25.6669 18.3836L15.5182 24.243Z"
          fill={`url(#${id}-p1)`}
        />
        <rect x="16.4961" y="31.3344" width="4.00904" height="8.32646" rx="2.00452" transform="rotate(-30 16.4961 31.3344)" fill="white" />
        <rect x="27.3125" y="25.0894" width="4.00904" height="8.32646" rx="2.00452" transform="rotate(-30 27.3125 25.0894)" fill="white" />
      </g>
      <defs>
        <filter id={`${id}-f0`} x="7.47033" y="19.7475" width="47.742" height="47.7416" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="5.50019" result="effect1_foregroundBlur" />
        </filter>
        <linearGradient id={`${id}-p0`} x1="20" y1="0" x2="20" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0EC8A9" />
          <stop offset="1" stopColor="#01C886" />
        </linearGradient>
        <linearGradient id={`${id}-p1`} x1="14.6642" y1="11.0783" x2="33.3762" y2="43.4885" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.8" />
          <stop offset="0.437689" stopColor="white" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <rect width="40" height="40" rx="20" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

export function WhatsAppLogo({ size = 24 }: { size?: number } = {}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className="shrink-0">
      <path d="M12.04 1C6.02 1 1.13 5.89 1.13 11.91c0 1.93.5 3.81 1.46 5.47L1 23l5.78-1.52a10.9 10.9 0 0 0 5.25 1.34h.01c6.02 0 10.91-4.89 10.91-10.91A10.91 10.91 0 0 0 12.04 1z" fill="#25D366" />
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51l-.57-.01c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.69.25-1.29.17-1.41-.07-.12-.27-.2-.57-.35z" fill="#fff" />
    </svg>
  );
}

export function TelegramLogo({ size = 24 }: { size?: number } = {}) {
  return (
    <svg viewBox="1 1 22 22" width={size} height={size} aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="11" fill="#29A9EB" />
      <path d="M5.5 11.8 17.7 7.1c.6-.2 1.1.1.9.9l-2 9.4c-.1.7-.5.9-1.1.6l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3 5.5-5c.2-.2 0-.3-.4-.1l-6.8 4.3-2.9-.9c-.6-.2-.6-.6.1-.9z" fill="#fff" />
    </svg>
  );
}

export const LOGOS: Record<string, (props?: { size?: number }) => React.JSX.Element> = {
  Slack: SlackLogo,
  Confluence: ConfluenceLogo,
  Jira: JiraLogo,
  Atlassian: AtlassianLogo,
  WorkBuddy: WorkBuddyLogo,
  WhatsApp: WhatsAppLogo,
  Telegram: TelegramLogo,
};
