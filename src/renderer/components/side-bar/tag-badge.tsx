import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge"; // shadcn, rounded-full — NOT @/components/assistant-ui/badge
import { cn } from "@/lib/utils";
import { getContrastTextColor } from "@/lib/tagColors";

/**
 * The single visual primitive for a colored tag pill. Renders the tag's stored
 * hex color (with computed WCAG-contrast text) through shadcn `Badge`. When the
 * color is null/empty (legacy DB rows), falls back to a muted badge.
 *
 * `variant` is intentionally omitted: Badge's default variant is always
 * overridden — by muted classes when colorless, by inline `style` (which beats
 * Tailwind bg/text classes in the cascade) when colored.
 */
export function TagBadge({
  color,
  className,
  children,
  ...props
}: { color: string | null | undefined } & Omit<
  ComponentProps<typeof Badge>,
  "variant" | "color"
>) {
  if (!color) {
    return (
      <Badge className={cn("bg-muted text-muted-foreground", className)} {...props}>
        {children}
      </Badge>
    );
  }
  return (
    <Badge
      style={{ backgroundColor: color, color: getContrastTextColor(color) }}
      className={className}
      {...props}
    >
      {children}
    </Badge>
  );
}
