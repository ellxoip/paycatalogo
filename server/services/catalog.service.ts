import { Pool } from 'pg';
import type { CatalogProduct, CatalogResponse } from '../types/index.js';

// Solo-lectura contra la MISMA base Postgres/Supabase que usa Zelix
// (supabase/migrations/0001_esquema_inicial.sql en el repo zelix). zelixpay
// nunca escribe en `pymes`/`perfiles` — el catálogo lo es todo lo dueño el
// Extractor/scroller de Zelix. Pool separado del de Prisma porque son dos
// bases lógicas distintas aunque compartan el mismo servidor Postgres.
const pool = new Pool({
  connectionString: process.env.ZELIX_DATABASE_URL || process.env.DATABASE_URL,
  max: 5,
});

// Misma regla que productoDisponible en el repo zelix (messageRules.ts, Fase 4j):
// ausente = activo y sin gestión de stock (retrocompatible v1.2/v1.3).
export function productoDisponible(p: CatalogProduct): boolean {
  return p.activo !== false && p.stock !== 0;
}

export class CatalogService {
  /**
   * Catálogo vigente de la PYME. Por defecto solo productos disponibles —
   * el carrito jamás vitrinea lo pausado/agotado (espejo de
   * filtrarCatalogoDisponible en zelix). `incluirNoDisponibles` existe para
   * que la creación de orden distinga "no existe" de "agotado".
   */
  async getCatalog(pymeId: string, opts: { incluirNoDisponibles?: boolean } = {}): Promise<CatalogResponse | null> {
    const { rows } = await pool.query(
      `select p.nombre as pyme_nombre, pf.pyme_context
         from perfiles pf
         join pymes p on p.id = pf.pyme_id
        where pf.pyme_id = $1
          and pf.estado = 'vigente'
        order by pf.version desc
        limit 1`,
      [pymeId],
    );

    const row = rows[0];
    if (!row) return null;

    const context = row.pyme_context as {
      productos?: CatalogProduct[];
      tono?: { moneda?: string };
    };

    const productos = context.productos ?? [];
    return {
      pyme_id: pymeId,
      pyme_nombre: row.pyme_nombre,
      moneda: context.tono?.moneda || 'CLP',
      productos: opts.incluirNoDisponibles ? productos : productos.filter(productoDisponible),
    };
  }
}

export const catalogService = new CatalogService();
