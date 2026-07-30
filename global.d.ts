export {};

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action: "turnstile-spin-v2";
          theme: "dark";
          size: "flexible";
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}
