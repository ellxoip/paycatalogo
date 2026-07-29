/**
 * CANDADO DE PARIDAD (lado zelixpay) + el contrato de cobro.
 *
 * `shared/precio.generado.ts` es una COPIA de la sede única que vive en el repo
 * `zelix` (src/backend/precio.ts). Este test es la mitad del candado que impide
 * que las dos versiones se separen: corre exactamente los mismos casos que el
 * gemelo del otro repo, leídos del mismo JSON generado.
 *
 * Por qué importa tanto acá: este módulo decide **cuánto se le cobra a una
 * persona real**. Las tres implementaciones que reemplazó fallaban todas en la
 * misma dirección —cobrando de menos— y la diferencia no la perdía Zelix, la
 * perdía la pyme que ya había despachado el producto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leerPrecioCatalogo, valorPrecioCatalogo, formatearCLP } from '../shared/precio.generado.js';

const RAIZ = join(import.meta.dirname, '..');
const CASOS = join(RAIZ, 'shared/precio.casos.json');
const COPIA = join(RAIZ, 'shared/precio.generado.ts');
const HASH = join(RAIZ, 'shared/precio.hash.json');

interface Caso {
  precio: string;
  cobra: number | null;
  motivo: string | null;
  bug?: string;
}
const casos: Caso[] = JSON.parse(readFileSync(CASOS, 'utf8')).casos;

describe('la copia no fue editada a mano', () => {
  it('declara su hash de origen', () => {
    const registrado = JSON.parse(readFileSync(HASH, 'utf8')).hashFuente;
    expect(registrado).toMatch(/^[0-9a-f]{16}$/);
    expect(readFileSync(COPIA, 'utf8')).toContain(`hash-fuente: ${registrado}`);
  });

  it('se declara como generada, para que nadie la edite creyendo que es fuente', () => {
    expect(readFileSync(COPIA, 'utf8')).toContain('NO EDITAR A MANO');
  });
});

describe('cuánto se cobra — set canónico compartido con el repo zelix', () => {
  it.each(casos)('$precio → $cobra', ({ precio, cobra, motivo }) => {
    const r = leerPrecioCatalogo(precio);
    if (cobra === null) {
      expect(r.cobrable).toBe(false);
      if (r.cobrable === false) expect(r.motivo).toBe(motivo);
    } else {
      expect(r).toEqual({ cobrable: true, valor: cobra });
    }
  });
});

describe('los subcobros que este módulo vino a eliminar', () => {
  it('ningún caso del set se cobra por menos de lo que vale', () => {
    // El bug era estructural: "primer número gana". Este test lo vigila como
    // clase entera, no caso por caso.
    for (const c of casos.filter((x) => x.cobra !== null)) {
      expect(valorPrecioCatalogo(c.precio), c.precio).toBe(c.cobra);
    }
  });

  it('un precio que no se puede leer NUNCA se convierte en un número', () => {
    // Devolver 0 o adivinar el primer dígito es lo que producía cobros de $2.
    for (const c of casos.filter((x) => x.cobra === null)) {
      expect(valorPrecioCatalogo(c.precio), c.precio).toBeNull();
    }
  });
});

describe('formato', () => {
  it('plata chilena, sin decimales', () => {
    expect(formatearCLP(12990)).toBe('$12.990');
    expect(formatearCLP(990)).toBe('$990');
  });
});
