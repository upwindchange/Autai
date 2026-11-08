# Local patches

Fixes applied on top of upstream code that get lost when upstream is
re-synced/overwritten. Re-apply after each overwrite.

## 1. ScrollArea: content overflows its box without a scrollbar

**Symptom**: a list inside `ScrollArea` grows past its `max-h-*` box with
no scrollbar — e.g. the available-models list in Settings → Providers &
Models (`settings-sections/toml-model-list.tsx`, rendered by
`model-role-selector.tsx`): the list paints over the bordered box.

**Cause**: the shadcn wrapper sizes the Radix viewport with `size-full`
(`height: 100%`) of the ScrollArea root. When the root's height is
content-derived and only capped by `max-h-*` (e.g. the root is a
`flex-1 min-h-0` item of a `flex max-h-64 flex-col` wrapper), that
height is indefinite for percentage resolution: the viewport's
`height: 100%` computes to `auto`, the viewport grows to full content
height, and — since the Radix root (`@radix-ui/react-scroll-area` 1.4.x)
applies no overflow clip — the content spills out with no scrollbar.

**Patch** — `src/renderer/components/ui/scroll-area.tsx`, 2 lines. Make
the viewport a flex item of the root so its height comes from flex
layout (used heights, no percentage resolution) and the scrolling
element itself is height-constrained:

```diff
-      className={cn("relative", className)}
+      className={cn("relative flex flex-col", className)}
```

```diff
-        className="size-full rounded-[inherit] ..."
+        className="size-full min-h-0 flex-1 rounded-[inherit] ..."
```

Keep the rest of the viewport class string as-is (whatever the current
file has, e.g. `[&>div]:block!`). `size-full` is kept as a fallback for
non-flex roots; in a flex root, `flex-1 min-h-0` governs the main axis.

**Same patch fixes these latent sites** (identical
`flex max-h-X flex-col` wrapper + `ScrollArea min-h-0 flex-1` pattern):
`tool-ui/citation/citation-list.tsx`, `side-bar/thread-list-shared.tsx`,
`side-bar/sidebar-toolbar.tsx`.

**Check**: `pnpm tsc`; then Settings → Providers & Models → pick a
provider with many models — the list must scroll inside its bordered
box instead of spilling past it.
