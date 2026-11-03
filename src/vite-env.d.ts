interface ImportMetaEnv {
  readonly VITE_PUBLIC_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {}

interface Window {
  gitprofilesDesktop?: {
    validateProfile(profileJson: string): Promise<{ valid: boolean; errors: string[] }>;
    openExternal(url: string): Promise<boolean>;
    onAuthCallback(handler: (callbackUrl: string) => void): () => void;
  };
}
