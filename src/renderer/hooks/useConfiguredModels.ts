import { useState, useEffect } from "react";
import { getApiBase } from "@/lib/api";

/**
 * One model entry per (configured provider, model) pair.
 * `providerId` is the userProviders.id needed to persist a per-thread override;
 * `logo` is the inline provider SVG for display.
 */
export type ConfiguredModelOption = {
  providerId: string;
  providerDir: string;
  providerName: string;
  logo?: string;
  modelId: string;
  modelName: string;
};

/**
 * Fetches the flat list of models across all CONFIGURED providers (those the
 * user has added in Settings). Single request via GET /providers/configured/models.
 */
export function useConfiguredModels() {
  const [models, setModels] = useState<ConfiguredModelOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getApiBase()}/providers/configured/models`)
      .then((r) => r.json())
      .then((d: { models?: ConfiguredModelOption[] }) => {
        if (!cancelled) setModels(d.models ?? []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading };
}
