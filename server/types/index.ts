// ============================================================
// Catálogo (leído en solo-lectura desde perfiles.pyme_context — base Zelix)
// ============================================================

// Espejo de ProductoSchema del contrato pyme_context (repo zelix, v1.5+):
// stock/activo (v1.4, Fase 4j) e imagen_url (v1.5, Fase 5c) son opcionales —
// los contextos viejos no los tienen.
export interface CatalogProduct {
  id: string;
  nombre: string;
  tipo: 'producto' | 'servicio';
  descripcion: string;
  precio: string | null;
  es_estrella: boolean;
  /** v1.4: cantidad disponible; ausente = no se gestiona stock; 0 = no disponible */
  stock?: number;
  /** v1.4: false = pausado por el dueño */
  activo?: boolean;
  /** v1.5: foto del producto (Supabase Storage) */
  imagen_url?: string | null;
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
  cliente_chat_id?: string; // §10.8 2.2 — identidad para unir el pago a la conversación
  canal_origen?: string;
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
