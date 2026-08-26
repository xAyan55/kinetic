const https = require('https');
const http = require('http');
const { URL } = require('url');

const MCJARS_BASE_URL = process.env.MCJARS_BASE_URL || 'https://mcjars.app';

/**
 * In-memory cache with Time-To-Live (TTL)
 */
class MemoryCache {
  constructor() {
    this.cache = new Map();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  set(key, data, ttlSeconds = 300) {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttlSeconds * 1000)
    });
  }

  clear() {
    this.cache.clear();
  }
}

const clientCache = new MemoryCache();

/**
 * Fetch helper with timeout and exponential backoff retry
 */
function requestJson(urlStr, options = {}, retries = 2, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const transport = parsedUrl.protocol === 'http:' ? http : https;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'http:' ? 80 : 443),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'KineticHost-MCJars-Client/1.0',
        'Accept': 'application/json',
        ...(options.headers || {})
      },
      timeout: timeoutMs
    };

    const req = transport.request(reqOptions, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, urlStr).toString();
        return requestJson(redirectUrl, options, retries, timeoutMs).then(resolve).catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        let errBody = '';
        res.on('data', chunk => { errBody += chunk; });
        res.on('end', () => {
          const err = new Error(`MCJars API HTTP ${res.statusCode}: ${errBody.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          reject(err);
        });
        return;
      }

      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve(parsed);
        } catch (parseErr) {
          reject(new Error(`Failed to parse JSON from ${urlStr}: ${parseErr.message}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`MCJars API request timed out after ${timeoutMs}ms: ${urlStr}`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }

    req.end();
  }).catch((err) => {
    if (retries > 0 && err.statusCode !== 404 && err.statusCode !== 400) {
      const delay = Math.pow(2, 3 - retries) * 250;
      return new Promise((res) => setTimeout(res, delay))
        .then(() => requestJson(urlStr, options, retries - 1, timeoutMs));
    }
    throw err;
  });
}

/**
 * Intelligent Semantic Version Comparator
 * Sorts versions like '26.2', '1.21.1', '1.20.4', '1.16.5', '1.12.2', '1.8.8', 'latest'
 */
function compareMinecraftVersions(vA, vB) {
  if (vA === vB) return 0;
  if (vA === 'latest') return -1;
  if (vB === 'latest') return 1;
  if (vA === 'latest-snapshot') return -1;
  if (vB === 'latest-snapshot') return 1;

  // Split version components
  const cleanA = vA.replace(/^[vV]/, '');
  const cleanB = vB.replace(/^[vV]/, '');

  const partsA = cleanA.split(/[-._]/).map(p => isNaN(p) ? p : parseInt(p, 10));
  const partsB = cleanB.split(/[-._]/).map(p => isNaN(p) ? p : parseInt(p, 10));

  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const a = partsA[i];
    const b = partsB[i];

    if (a === undefined) return 1;
    if (b === undefined) return -1;

    if (typeof a === 'number' && typeof b === 'number') {
      if (a !== b) return b - a; // Descending
    } else {
      const strA = String(a);
      const strB = String(b);
      if (strA !== strB) return strB.localeCompare(strA);
    }
  }

  return cleanB.localeCompare(cleanA);
}

/**
 * Determines primary category from categories array or type identifier
 */
function categorizeServerType(typeId, typeInfo = {}) {
  const categories = (typeInfo.categories || []).map(c => c.toLowerCase());
  const upperType = (typeId || '').toUpperCase();

  if (upperType === 'VANILLA') {
    return 'Official / Vanilla';
  }
  if (categories.includes('proxy') || ['VELOCITY', 'WATERFALL', 'BUNGEECORD', 'VELOCITY_CTD'].includes(upperType)) {
    return 'Proxy';
  }
  if (categories.includes('limbo') || ['LOOHP_LIMBO', 'LOOHPLIMBO', 'NANOLIMBO'].includes(upperType)) {
    return 'Limbo / Special';
  }
  if (['FORGE', 'NEOFORGE', 'FABRIC', 'QUILT', 'LEGACY_FABRIC', 'LEGACYFABRIC'].includes(upperType) || categories.includes('modded') || categories.includes('mods')) {
    return 'Modded';
  }
  if (['MOHIST', 'ARCLIGHT', 'YOUER', 'MAGMA', 'SPONGE'].includes(upperType) || categories.includes('hybrid')) {
    return 'Hybrid';
  }
  return 'Performance';
}

/**
 * MCJars Client Implementation
 */
class MCJarsClient {
  constructor(baseUrl = MCJARS_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.cache = clientCache;
  }

