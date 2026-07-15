type ViteImportMeta = ImportMeta & {
  env: {
    VITE_API_BASE_URL?: string;
    VITE_PAYMENT_PROVIDER?: string;
  };
};

export function getApiBaseUrl() {
  return ((import.meta as ViteImportMeta).env.VITE_API_BASE_URL || '').replace(/\/$/, '');
}

export function getPaymentProvider() {
  const provider = (import.meta as ViteImportMeta).env.VITE_PAYMENT_PROVIDER;
  return provider === 'simulator' ? 'simulator' : 'flow';
}
