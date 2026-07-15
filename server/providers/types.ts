// ============================================================
// Payment Provider Abstraction Layer
// ============================================================

/**
 * Represents the current environment mode for a payment provider.
 */
export type ProviderEnvironment = 'sandbox' | 'production';

/**
 * Supported payment providers in PagaCuotas.
 */
export type ProviderName = 'flow' | 'simulator';

/**
 * Request to initiate a payment transaction with a provider.
 */
export interface ProviderCreateTransactionRequest {
  /** PagaCuotas internal attempt ID */
  external_attempt_id: string;
  /** Total amount in CLP (integer, no decimals) */
  amount: number;
  /** Currency code */
  currency: string;
  /** Description shown to the customer */
  description: string;
  /** Customer email */
  customer_email?: string;
  /** Customer name */
  customer_name?: string;
  /** URL to redirect after payment success */
  return_url: string;
  /** URL to redirect after payment cancel/failure */
  cancel_url: string;
  /** URL for server-to-server webhook notification */
  notification_url: string;
  /** Additional provider-specific metadata */
  metadata?: Record<string, any>;
}

/**
 * Response after initiating a transaction with a provider.
 */
export interface ProviderCreateTransactionResponse {
  /** Provider's own transaction/token ID */
  provider_transaction_id: string;
  /** URL to redirect the customer to complete payment */
  payment_url: string;
  /** Provider name */
  provider: ProviderName;
  /** Raw response from provider for audit */
  raw_response: Record<string, any>;
}

/**
 * Result after confirming/committing a transaction with the provider.
 */
export interface ProviderConfirmTransactionResponse {
  /** Whether the payment was approved */
  approved: boolean;
  /** Provider's transaction ID */
  provider_transaction_id: string;
  /** Authorization code from the provider */
  authorization_code?: string;
  /** Payment method used (tarjeta, transferencia, etc.) */
  payment_method?: string;
  /** Card type if applicable (VISA, MASTERCARD, etc.) */
  card_type?: string;
  /** Last 4 digits of card if applicable */
  card_last_four?: string;
  /** Installments count */
  installments?: number;
  /** Final confirmed amount */
  amount: number;
  /** Status from the provider */
  status: 'approved' | 'rejected' | 'error' | 'pending';
  /** Rejection/error reason if applicable */
  reason?: string;
  /** Error code from provider */
  error_code?: string;
  /** Raw response from provider for audit */
  raw_response: Record<string, any>;
}

/**
 * Result after requesting a refund/reversal.
 */
export interface ProviderRefundResponse {
  /** Whether the refund was processed */
  success: boolean;
  /** Provider's refund reference ID */
  provider_refund_id?: string;
  /** Amount refunded */
  amount_refunded: number;
  /** Status */
  status: 'refunded' | 'pending' | 'failed';
  /** Reason if failed */
  reason?: string;
  /** Raw response */
  raw_response: Record<string, any>;
}

/**
 * Transaction status query result.
 */
export interface ProviderTransactionStatus {
  provider_transaction_id: string;
  status: 'approved' | 'rejected' | 'pending' | 'cancelled' | 'refunded' | 'error';
  amount: number;
  payment_method?: string;
  raw_response: Record<string, any>;
}

/**
 * Configuration for a payment provider.
 */
export interface ProviderConfig {
  name: ProviderName;
  environment: ProviderEnvironment;
  enabled: boolean;
  credentials: Record<string, string>;
  options?: Record<string, any>;
}

/**
 * Interface that all payment providers must implement.
 */
export interface IPaymentProvider {
  /** Provider identifier */
  readonly name: ProviderName;
  /** Current environment */
  readonly environment: ProviderEnvironment;

  /** Create a new payment transaction */
  createTransaction(request: ProviderCreateTransactionRequest): Promise<ProviderCreateTransactionResponse>;

  /** Confirm/commit a transaction (called after provider callback) */
  confirmTransaction(token: string): Promise<ProviderConfirmTransactionResponse>;

  /** Query the status of a transaction */
  getTransactionStatus(providerTransactionId: string): Promise<ProviderTransactionStatus>;

  /** Request a refund for a completed transaction */
  refundTransaction(providerTransactionId: string, amount: number): Promise<ProviderRefundResponse>;

  /** Validate a webhook signature from the provider */
  validateWebhookSignature(headers: Record<string, string>, body: any): boolean;

  /** Check if the provider connection is healthy */
  healthCheck(): Promise<{ healthy: boolean; message: string }>;
}
