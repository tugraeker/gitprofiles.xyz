interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PUBLIC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  gitprofilesDesktop?: {
    validateProfile: (profileJson: string) => Promise<{ valid: boolean }>;
    openExternal: (url: string) => Promise<void>;
    onAuthCallback: (handler: (url: string) => void) => () => void;
  };
}
