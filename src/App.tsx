import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import ClientLayout from './components/client/ClientLayout';

const Catalog = lazy(() => import('./pages/client/Catalog'));
const Checkout = lazy(() => import('./pages/client/Checkout'));

function PageFallback() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Cargando"
      className="flex min-h-screen w-full items-center justify-center bg-surface-container-lowest"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-surface-container-high border-t-primary motion-reduce:animate-none" />
        <p className="text-sm text-on-surface-variant">Cargando…</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/catalogo/pay">
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<ClientLayout />}>
            <Route index element={<Catalog />} />
            <Route path="checkout" element={<Checkout />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
