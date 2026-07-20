import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, ShoppingBag } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Field from '../../components/ui/Field';
import Money from '../../components/ui/Money';
import Toast from '../../components/ui/Toast';
import {
  getCart,
  updateCartQuantity,
  cartTotal,
  clearCart,
  createOrder,
  fetchCatalog,
  type CartItem,
} from '../../lib/cart';
import { getPaymentProvider } from '../../lib/env';

export default function Checkout() {
  const [searchParams] = useSearchParams();
  const pymeId = searchParams.get('pyme') || '';
  const clienteChatId = searchParams.get('cliente') || undefined; // §10.8 2.2
  const canalOrigen = searchParams.get('canal') || undefined;
  const result = searchParams.get('result');

  const [cart, setCart] = useState<CartItem[]>(pymeId ? getCart(pymeId) : []);
  const [moneda, setMoneda] = useState('CLP');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => cartTotal(cart), [cart]);

  useEffect(() => {
    if (!pymeId) return;
    fetchCatalog(pymeId).then((data) => setMoneda(data.moneda)).catch(() => {});
  }, [pymeId]);

  if (result === 'success') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
        <CheckCircle2 className="mx-auto h-16 w-16 text-success-green" />
        <h1 className="text-2xl font-bold text-slate-900">¡Muchas gracias por tu compra!</h1>
        <p className="text-sm text-on-surface-variant">Tu pago fue confirmado. Te contactaremos para coordinar la entrega.</p>
      </div>
    );
  }

  if (result === 'failed' || result === 'error') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
        <XCircle className="mx-auto h-16 w-16 text-error-red" />
        <h1 className="text-2xl font-bold text-slate-900">El pago no se pudo completar</h1>
        <p className="text-sm text-on-surface-variant">No se realizó ningún cargo. Puedes intentarlo nuevamente.</p>
      </div>
    );
  }

  if (cart.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
        <ShoppingBag className="mx-auto h-16 w-16 text-on-surface-variant" />
        <h1 className="text-xl font-bold text-slate-900">Tu carrito está vacío</h1>
      </div>
    );
  }

  function handleQuantity(productId: string, delta: number) {
    const current = cart.find((item) => item.product_id === productId)?.cantidad || 0;
    setCart(updateCartQuantity(pymeId, productId, current + delta));
  }

  async function handlePay() {
    setSubmitting(true);
    setError(null);
    try {
      const order = await createOrder({
        pyme_id: pymeId,
        items: cart.map((item) => ({ product_id: item.product_id, cantidad: item.cantidad })),
        cliente_nombre: nombre || undefined,
        cliente_telefono: telefono || undefined,
        cliente_chat_id: clienteChatId, // §10.8 2.2 — se propaga al Order y al evento order.paid
        canal_origen: canalOrigen,
        cliente_email: email || undefined,
        provider: getPaymentProvider(),
      });
      clearCart(pymeId);
      window.location.href = order.payment_url;
    } catch (err: any) {
      setError(err.message || 'No se pudo iniciar el pago.');
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-40 space-y-4">
      <h1 className="text-xl font-bold text-slate-900">Tu carrito</h1>

      {error && <Toast variant="error" message={error} onClose={() => setError(null)} />}

      <Card className="divide-y divide-border-subtle">
        {cart.map((item) => (
          <div key={item.product_id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{item.nombre}</p>
              <Money amount={item.precio} moneda={moneda} className="text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleQuantity(item.product_id, -1)}
                aria-label="Quitar uno"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle hover:bg-surface-container-low"
              >
                -
              </button>
              <span className="w-6 text-center font-bold">{item.cantidad}</span>
              <button
                onClick={() => handleQuantity(item.product_id, 1)}
                aria-label="Agregar uno más"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle hover:bg-surface-container-low"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">Tus datos de contacto</h2>
        <Field label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" />
        <Field label="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="+56 9 1234 5678" />
        <Field label="Correo (opcional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.cl" />
      </Card>

      <div className="fixed bottom-0 left-0 w-full z-50 border-t border-slate-200 bg-white/95 backdrop-blur-md px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div>
            <p className="text-xs text-on-surface-variant">Total</p>
            <Money amount={total} moneda={moneda} className="text-lg" />
          </div>
          <Button onClick={handlePay} isLoading={submitting} size="lg">
            Ir a pagar
          </Button>
        </div>
      </div>
    </div>
  );
}
