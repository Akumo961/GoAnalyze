/**
 * BACKEND GAP: there is no `GET /v1/documents/{document_id}` endpoint, so a
 * document detail page can't fetch a document's own metadata by id (see
 * FRONTEND_BACKEND_GAPS.md). As a real, honest workaround -- not a fake
 * data source -- we cache the `DocumentRecord`/`SearchHit` data we *do*
 * legitimately receive from `POST /v1/documents` (on ingest) and
 * `GET /v1/documents/search` (on every search/list), keyed by document id,
 * in sessionStorage. If a document was never seen this session (e.g. a
 * deep link opened directly), the detail page says so plainly instead of
 * guessing.
 */

import type { DocumentRecord, SearchHit } from "./types";

const CACHE_KEY = "goanalyze_document_cache_v1";

export type CachedDocument = Partial<DocumentRecord> & Partial<SearchHit> & { document_id: string };

function readCache(): Record<string, CachedDocument> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(CACHE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, CachedDocument>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full or unavailable -- non-fatal */
  }
}

export function cacheDocumentRecord(record: DocumentRecord) {
  const cache = readCache();
  cache[record.id] = { ...cache[record.id], ...record, document_id: record.id };
  writeCache(cache);
}

export function cacheSearchHits(hits: SearchHit[]) {
  const cache = readCache();
  for (const hit of hits) {
    cache[hit.document_id] = { ...cache[hit.document_id], ...hit };
  }
  writeCache(cache);
}

export function getCachedDocument(documentId: string): CachedDocument | null {
  return readCache()[documentId] ?? null;
}
