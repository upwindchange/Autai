import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Search, ExternalLink, Plus, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProviderCatalog } from "@/hooks/useProviderCatalog";
import type { ProviderDefinition } from "@shared";

interface ProviderCatalogProps {
  onSelect: (provider: ProviderDefinition) => void;
  onBack: () => void;
}

export function ProviderCatalog({ onSelect, onBack }: ProviderCatalogProps) {
  const { providers, loading } = useProviderCatalog();
  const [search, setSearch] = useState("");
  const { t } = useTranslation("providers");

  const filtered = useMemo(() => {
    if (!search) return providers;
    const q = search.toLowerCase();
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.dir.toLowerCase().includes(q) ||
        (p.api && p.api.toLowerCase().includes(q)),
    );
  }, [providers, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-2xl font-bold">{t("catalog.title")}</h2>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("catalog.search")}
          className="pl-9"
        />
      </div>

      {loading ?
        <div className="py-8 text-center text-sm text-muted-foreground">
          {t("catalog.loading")}
        </div>
      : <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {filtered.map((provider) => (
            <ProviderCatalogCard
              key={provider.dir}
              provider={provider}
              onSelect={onSelect}
            />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-8 text-center text-sm text-muted-foreground">
              {t("catalog.empty")}
            </div>
          )}
        </div>
      }
    </div>
  );
}

function ProviderCatalogCard({
  provider,
  onSelect,
}: {
  provider: ProviderDefinition;
  onSelect: (p: ProviderDefinition) => void;
}) {
  const { t } = useTranslation("providers");
  return (
    <Card className="group flex items-start gap-3 p-4 transition-colors overflow-hidden">
      {provider.logo ?
        <span
          className="h-10 w-10 shrink-0 text-foreground [&_svg]:h-full [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: provider.logo }}
        />
      : <div className="h-10 w-10 shrink-0 rounded-lg bg-muted flex items-center justify-center text-sm font-medium">
          {provider.name.charAt(0)}
        </div>
      }
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{provider.name}</div>
        {provider.doc && (
          <button
            type="button"
            className="flex items-center gap-1 mt-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => window.open(provider.doc, "_blank")}
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            <span className="text-xs truncate">{t("catalog.doc")}</span>
          </button>
        )}
        <div className="flex items-center gap-1 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSelect(provider)}
          >
            <Plus className="h-3 w-3 mr-1" />
            {t("catalog.add")}
          </Button>
        </div>
      </div>
    </Card>
  );
}
