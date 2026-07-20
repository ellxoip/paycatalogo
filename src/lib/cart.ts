import { getApiBaseUrl } from './env';

export interface CatalogProduct {
  id: string;
  nombre: string;
  tipo: 'producto' | 'servicio';
  descripcion: string;
  precio: string | null;
  es_estrella: boolean;
  /** v1.4 del contrato: ausente = sin gestión de stock (el backend ya filtró los agotados) */
  stock?: number;
  /** v1.5 del contrato: foto del producto */
  imagen_url?: string | null;
}

export interface CatalogResponse {
  ok: true;
  pyme_id: string;
  pyme_nombre: string;
  moneda: string;
  productos: CatalogProduct[];
}

export interface CartItem {
  product_id: string;
  nombre: string;
  precio: number;
  cantidad: number;
}

export interface CreateOrderResponse {
  ok: true;
  order_id: string;
  attempt_id: string;
  external_attempt_id: string;
  provider: string;
  provider_environment: string;
  payment_url: string;
  total: number;
  moneda: string;
}

const API_BASE_URL = getApiBaseUrl();
const CART_KEY = 'zelixpay.cart';

// El precio del catálogo es texto libre ("$12.990", null); se extrae el primer
// número. Productos sin precio publicado no se pueden agregar al carrito — el
// backend re-valida esto igual al crear la orden.
export function parsePrecio(precio: string | null): number | null {
  if (!precio) return null;
  const match = precio.replace(/\./g, '').replace(/,/g, '.').match(/\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

export function formatCurrency(amount: number, moneda = 'CLP') {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0,
  }).format(amount);
}

function cartKey(pymeId: string) {
  return `${CART_KEY}.${pymeId}`;
}

export function getCart(pymeId: string): CartItem[] {
  const raw = window.sessionStorage.getItem(cartKey(pymeId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

function saveCart(pymeId: string, items: CartItem[]) {
  window.sessionStorage.setItem(cartKey(pymeId), JSON.stringify(items));
}

export function addToCart(pymeId: string, product: CatalogProduct, cantidad = 1): CartItem[] {
  const precio = parsePrecio(product.precio);
  if (precio === null) return getCart(pymeId);

  const items = getCart(pymeId);
  const existing = items.find((item) => item.product_id === product.id);
  if (existing) {
    existing.cantidad += cantidad;
  } else {
    items.push({ product_id: product.id, nombre: product.nombre, precio, cantidad });
  }
  saveCart(pymeId, items);
  return items;
}

export function updateCartQuantity(pymeId: string, productId: string, cantidad: number): CartItem[] {
  let items = getCart(pymeId);
  if (cantidad <= 0) {
    items = items.filter((item) => item.product_id !== productId);
  } else {
    const existing = items.find((item) => item.product_id === productId);
    if (existing) existing.cantidad = cantidad;
  }
  saveCart(pymeId, items);
  return items;
}

export function clearCart(pymeId: string) {
  window.sessionStorage.removeItem(cartKey(pymeId));
}

export function cartTotal(items: CartItem[]) {
  return items.reduce((acc, item) => acc + item.precio * item.cantidad, 0);
}

export async function fetchCatalog(pymeId: string): Promise<CatalogResponse> {
  const response = await fetch(`${API_BASE_URL}/api/catalog/${encodeURIComponent(pymeId)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'No se pudo cargar el catálogo.');
  }
  return data as CatalogResponse;
}

export async function createOrder(payload: {
  pyme_id: string;
  items: Array<{ product_id: string; cantidad: number }>;
  cliente_nombre?: string;
  cliente_telefono?: string;
  cliente_email?: string;
  cliente_chat_id?: string; // §10.8 2.2 — identidad para unir el pago a la conversación
  canal_origen?: string;
  provider?: string;
}): Promise<CreateOrderResponse> {
  const response = await fetch(`${API_BASE_URL}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'No se pudo iniciar el pago.');
  }
  return data as CreateOrderResponse;
}
