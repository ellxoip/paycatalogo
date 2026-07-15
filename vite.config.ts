import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Se sirve bajo www.zelix.cl/catalogo/pay — base hace que Vite emita rutas de
// assets relativas a ese prefijo tanto en dev como en el build de producción.
export default defineConfig({
  base: '/catalogo/pay/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
