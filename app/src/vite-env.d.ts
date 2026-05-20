/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_XLAYER_RPC_URL?: string;
  readonly VITE_XLAYER_CHAIN_ID?: string;
  readonly VITE_DUEL_CREDIT_ADDRESS?: `0x${string}`;
  readonly VITE_KICKER_NFT_ADDRESS?: `0x${string}`;
  readonly VITE_PENALTY_DUEL_ADDRESS?: `0x${string}`;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
