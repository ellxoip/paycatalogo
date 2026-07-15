import { z } from 'zod';

// ============================================================
// Crear orden desde el carrito
// ============================================================

export const cartItemSchema = z.object({
  product_id: z.string().min(1),
  cantidad: z.coerce.number().int().positive().default(1),
});

export const createOrderSchema = z.object({
  pyme_id: z.string().min(1, 'pyme_id es requerido'),
  items: z.array(cartItemSchema).min(1, 'El carrito está vacío'),
  cliente_nombre: z.string().optional(),
  cliente_telefono: z.string().optional(),
  cliente_email: z.string().email().optional().or(z.literal('')),
  provider: z.enum(['flow', 'simulator']).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ============================================================
// Webhook Payload Validation
// ============================================================

export const webhookPayloadSchema = z.object({
  external_attempt_id: z.string().min(1),
  provider_transaction_id: z.string().min(1),
  status: z.enum(['approved', 'rejected', 'failed', 'error']),
  amount: z.number().positive(),
  method: z.string().optional(),
  authorization_code: z.string().optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
});

export type WebhookPayloadInput = z.infer<typeof webhookPayloadSchema>;

// ============================================================
// Reversal Webhook Validation
// ============================================================

export const reversalWebhookSchema = z.object({
  external_payment_id: z.string().min(1),
  provider_transaction_id: z.string().min(1),
  amount: z.number().positive(),
  reason: z.string().min(1),
  provider_reversal_code: z.string().optional(),
});

export type ReversalWebhookInput = z.infer<typeof reversalWebhookSchema>;
