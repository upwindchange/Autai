import { type FC, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Blocks, Globe, Plus, Search } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { useUiStore } from "@/stores/uiStore";
import { cn } from "@/lib/utils";

interface ComposerToolsMobileProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  mcpServers: { id: string; name: string }[];
  isNative: boolean;
}

/**
 * Mobile counterpart of the composer's unified tools menu. The desktop menu is a
 * nested DropdownMenu (Browser Use / Extensions / Web Search submenus); on touch
 * those submenus are awkward, so this flattens the same controls into sections
 * inside a bottom-sheet Drawer: explicit on/off Switches + RadioGroups. State
 * and toggles come straight from the uiStore (the modes are mutually exclusive
 * there), so this stays in sync with the desktop menu for free.
 */
export const ComposerToolsMobile: FC<ComposerToolsMobileProps> = ({
  open,
  onOpenChange,
  trigger,
  mcpServers,
  isNative,
}) => {
  const { t } = useTranslation("common");
  const {
    useBrowser,
    usePlannedBrowser,
    webSearch,
    quickSearch,
    deepResearch,
    setUseBrowser,
    setUsePlannedBrowser,
    setWebSearch,
    setQuickSearch,
    setDeepResearch,
    enabledMcpServerIds,
    toggleMcpServer,
    setShowSettings,
    setActiveSettingsSection,
  } = useUiStore();

  const hasActiveMcpServers = enabledMcpServerIds.length > 0;

  // effort: 0 = quick, 1 = standard, 2 = thorough (mirrors the desktop menu).
  const effort =
    quickSearch ? 0
    : deepResearch ? 2
    : 1;
  const handleEffortChange = (value: string) => {
    if (value === "0") {
      setQuickSearch(true);
    } else if (value === "2") {
      setDeepResearch(true);
    } else {
      setDeepResearch(false);
      setQuickSearch(false);
    }
  };

  const handleAddExtensions = () => {
    setActiveSettingsSection("mcpServers");
    setShowSettings(true);
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle>{t("composer.tools.title")}</DrawerTitle>
        </DrawerHeader>
        <div className="relative space-y-4 overflow-y-auto px-4 pb-6">
          {isNative && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <FieldLabel className="flex items-center gap-1.5">
                  <Globe className="size-4" />
                  {t("composer.tools.browserUse")}
                </FieldLabel>
                <Switch
                  size="sm"
                  checked={useBrowser}
                  onCheckedChange={(v) => setUseBrowser(v)}
                  aria-label={t("composer.tools.browserUse")}
                />
              </div>
              {useBrowser && (
                <RadioGroup
                  value={usePlannedBrowser ? "planned" : "simple"}
                  onValueChange={(v) => setUsePlannedBrowser(v === "planned")}
                  className="gap-1"
                >
                  <Field orientation="horizontal">
                    <RadioGroupItem value="simple" id="m-browser-simple" />
                    <FieldContent>
                      <FieldLabel htmlFor="m-browser-simple">
                        {t("composer.browser.mode.simple")}
                      </FieldLabel>
                      <FieldDescription>
                        {t("composer.browser.mode.simple.description")}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem value="planned" id="m-browser-planned" />
                    <FieldContent>
                      <FieldLabel htmlFor="m-browser-planned">
                        {t("composer.browser.mode.planned")}
                      </FieldLabel>
                      <FieldDescription>
                        {t("composer.browser.mode.planned.description")}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </RadioGroup>
              )}
            </section>
          )}

          {isNative && <Separator />}

          <section className="space-y-2">
            <FieldLabel className="flex items-center gap-1.5">
              <Blocks
                className={cn(
                  "size-4",
                  hasActiveMcpServers ? "text-orange-500" : (
                    "text-muted-foreground"
                  ),
                )}
              />
              <span
                className={cn(
                  hasActiveMcpServers ? "text-orange-500" : (
                    "text-muted-foreground"
                  ),
                )}
              >
                {t("composer.tools.extensions")}
              </span>
            </FieldLabel>
            {mcpServers.map((server) => (
              <div
                key={server.id}
                className="flex items-center justify-between py-0.5"
              >
                <span className="text-sm">{server.name}</span>
                <Switch
                  size="sm"
                  checked={enabledMcpServerIds.includes(server.id)}
                  onCheckedChange={() => toggleMcpServer(server.id)}
                  aria-label={server.name}
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 w-full"
              onClick={handleAddExtensions}
            >
              <Plus className="size-4" />
              {t("composer.tools.addExtensions")}
            </Button>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <FieldLabel className="flex items-center gap-1.5">
                <Search className="size-4" />
                {t("composer.tools.webSearch")}
              </FieldLabel>
              <Switch
                size="sm"
                checked={webSearch}
                onCheckedChange={(v) => setWebSearch(v)}
                aria-label={t("composer.tools.webSearch")}
              />
            </div>
            {webSearch && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    {t("composer.effort.label")}
                  </span>
                  <HelpTooltip
                    content={t("composer.effort.description")}
                    side="top"
                    maxWidth={224}
                    iconClassName="size-3.5 text-muted-foreground"
                  />
                </div>
                <RadioGroup
                  value={String(effort)}
                  onValueChange={handleEffortChange}
                  className="gap-1.5"
                >
                  <Field orientation="horizontal">
                    <RadioGroupItem value="0" id="m-effort-quick" />
                    <FieldContent>
                      <FieldLabel htmlFor="m-effort-quick">
                        {t("composer.effort.quick")}
                      </FieldLabel>
                    </FieldContent>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem value="1" id="m-effort-standard" />
                    <FieldContent>
                      <FieldLabel htmlFor="m-effort-standard">
                        {t("composer.effort.standard")}
                      </FieldLabel>
                    </FieldContent>
                  </Field>
                  <Field orientation="horizontal">
                    <RadioGroupItem value="2" id="m-effort-thorough" />
                    <FieldContent>
                      <FieldLabel htmlFor="m-effort-thorough">
                        {t("composer.effort.thorough")}
                      </FieldLabel>
                    </FieldContent>
                  </Field>
                </RadioGroup>
              </div>
            )}
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
