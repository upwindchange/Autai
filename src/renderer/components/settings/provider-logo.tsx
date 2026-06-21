import { cn } from "@/lib/utils";

/**
 * Renders a provider's inline SVG logo (read from resources/providers/<dir>/logo.svg).
 *
 * The logo markup uses fill="currentColor", so its color follows the inherited
 * text color. Sizing is delegated to the parent via `[&_svg]:*` rules — matching
 * the Settings provider cards (h-8 w-8 [&_svg]:h-full) and the ModelSelector icon
 * slots (size-4 [&_svg]:size-4). Pass a className only to override the color.
 */
export function ProviderLogo({
  logo,
  className,
}: {
  logo?: string;
  className?: string;
}) {
  if (!logo) return null;
  return (
    <span
      className={cn("text-foreground", className)}
      dangerouslySetInnerHTML={{ __html: logo }}
    />
  );
}
