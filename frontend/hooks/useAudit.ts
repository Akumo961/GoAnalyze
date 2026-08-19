"use client";

import { useCallback, useState } from "react";
import { ApiError, auditApi } from "@/lib/api";
import type { AuditEventListResponse } from "@/lib/types";
import type { AsyncStatus } from "./useSearch";

export function useAudit() {
  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [data, setData] = useState<AuditEventListResponse | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async (page = 1, pageSize = 20) => {
    setStatus("loading");
    setError(null);
    try {
      const result = await auditApi.list(page, pageSize);
      setData(result);
      setStatus("success");
    } catch (err) {
      setError(err as Error);
      setStatus("error");
    }
  }, []);

  return { status, data, error, load };
}
