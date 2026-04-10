/**
 * CDP storage types cleared before each scrape to prevent Google Maps' SPA
 * shell from replaying a previously-loaded place via service worker + IndexedDB
 * cache. `cookies` is intentionally excluded so Google authentication is
 * preserved. If Google ever migrates Maps auth away from cookies to a
 * storage-backed OAuth flow, this list must be re-evaluated.
 *
 * Valid CDP `Storage.StorageType` values include: appcache, cookies,
 * file_systems, indexeddb, local_storage, shader_cache, websql,
 * service_workers, cache_storage, all.
 */
export const VOLATILE_STORAGE_TYPES =
  "service_workers,cache_storage,local_storage,indexeddb";
