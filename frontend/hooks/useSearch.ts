"use client";

import { useCallback, useState } from "react";
import { ApiError, documentsApi } from "@/lib/api";
import type { SearchParams, SearchResponse } from "@/lib/types";
import { cacheSearchHits } from "@/lib/documentCache";

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export function useSearch() {
  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const search = useCallback(async (params: SearchParams) => {
    setStatus("loading");
    setError(null);
    try {
      const result = await documentsApi.search(params);
      cacheSearchHits(result.results);
      setData(result);
      setStatus("success");
    } catch (err) {
      setError(err as Error);
      setStatus("error");
    }
  }, []);

  return { status, data, error, search };
}
