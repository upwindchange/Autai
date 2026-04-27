import { useState, useEffect } from "react";
import type { ModelDefinition } from "@shared";
import { getApiBase } from "@/lib/api";

export function useProviderModels(providerDir: string | null) {
  const [models, setModels] = useState<ModelDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!providerDir) {
      setModels([]);
      return;
    }
    fetchModels(providerDir);
  }, [providerDir]);

  const fetchModels = async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/providers/${dir}/models`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ModelDefinition[];
      setModels(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  };

  return { models, loading, error };
}
