/**
 * api-cache.js — Caché de TaoStats en localStorage del navegador.
 *
 * Expone window.fetchTao(endpoint, options) como reemplazo de fetch()
 * para llamadas al Worker tao360. Los datos se guardan en localStorage
 * con el mismo TTL que usa el Worker, de modo que navegar entre páginas
 * (market → subnet → tao) no genera llamadas extra al Worker.
 *
 * USO:
 *   <script src="/js/api-cache.js"></script>
 *
 *   // En vez de:
 *   const res = await fetch(WORKER + '/api/price/latest/v1?asset=tao');
 *   const data = await res.json();
 *
 *   // Usa:
 *   const data = await fetchTao('/api/price/latest/v1?asset=tao');
 *
 * Si localStorage no está disponible (modo privado estricto, cuota llena),
 * fetchTao cae silenciosamente al fetch normal — nunca bloquea la UI.
 */

(function () {
  const WORKER = 'https://tao360.qrchd889gj.workers.dev';
  const PREFIX = 'tao360:';

  // TTLs en ms — sincronizados con los del Worker (worker-tao360.js v3)
  const TTL_MAP = [
    ['/api/price/',  90_000 ],
    ['/api/dtao/',  120_000 ],
    ['/api/subnet/', 300_000],
    ['/api/stats/',  300_000],
  ];

  function getTTL(endpoint) {
    for (const [prefix, ttl] of TTL_MAP) {
      if (endpoint.startsWith(prefix)) return ttl;
    }
    return 90_000;
  }

  // Lee del localStorage; devuelve el objeto si no ha expirado, o null.
  function lsRead(key, ttl) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const { data, time } = JSON.parse(raw);
      if (Date.now() - time < ttl) return data;
      localStorage.removeItem(PREFIX + key);   // expirado: limpiar
      return null;
    } catch {
      return null;
    }
  }

  // Escribe en localStorage; ignora errores de cuota.
  function lsWrite(key, data) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ data, time: Date.now() }));
    } catch {
      // Cuota llena: purgar entradas propias y reintentar una vez
      purgeTaoCache();
      try {
        localStorage.setItem(PREFIX + key, JSON.stringify({ data, time: Date.now() }));
      } catch { /* ignorar */ }
    }
  }

  // Elimina todas las entradas con prefijo tao360: del localStorage.
  function purgeTaoCache() {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
  }

  /**
   * fetchTao(endpoint, options?) → Promise<object>
   *
   * @param {string} endpoint  Ruta del Worker, ej: '/api/price/latest/v1?asset=tao'
   * @param {object} [options] Opciones de fetch (signal, etc.)
   * @returns {Promise<object>} JSON ya parseado
   */
  async function fetchTao(endpoint, options = {}) {
    const ttl = getTTL(endpoint);

    // 1. localStorage (sin red)
    const cached = lsRead(endpoint, ttl);
    if (cached !== null) return cached;

    // 2. Red → Worker → Taostats
    const signal = options.signal ?? AbortSignal.timeout(10_000);
    const res = await fetch(WORKER + endpoint, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} para ${endpoint}`);
    const data = await res.json();

    // 3. Guardar para próximas visitas
    lsWrite(endpoint, data);
    return data;
  }

  // Exponer globalmente
  window.fetchTao     = fetchTao;
  window.purgeTaoCache = purgeTaoCache;
})();
