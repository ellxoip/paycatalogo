import crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';
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

export class FlowProvider implements IPaymentProvider {
  readonly name: ProviderName = 'flow';
  readonly environment: ProviderEnvironment;

  private apiKey: string;
  private secretKey: string;
  private client: AxiosInstance;

  constructor(config: { environment: ProviderEnvironment; apiKey: string; secretKey: string }) {
    this.environment = config.environment;
    this.apiKey = config.apiKey;
    this.secretKey = config.secretKey;
    this.client = axios.create({
      baseURL: config.environment === 'production' ? 'https://www.flow.cl/api' : 'https://sandbox.flow.cl/api',
      timeout: 20000,
    });
  }

  async createTransaction(request: ProviderCreateTransactionRequest): Promise<ProviderCreateTransactionResponse> {
    if (this.environment === 'sandbox' && this.isPlaceholderConfig()) return this.sandboxCreate(request);

    const params = {
      apiKey: this.apiKey,
      commerceOrder: request.external_attempt_id,
      subject: request.description,
      currency: request.currency || 'CLP',
      amount: Math.round(request.amount),
      email: request.customer_email || 'cliente@pagacuotas.local',
      urlConfirmation: `${request.notification_url}/flow`,
      urlReturn: `${request.return_url}?provider=flow`,
      optional: JSON.stringify({
        ...(request.metadata || {}),
        external_attempt_id: request.external_attempt_id,
      }),
    };
    const response = await this.postSigned('/payment/create', params);

    return {
      provider_transaction_id: response.token,
      payment_url: `${response.url}?token=${encodeURIComponent(response.token)}`,
      provider: this.name,
      raw_response: response,
    };
  }

  async confirmTransaction(token: string): Promise<ProviderConfirmTransactionResponse> {
    if (this.environment === 'sandbox' && token.startsWith('flow_sandbox_')) return this.sandboxConfirm(token);

    const data = await this.getSigned('/payment/getStatus', { apiKey: this.apiKey, token });
    const status = Number(data.status);
    const approved = status === 2;
    return {
      approved,
      provider_transaction_id: token,
      authorization_code: data.flowOrder ? String(data.flowOrder) : undefined,
      payment_method: data.paymentData?.media || data.paymentData?.paymentMethod || 'flow',
      amount: Number(data.amount || 0),
      status: approved ? 'approved' : status === 1 ? 'pending' : 'rejected',
      reason: approved ? undefined : data.status_desc || data.status,
      error_code: approved ? undefined : String(status),
      raw_response: data,
    };
  }

  async getTransactionStatus(providerTransactionId: string): Promise<ProviderTransactionStatus> {
    const confirmation = await this.confirmTransaction(providerTransactionId);
    return {
      provider_transaction_id: providerTransactionId,
      status: confirmation.status === 'approved' ? 'approved' : confirmation.status === 'pending' ? 'pending' : 'rejected',
      amount: confirmation.amount,
      payment_method: confirmation.payment_method,
      raw_response: confirmation.raw_response,
    };
  }

  async refundTransaction(_providerTransactionId: string, amount: number): Promise<ProviderRefundResponse> {
    return {
      success: false,
      amount_refunded: 0,
      status: 'failed',
      reason: 'Flow refunds require manual/commercial configuration',
      raw_response: { amount },
    };
  }

  validateWebhookSignature(_headers: Record<string, string>, body: any): boolean {
    if (this.environment === 'sandbox' && this.isPlaceholderConfig()) return true;
    const token = body?.token;
    return Boolean(token);
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    const missing = this.isPlaceholderConfig();
    if (this.environment === 'production' && missing) {
      return { healthy: false, message: 'Flow production credentials missing' };
    }
    return { healthy: true, message: `Flow ${this.environment} configured - API Key: ${this.apiKey.slice(0, 8)}...` };
  }

  private async postSigned(path: string, params: Record<string, any>) {
    const signed = this.sign(params);
    const body = new URLSearchParams(Object.entries(signed).map(([key, value]) => [key, String(value)]));
    const response = await this.client.post(path, body, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    return response.data;
  }

  private async getSigned(path: string, params: Record<string, any>) {
    const signed = this.sign(params);
    const response = await this.client.get(path, { params: signed });
    return response.data;
  }

  private sign(params: Record<string, any>) {
    const sorted = Object.keys(params).sort().reduce<Record<string, any>>((acc, key) => {
      if (params[key] !== undefined && params[key] !== null) acc[key] = params[key];
      return acc;
    }, {});
    const toSign = Object.entries(sorted).map(([key, value]) => `${key}${value}`).join('');
    return { ...sorted, s: crypto.createHmac('sha256', this.secretKey).update(toSign).digest('hex') };
  }

  private isPlaceholderConfig() {
    return !this.apiKey || !this.secretKey || this.apiKey.includes('change_me') || this.secretKey.includes('change_me');
  }

  private async sandboxCreate(request: ProviderCreateTransactionRequest): Promise<ProviderCreateTransactionResponse> {
    const token = `flow_sandbox_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    return {
      provider_transaction_id: token,
      payment_url: `${request.return_url}?provider=flow&token=${token}`,
      provider: this.name,
      raw_response: { sandbox: true, token, commerceOrder: request.external_attempt_id },
    };
  }

  private async sandboxConfirm(token: string): Promise<ProviderConfirmTransactionResponse> {
    return {
      approved: true,
      provider_transaction_id: token,
      authorization_code: `FLOW_${Math.floor(Math.random() * 999999)}`,
      payment_method: 'flow',
      amount: 0,
      status: 'approved',
      raw_response: { sandbox: true, status: 2 },
    };
  }
}
