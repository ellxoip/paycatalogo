import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ShoppingCart, Star, Plus, Minus } from 'lucide-react';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Money from '../../components/ui/Money';
import Skeleton from '../../components/ui/Skeleton';
import Toast from '../../components/ui/Toast';
import {
  fetchCatalog,
  getCart,
  addToCart,
  updateCartQuantity,
  cartTotal,
  parsePrecio,
  type CatalogResponse,
  type CartItem,
} from '../../lib/cart';

export default function Catalog() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const pymeId = searchParams.get('pyme') || '';
  const preselected = (searchParams.get('productos') || '').split(',').filter(Boolean);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pymeId) {
      setError('Falta el parámetro "pyme" en el enlace.');
      setLoading(false);
      return;
    }
    setLoading(true);
    fetchCatalog(pymeId)
      .then((data) => {
        setCatalog(data);
        setCart(getCart(pymeId));
        // Preselecciona (cantidad 1) los productos que vinieron del botón del bot.
        if (preselected.length > 0) {
          let updated = getCart(pymeId);
          for (const productId of preselected) {
            const producto = data.productos.find((p) => p.id === productId);
            if (producto && !updated.some((item) => item.product_id === productId)) {
              updated = addToCart(pymeId, producto, 1);
            }
          }
          setCart(updated);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pymeId]);

  const cartByProduct = useMemo(() => new Map(cart.map((item) => [item.product_id, item])), [cart]);
  const total = useMemo(() => cartTotal(cart), [cart]);

  function handleAdd(producto: CatalogResponse['productos'][number]) {
    setCart(addToCart(pymeId, producto, 1));
  }

  function handleQuantity(productId: string, delta: number) {
    const current = cartByProduct.get(productId)?.cantidad || 0;
    setCart(updateCartQuantity(pymeId, productId, current + delta));
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
      </div>
    );
  }

  if (error || !catalog) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Toast message={error || 'No se pudo cargar el catálogo.'} variant="error" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-32 space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-indigo-950">{catalog.pyme_nombre}</h1>
        <p className="text-sm text-on-surface-variant">Elige lo que quieres comprar y agrégalo al carrito.</p>
      </div>

      {catalog.productos.length === 0 && (
        <Toast message="Esta PYME todavía no tiene productos publicados." />
      )}

      {catalog.productos.map((producto) => {
        const enCarrito = cartByProduct.get(producto.id);
        const precio = parsePrecio(producto.precio);
        return (
          <Card key={producto.id} className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              {producto.imagen_url && (
                <img
                  src={producto.imagen_url}
                  alt={producto.nombre}
                  loading="lazy"
                  className="h-16 w-16 shrink-0 rounded-xl border border-border-subtle object-cover"
                />
              )}
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-900 truncate">{producto.nombre}</h3>
                  {producto.es_estrella && (
                    <Badge variant="warning" showIcon={false}>
                      <Star className="h-3 w-3" /> Destacado
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-on-surface-variant line-clamp-2">{producto.descripcion}</p>
                {precio !== null ? (
                  <Money amount={precio} moneda={catalog.moneda} className="text-lg" />
                ) : (
                  <p className="text-xs italic text-on-surface-variant">Precio a confirmar</p>
                )}
                {typeof producto.stock === 'number' && producto.stock > 0 && producto.stock <= 5 && (
                  <p className="text-[11px] font-semibold text-warning-orange">¡Quedan {producto.stock}!</p>
                )}
              </div>
            </div>

            <div className="shrink-0">
              {!enCarrito ? (
                <Button size="sm" onClick={() => handleAdd(producto)} disabled={precio === null} leftIcon={<Plus className="h-4 w-4" />}>
                  Agregar
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleQuantity(producto.id, -1)}
                    aria-label="Quitar uno"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle hover:bg-surface-container-low"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-6 text-center font-bold">{enCarrito.cantidad}</span>
                  <button
                    onClick={() => handleQuantity(producto.id, 1)}
                    aria-label="Agregar uno más"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle hover:bg-surface-container-low"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </Card>
        );
      })}

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 w-full z-50 border-t border-slate-200 bg-white/95 backdrop-blur-md px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
            <div>
              <p className="text-xs text-on-surface-variant">{cart.reduce((acc, i) => acc + i.cantidad, 0)} producto(s)</p>
              <Money amount={total} moneda={catalog.moneda} className="text-lg" />
            </div>
            <Button
              onClick={() => navigate(`/checkout?pyme=${encodeURIComponent(pymeId)}`)}
              leftIcon={<ShoppingCart className="h-4 w-4" />}
            >
              Ir al carrito
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
