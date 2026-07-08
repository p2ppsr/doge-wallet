/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BLOCKCYPHER_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

