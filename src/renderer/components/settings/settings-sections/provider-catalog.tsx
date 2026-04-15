import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useProviderCatalog } from "@/hooks/useProviderCatalog";
import type { ProviderDefinition } from "@shared";

const API_BASE = "http://localhost:3001";

interface ProviderCatalogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (provider: ProviderDefinition) => void;
}

export function ProviderCatalog({
  open,
  onOpenChange,
  onSelect,
}: ProviderCatalogProps) {
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
        p.npm.toLowerCase().includes(q),
    );
  }, [providers, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>{t("catalog.title")}</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("catalog.search")}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("catalog.loading")}
          </div>
        ) : (
          <ScrollArea className="max-h-[60vh]">
            <div className="grid grid-cols-1 gap-2 pr-3">
              {filtered.map((provider) => (
                <ProviderCatalogItem
                  key={provider.dir}
                  provider={provider}
                  onSelect={onSelect}
                />
              ))}
              {filtered.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {t("catalog.empty")}
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProviderCatalogItem({
  provider,
  onSelect,
}: {
  provider: ProviderDefinition;
  onSelect: (p: ProviderDefinition) => void;
}) {
  const { t } = useTranslation("providers");
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent/50 transition-colors">
      <img
        src={`${API_BASE}/providers/${provider.dir}/logo`}
        alt={provider.name}
        className="h-8 w-8 shrink-0"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{provider.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {provider.npm}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {provider.doc && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              window.open(provider.doc, "_blank");
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelect(provider)}
        >
          {t("catalog.add")}
        </Button>
      </div>
    </div>
  );
}
