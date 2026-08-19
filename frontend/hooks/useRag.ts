"use client";

import { useCallback, useState } from "react";
import { ApiError, ragApi } from "@/lib/api";
import type { EvidenceCitation, RagAnswerResponse } from "@/lib/types";
import type { AsyncStatus } from "./useSearch";

export interface ResearchTurn {
  question: string;
  response?: RagAnswerResponse;
  error?: string;
  timestamp: string;
}

export function useRag() {
  const [status, setStatus] = useState<AsyncStatus>("idle");
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [history, setHistory] = useState<ResearchTurn[]>([]);

  const ask = useCallback(async (question: string, citations: EvidenceCitation[]) => {
    setStatus("loading");
    setError(null);
    const timestamp = new Date().toISOString();
    try {
      const response = await ragApi.answer(question, citations);
      setHistory((prev) => [{ question, response, timestamp }, ...prev]);
      setStatus("success");
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : "The AI research request failed.";
      setHistory((prev) => [{ question, error: message, timestamp }, ...prev]);
      setError(err as Error);
      setStatus("error");
      throw err;
    }
  }, []);

  return { status, error, history, ask };
}
