import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ShoppingCart, ArrowLeft, Lock } from 'lucide-react';

export default function ClientLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const isCheckoutPage = location.pathname.startsWith('/checkout');

  return (
    <div className="bg-background-main font-body-base text-text-charcoal min-h-screen flex flex-col">
      {isCheckoutPage ? (
        <header className="flex justify-between items-center px-6 h-16 w-full sticky top-0 z-40 bg-white border-b border-slate-200">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              aria-label="Volver"
              className="flex items-center justify-center w-11 h-11 rounded-full hover:bg-slate-50 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-6 h-6 text-slate-900" />
            </button>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight font-display-lg">Carrito Zelix</h1>
          </div>
          <div className="flex items-center gap-4">
            <Lock className="w-5 h-5 text-slate-900" />
          </div>
        </header>
      ) : (
        <header className="flex justify-between items-center w-full px-6 py-3 sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
          <div className="flex items-center gap-2">
            <div className="bg-primary-container p-1 rounded-lg">
              <ShoppingCart className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold text-indigo-950 font-headline-md">Carrito Zelix</span>
          </div>
        </header>
      )}

      <Outlet />
    </div>
  );
}
