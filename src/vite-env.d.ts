/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_HIDE_DEMO_CREDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
