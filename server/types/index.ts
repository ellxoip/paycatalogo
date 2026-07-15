// ============================================================
// Catálogo (leído en solo-lectura desde perfiles.pyme_context — base Zelix)
// ============================================================

export interface CatalogProduct {
  id: string;
  nombre: string;
  tipo: 'producto' | 'servicio';
  descripcion: string;
  precio: string | null;
  es_estrella: boolean;
}

export interface CatalogResponse {
  pyme_id: string;
  pyme_nombre: string;
  moneda: string;
  productos: CatalogProduct[];
}

// ============================================================
// Carrito / Orden
// ============================================================

export interface CartItemInput {
  product_id: string;
  cantidad: number;
}

export interface CreateOrderRequest {
  pyme_id: string;
  items: CartItemInput[];
  cliente_nombre?: string;
  cliente_telefono?: string;
  cliente_email?: string;
  provider?: string;
}

// ============================================================
// Webhook / Provider Types
// ============================================================

export interface WebhookProviderPayload {
  external_attempt_id: string;
  provider_transaction_id: string;
  status: 'approved' | 'rejected' | 'failed' | 'error';
  amount: number;
  method?: string;
  authorization_code?: string;
  error_code?: string;
  error_message?: string;
}

export interface ReversalWebhookPayload {
  external_payment_id: string;
  provider_transaction_id: string;
  amount: number;
  reason: string;
  provider_reversal_code?: string;
}

// ============================================================
// Sync Status
// ============================================================

export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface IntegrationError {
  message: string;
  status: number;
  details: any;
  code?: string;
}
