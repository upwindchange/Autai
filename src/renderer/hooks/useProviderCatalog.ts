import { useState, useEffect } from "react";
import type { ProviderDefinition } from "@shared";

const API_BASE = "http://localhost:3001";

export function useProviderCatalog() {
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalog();
  }, []);

  const fetchCatalog = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/providers`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ProviderDefinition[];
      setProviders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  };

  return { providers, loading, error, refetch: fetchCatalog };
}
