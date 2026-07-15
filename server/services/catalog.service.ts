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

export class CatalogService {
  async getCatalog(pymeId: string): Promise<CatalogResponse | null> {
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

    return {
      pyme_id: pymeId,
      pyme_nombre: row.pyme_nombre,
      moneda: context.tono?.moneda || 'CLP',
      productos: context.productos ?? [],
    };
  }

  async getProducts(pymeId: string, productIds: string[]): Promise<CatalogProduct[]> {
    const catalog = await this.getCatalog(pymeId);
    if (!catalog) return [];
    const wanted = new Set(productIds);
    return catalog.productos.filter((producto) => wanted.has(producto.id));
  }
}

export const catalogService = new CatalogService();