  /**
   * Generic paginator: fetches all subsequent pages if total > per_page * page
   */
  async fetchPaginated(endpointPath, queryParams = {}, dataKey = 'data', ttlSeconds = 300) {
    const cacheKey = `paginated:${endpointPath}:${JSON.stringify(queryParams)}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const perPage = queryParams.per_page || 100;
    let page = 1;
    let allItems = [];
    let totalItems = 0;

    do {
      const url = new URL(`${this.baseUrl}${endpointPath}`);
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.set(k, v);
      }
      url.searchParams.set('page', page);
      url.searchParams.set('per_page', perPage);

      const res = await requestJson(url.toString());
      
      // Response wrapper handling: { builds: { total, data: [] } } or { versions: { total, data: [] } }
      const container = res.builds || res.versions || res;
      const pageData = Array.isArray(container) ? container : (container[dataKey] || container.data || []);
      totalItems = container.total !== undefined ? container.total : pageData.length;

      allItems = allItems.concat(pageData);

      if (allItems.length >= totalItems || pageData.length === 0 || page >= 20) {
        break; // Reached end or safety limit
      }
      page++;
    } while (true);

    // Deduplicate by id or uuid
    const seen = new Set();
    const deduplicated = allItems.filter(item => {
      const key = item.uuid || item.id || JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.cache.set(cacheKey, deduplicated, ttlSeconds);
    return deduplicated;
  }

  /**
   * 1. GET /api/v2/types — Software Types Catalog
   * Returns categorized, normalized software types with real icons, descriptions, and categories.
   */
  async getTypes() {
    const cacheKey = 'types:all';
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let rawTypes = {};

    try {
      // Try v2/types endpoint first
      const v2Res = await requestJson(`${this.baseUrl}/api/v2/types`);
      if (v2Res && v2Res.types) {
        // v2 groups: { recommended: {...}, established: {...}, experimental: {...}, miscellaneous: {...}, limbos: {...} }
        for (const [groupName, groupTypes] of Object.entries(v2Res.types)) {
          for (const [typeId, info] of Object.entries(groupTypes)) {
            rawTypes[typeId.toUpperCase()] = {
              ...info,
              group: groupName
            };
          }
        }
      }
    } catch (e) {
      console.warn('[MCJarsClient] v2/types failed, falling back to organization/v1/types:', e.message);
      try {
        const orgRes = await requestJson(`${this.baseUrl}/api/organization/v1/types`);
        if (orgRes && orgRes.types) {
          rawTypes = orgRes.types;
        }
      } catch (err2) {
        console.error('[MCJarsClient] All types endpoints failed:', err2.message);
      }
    }

    // Normalize all types
    const normalized = Object.entries(rawTypes).map(([rawId, info]) => {
      const id = rawId.toUpperCase();
      const name = info.name || id;
      const icon = info.icon || `https://s3.mcjars.app/icons/${id.toLowerCase()}.png`;
      const category = categorizeServerType(id, info);
      const isRecommended = info.group === 'recommended' || ['VANILLA', 'PAPER', 'FABRIC', 'VELOCITY'].includes(id);

      return {
        id,
        name,
        icon,
        color: info.color || '#FFFFFF',
        homepage: info.homepage || '',
        deprecated: !!info.deprecated,
        experimental: !!info.experimental,
        description: info.description || `${name} server software.`,
        category,
        categories: info.categories || [],
        compatibility: info.compatibility || [],
        buildsCount: info.builds || 0,
        versionsCount: info.versions?.minecraft || 0,
        recommended: isRecommended,
        badge: isRecommended ? 'RECOMMENDED' : (info.experimental ? 'EXPERIMENTAL' : (info.deprecated ? 'DEPRECATED' : 'STABLE'))
      };
    });

    // Sort: Recommended first, then by category, then alphabetically
    normalized.sort((a, b) => {
      if (a.recommended && !b.recommended) return -1;
      if (!a.recommended && b.recommended) return 1;
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return a.name.localeCompare(b.name);
    });

    this.cache.set(cacheKey, normalized, 300); // 5 min TTL
    return normalized;
  }

  /**
   * 2. GET /api/v3/builds/types/{type}/versions — Discover all versions for software type
   */
  async getVersions(typeId) {
    if (!typeId) throw new Error('typeId is required');
    const upperType = typeId.toUpperCase();
    const cacheKey = `versions:${upperType}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const rawVersions = await this.fetchPaginated(`/api/v3/builds/types/${upperType}/versions`, {}, 'data', 300);

    const normalized = rawVersions.map(v => {
      return {
        id: v.id,
        version: v.id,
        type: v.type || 'RELEASE',
        supported: v.supported !== false,
        java: v.java || (compareMinecraftVersions(v.id, '1.20.5') <= 0 ? 21 : (compareMinecraftVersions(v.id, '1.18') <= 0 ? 17 : 8)),
        buildsCount: v.builds || 0,
        created: v.created || null,
        latest: v.latest || null
      };
    });

    // Sort versions with semantic version comparator
    normalized.sort((a, b) => compareMinecraftVersions(a.id, b.id));

    this.cache.set(cacheKey, normalized, 300);
    return normalized;
  }

  /**
   * 3. GET /api/v3/builds/types/{type}/versions/{version} — Discover all builds
   */
  async getBuilds(typeId, version) {
    if (!typeId || !version) throw new Error('typeId and version are required');
    const upperType = typeId.toUpperCase();
    const cacheKey = `builds:${upperType}:${version}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const rawBuilds = await this.fetchPaginated(`/api/v3/builds/types/${upperType}/versions/${encodeURIComponent(version)}`, {}, 'data', 60);

    const normalized = rawBuilds.map(b => {
      // Find jar or zip download step
      let downloadStep = null;
      let jarSize = null;
      let jarUrl = null;

      if (Array.isArray(b.installation)) {
        for (const stepGroup of b.installation) {
          if (Array.isArray(stepGroup)) {
            for (const step of stepGroup) {
              if (step.type === 'download' && step.url) {
                downloadStep = step;
                jarUrl = step.url;
                jarSize = step.size;
                break;
              }
            }
          }
        }
      }

      return {
        uuid: b.uuid,
        name: b.name || `#${b.buildNumber || '1'}`,
        versionId: b.version_id || version,
        type: b.type || upperType,
        experimental: !!b.experimental,
        created: b.created || null,
        changes: b.changes || [],
        installation: b.installation || [],
        jarUrl,
        jarSize
      };
    });

    this.cache.set(cacheKey, normalized, 60); // 1 min TTL
    return normalized;
  }

  /**
   * 4. GET /api/v3/builds/types/{type}/versions/{version}/latest — Resolve latest build
   */
  async getLatestBuild(typeId, version) {
    if (!typeId || !version) throw new Error('typeId and version are required');
    const upperType = typeId.toUpperCase();
    const cacheKey = `latest:${upperType}:${version}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const res = await requestJson(`${this.baseUrl}/api/v3/builds/types/${upperType}/versions/${encodeURIComponent(version)}/latest`);
    const b = res.build || res;

    let downloadStep = null;
    let jarSize = null;
    let jarUrl = null;

    if (Array.isArray(b.installation)) {
      for (const stepGroup of b.installation) {
        if (Array.isArray(stepGroup)) {
          for (const step of stepGroup) {
            if (step.type === 'download' && step.url) {
              downloadStep = step;
              jarUrl = step.url;
              jarSize = step.size;
              break;
            }
          }
        }
      }
    }

    const normalized = {
      uuid: b.uuid,
      name: b.name || '#latest',
      versionId: b.version_id || version,
      type: b.type || upperType,
      experimental: !!b.experimental,
      created: b.created || null,
      changes: b.changes || [],
      installation: b.installation || [],
      jarUrl,
      jarSize
    };

    this.cache.set(cacheKey, normalized, 60);
    return normalized;
  }

  /**
   * 5. GET /api/v3/builds/{uuid} — Full build details & installation instructions
   */
  async getBuildDetails(buildUuid) {
    if (!buildUuid) throw new Error('buildUuid is required');
    const cacheKey = `buildDetails:${buildUuid}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let res;
    try {
      res = await requestJson(`${this.baseUrl}/api/v3/builds/${encodeURIComponent(buildUuid)}`);
    } catch (e) {
      // Fallback to /api/v1/build/{uuid}
      res = await requestJson(`${this.baseUrl}/api/v1/build/${encodeURIComponent(buildUuid)}`);
    }

    const b = res.build || res;
    const v = res.version || {};

    let jarUrl = b.jarUrl || null;
    let jarSize = b.jarSize || null;
    let zipUrl = b.zipUrl || null;
    let zipSize = b.zipSize || null;

    if (Array.isArray(b.installation)) {
      for (const stepGroup of b.installation) {
        if (Array.isArray(stepGroup)) {
          for (const step of stepGroup) {
            if (step.type === 'download' && step.url) {
              if (step.file && step.file.endsWith('.zip')) {
                zipUrl = step.url;
                zipSize = step.size;
              } else {
                jarUrl = step.url;
                jarSize = step.size;
              }
            }
          }
        }
      }
    }

    const normalized = {
      uuid: b.uuid,
      id: b.id,
      name: b.name || '#1',
      versionId: b.version_id || b.versionId,
      type: b.type,
      experimental: !!b.experimental,
      created: b.created,
      changes: b.changes || [],
      installation: b.installation || [],
      jarUrl,
      jarSize,
      zipUrl,
      zipSize,
      javaRequirement: v.java || null
    };

    this.cache.set(cacheKey, normalized, 300);
    return normalized;
  }
}

const defaultClient = new MCJarsClient();

module.exports = {
  MCJarsClient,
  mcjars: defaultClient,
  compareMinecraftVersions,
  categorizeServerType
};
