/**
 * ARCHIVO GENERADO — NO EDITAR A MANO.
 *
 * Copia verificada de la sede única del precio, que vive en el repo `zelix`:
 *   src/backend/precio.ts
 *
 * Se regenera con `npm run precio:generar` desde ese repo. Si editas esto a
 * mano, `precioParidad.test.ts` falla en los dos repos — a propósito: este
 * módulo decide cuánto se le cobra a un cliente real, y una divergencia
 * silenciosa entre lo que el carrito MUESTRA y lo que el cobro EJECUTA es la
 * peor clase de bug que puede tener una pasarela de pagos.
 *
 * hash-fuente: c0a3c0ffa7c2be2b
 */

// Token monetario: $12.990 · $ 5.000 · 3.990 pesos · 12000 CLP · 25 lucas · 25k · 25 mil
const MONTO_RE =
  /\$\s?\d[\d.,]*\s*(?:mil|k\b|lucas?\b)?|\b\d[\d.,]*\s*(?:pesos|clp|lucas?|luca|mil)\b|\b\d[\d.,]*k\b/gi;

/** Parte numérica → número ("12.990" → 12990 [miles chilenos]; "2,5" → 2.5). */
function parseNumero(s: string): number | null {
  const limpio = s.trim();
  if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) return Number(limpio.replace(/\./g, ""));
  const n = Number(limpio.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Valor CLP de un token monetario ("$12.990"→12990, "25 lucas"→25000, "2.5k"→2500). */
function valorDeToken(token: string): number | null {
  const m = token.match(/([\d.,]+)/);
  if (!m) return null;
  const base = parseNumero(m[1]);
  if (base == null) return null;
  const esMiles = /(lucas?|luca|mil|k)\s*$/i.test(token.trim());
  const valor = esMiles ? Math.round(base * 1000) : base;
  return Number.isInteger(valor) ? valor : Math.round(valor);
}

export type ContextoMonto = "normal" | "rango" | "descuento";

export interface Monto {
  valor: number;
  contexto: ContextoMonto;
}

// Conectores de DESCUENTO: rebaja declarada sobre el catálogo.
const DESCUENTO_ANTES_RE =
  /(te\s+l[oa]s?\s+(dejo|puedo\s+dejar)\s+(en|a)|con\s+descuento(\s+queda)?(\s+(en|a))?|rebajad[oa]s?\s+a|te\s+hago\s+precio(\s+(en|a))?|queda(n)?\s+en\s+solo|solo\s+(por\s+)?hoy\s+a|oferta\s+especial\s+(a|de)|liquidaci[oó]n\s+a)\s*[:.]?\s*$/i;

// Conectores de RANGO/presupuesto.
const RANGO_ANTES_RE =
  /(entre|desde|hasta|menos\s+de|m[aá]s\s+de|m[aá]ximo|m[aá]x\.?|presupuesto(\s+de)?|tope(\s+de)?|alrededor\s+de|aprox(\.|imadamente)?|unos|unas|como)\s*$/i;
// El segundo término de "entre X y Y": un "y"/"a" pegado al monto anterior.
const RANGO_PUENTE_RE = /^(\s*(y|a|o)\s*)$/i;

/**
 * Monto mínimo que se acepta como PRECIO. Bajo esto se trata de cantidad, talla
 * o gramaje ("2 x", "5kg", "12 unidades") — que es justo lo que las tres copias
 * confundían con el precio.
 */
export const PRECIO_MINIMO = 100;

/** Extrae los montos del texto con su contexto gramatical (mirando lo que precede). */
export function extraerMontos(texto: string): Monto[] {
  const out: Monto[] = [];
  const t = texto ?? "";
  let finAnterior = -1;
  let anteriorFueRango = false;
  for (const m of t.matchAll(MONTO_RE)) {
    const valor = valorDeToken(m[0]);
    if (valor == null || valor < PRECIO_MINIMO) continue; // cantidades/tallas no son precios
    const antes = t.slice(Math.max(0, m.index! - 30), m.index!);
    let contexto: ContextoMonto = "normal";
    if (DESCUENTO_ANTES_RE.test(antes)) contexto = "descuento";
    else if (RANGO_ANTES_RE.test(antes)) contexto = "rango";
    else if (anteriorFueRango && finAnterior >= 0 && RANGO_PUENTE_RE.test(t.slice(finAnterior, m.index!)))
      contexto = "rango"; // el "y 30" de "entre 20 y 30"
    out.push({ valor, contexto });
    finAnterior = m.index! + m[0].length;
    anteriorFueRango = contexto === "rango";
  }
  return out;
}

/** Compat: solo los valores (lo usan tests y telemetría). */
export function extraerPrecios(texto: string): number[] {
  return extraerMontos(texto).map((m) => m.valor);
}

/** Por qué un precio de catálogo NO se puede cobrar. Explícito para poder decírselo al cliente. */
export type MotivoPrecioNoCobrable =
  | "sin_precio" // no hay ningún monto reconocible
  | "rango" // "desde $5.000" / "entre $3.000 y $9.000": el precio real no está declarado
  | "ambiguo"; // varios montos distintos sin forma de saber cuál es el del producto

export type LecturaPrecio =
  | { cobrable: true; valor: number }
  | { cobrable: false; motivo: MotivoPrecioNoCobrable };

/**
 * Lee el campo `precio` de un producto de catálogo y decide si se puede COBRAR.
 *
 * Fail-closed por diseño. Los tres casos que devuelven `cobrable:false` son
 * exactamente aquellos en que las implementaciones anteriores inventaban un
 * número:
 *
 *   · "desde $5.000"           → el dueño declaró un piso, no un precio
 *   · "entre $3.000 y $9.000"  → dos precios; cobrar el menor es regalar plata
 *   · "" / "Consultar"         → no hay precio publicado
 *
 * Un monto en contexto de DESCUENTO sí es cobrable: es un precio final declarado
 * por el dueño ("te lo dejo en $8.000"), no una referencia abierta.
 *
 * LÍMITE CONOCIDO: un producto que valga menos de `PRECIO_MINIMO` no se puede
 * cobrar (queda `sin_precio`). Es deliberado — distinguir "$50" de "50 gramos"
 * sin contexto no se puede hacer bien, y equivocarse hacia el cobro es peor.
 */
export function leerPrecioCatalogo(precio: string | null | undefined): LecturaPrecio {
  const crudo = (precio ?? "").trim();

  // Un campo que es SOLO un número es un precio, aunque no traiga "$".
  // `extraerMontos` exige marca monetaria porque nació para texto conversacional,
  // donde un número suelto puede ser una cantidad, una talla o una hora. Acá el
  // campo ya declara su significado: es la columna precio del catálogo.
  //
  // Sin esta regla, un catálogo con "2.249" o "12990" —forma perfectamente común—
  // dejaba de venderse. Un test existente lo detectó, y bajar la exigencia de
  // `extraerMontos` para taparlo habría reabierto el bug original en el otro
  // extremo: ahí un número suelto SÍ es ambiguo.
  if (/^\d[\d.,]*$/.test(crudo)) {
    const valor = parseNumero(crudo);
    if (valor != null && valor >= PRECIO_MINIMO) return { cobrable: true, valor: Math.round(valor) };
    return { cobrable: false, motivo: "sin_precio" };
  }

  const montos = extraerMontos(crudo);
  if (montos.length === 0) return { cobrable: false, motivo: "sin_precio" };
  if (montos.some((m) => m.contexto === "rango")) return { cobrable: false, motivo: "rango" };

  const valores = [...new Set(montos.map((m) => m.valor))];
  if (valores.length > 1) return { cobrable: false, motivo: "ambiguo" };
  return { cobrable: true, valor: valores[0] };
}

/**
 * Versión corta para cuando solo importa el número (reportes, estimaciones).
 * `null` significa "no se pudo leer", NUNCA cero: un cero silencioso en un
 * reporte de ventas es una mentira que nadie nota.
 */
export function valorPrecioCatalogo(precio: string | null | undefined): number | null {
  const r = leerPrecioCatalogo(precio);
  return r.cobrable ? r.valor : null;
}

/** Plata chilena como se escribe en Chile: $12.990. Sin decimales, que no existen en CLP. */
export function formatearCLP(monto: number): string {
  return "$" + Math.round(monto).toLocaleString("es-CL");
}
