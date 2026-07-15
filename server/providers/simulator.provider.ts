import type {
  IPaymentProvider,
  ProviderName,
  ProviderEnvironment,
  ProviderCreateTransactionRequest,
  ProviderCreateTransactionResponse,
  ProviderConfirmTransactionResponse,
  ProviderRefundResponse,
  ProviderTransactionStatus,
} from './types.js';

export class SimulatorProvider implements IPaymentProvider {
  readonly name: ProviderName = 'simulator';
  readonly environment: ProviderEnvironment = 'sandbox';

  private transactions = new Map<string, {
    request: ProviderCreateTransactionRequest;
    status: 'pending' | 'approved' | 'rejected' | 'refunded';
  }>();

  private simulatedDelay: number;

  constructor(options?: { delayMs?: number }) {
    this.simulatedDelay = options?.delayMs ?? 500;
  }

  async createTransaction(request: ProviderCreateTransactionRequest): Promise<ProviderCreateTransactionResponse> {
    await this.delay();

    // El monto se codifica en el token (`_a<monto>`) para que confirmTransaction
    // pueda derivar el outcome aun en entornos serverless (Vercel), donde el Map
    // en memoria NO sobrevive entre invocaciones (create y confirm corren en
    // funciones distintas).
    const providerTxId = `sim_txn_${Date.now()}_${Math.floor(Math.random() * 100000)}_a${Math.round(request.amount)}`;
    this.transactions.set(providerTxId, { request, status: 'pending' });

    return {
      provider_transaction_id: providerTxId,
      payment_url: `${request.return_url}?provider=simulator&token=${providerTxId}&simulated=true`,
      provider: this.name,
      raw_response: {
        simulated: true,
        provider_transaction_id: providerTxId,
        external_attempt_id: request.external_attempt_id,
      },
    };
  }

  async confirmTransaction(token: string): Promise<ProviderConfirmTransactionResponse> {
    await this.delay();

    const txn = this.transactions.get(token);
    // Serverless-safe: si el Map no tiene la txn (otra invocación), recupera el
    // monto codificado en el token. Solo error real si no hay ninguno de los dos.
    const amount = txn?.request.amount ?? this.parseAmountFromToken(token);
    if (amount == null) {
      return {
        approved: false,
        provider_transaction_id: token,
        amount: 0,
        status: 'error',
        reason: 'Transaction not found in simulator',
        error_code: 'SIM_NOT_FOUND',
        raw_response: { simulated: true, error: 'not_found' },
      };
    }

    const outcome = this.determineOutcome(amount);
    if (txn) txn.status = outcome.approved ? 'approved' : 'rejected';

    return {
      approved: outcome.approved,
      provider_transaction_id: token,
      authorization_code: outcome.approved ? `SIM_AUTH_${Math.floor(Math.random() * 999999)}` : undefined,
      payment_method: 'pago_prueba_pagacuotas',
      card_type: 'SIM',
      card_last_four: '4242',
      installments: 1,
      amount,
      status: outcome.approved ? 'approved' : 'rejected',
      reason: outcome.reason,
      error_code: outcome.errorCode,
      raw_response: {
        simulated: true,
        external_attempt_id: txn?.request.external_attempt_id,
        outcome: outcome.approved ? 'approved' : 'rejected',
        rule: outcome.rule,
      },
    };
  }

  async getTransactionStatus(providerTransactionId: string): Promise<ProviderTransactionStatus> {
    await this.delay();
    const txn = this.transactions.get(providerTransactionId);

    if (!txn) {
      // Serverless: sin Map, deriva del token. Un pago confirmado vía callback
      // ya quedó persistido en DB; aquí reportamos approved si el monto es válido.
      const amount = this.parseAmountFromToken(providerTransactionId);
      if (amount == null) {
        return {
          provider_transaction_id: providerTransactionId,
          status: 'error',
          amount: 0,
          raw_response: { simulated: true, error: 'not_found' },
        };
      }
      const outcome = this.determineOutcome(amount);
      return {
        provider_transaction_id: providerTransactionId,
        status: outcome.approved ? 'approved' : 'rejected',
        amount,
        payment_method: 'pago_prueba_pagacuotas',
        raw_response: { simulated: true, derivedFromToken: true },
      };
    }

    return {
      provider_transaction_id: providerTransactionId,
      status: txn.status === 'pending' ? 'pending' : txn.status,
      amount: txn.request.amount,
      payment_method: 'pago_prueba_pagacuotas',
      raw_response: { simulated: true, status: txn.status },
    };
  }

  async refundTransaction(providerTransactionId: string, amount: number): Promise<ProviderRefundResponse> {
    await this.delay();
    const txn = this.transactions.get(providerTransactionId);

    if (!txn || txn.status !== 'approved') {
      return {
        success: false,
        amount_refunded: 0,
        status: 'failed',
        reason: txn ? 'Transaction not in approved state' : 'Transaction not found',
        raw_response: { simulated: true },
      };
    }

    txn.status = 'refunded';
    return {
      success: true,
      provider_refund_id: `sim_refund_${Date.now()}`,
      amount_refunded: amount,
      status: 'refunded',
      raw_response: { simulated: true, refunded: true },
    };
  }

  validateWebhookSignature(): boolean {
    return true;
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    return { healthy: true, message: 'PagaCuotas simulator enabled for sandbox payments' };
  }

  // Extrae el monto codificado en el token (`..._a<monto>`). null si no aplica.
  private parseAmountFromToken(token: string): number | null {
    const m = /_a(\d+)$/.exec(token);
    return m ? Number(m[1]) : null;
  }

  private determineOutcome(amount: number): { approved: boolean; reason?: string; errorCode?: string; rule: string } {
    const lastTwoDigits = amount % 100;
    if (lastTwoDigits === 99) return { approved: false, reason: 'Fondos insuficientes (simulado)', errorCode: 'SIM_INSUFFICIENT_FUNDS', rule: 'amount_ends_99' };
    if (lastTwoDigits === 88) return { approved: false, reason: 'Tarjeta bloqueada (simulado)', errorCode: 'SIM_CARD_BLOCKED', rule: 'amount_ends_88' };
    if (lastTwoDigits === 77) return { approved: false, reason: 'Error de comunicacion (simulado)', errorCode: 'SIM_COMM_ERROR', rule: 'amount_ends_77' };
    return { approved: true, rule: 'default_approve' };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.simulatedDelay));
  }
}
