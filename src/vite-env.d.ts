/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Optional: Supabase Storage Bucket-ID für Pictureload (Standard: pictureload) */
  readonly VITE_SUPABASE_STORAGE_BUCKET_PICTURELOAD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
