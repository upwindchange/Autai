import { cn } from "@/lib/utils";
import { TAG_PALETTE, getContrastTextColor } from "@/lib/tagColors";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CheckIcon } from "lucide-react";

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

/**
 * A compact color palette picker for tags.
 * Shows a swatch trigger that opens an 8×2 grid of curated colors.
 */
export function ColorPicker({ color, onChange, disabled }: ColorPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="size-6 shrink-0 rounded-md border-2 border-border transition-transform hover:scale-110 disabled:opacity-50"
          style={{ backgroundColor: color }}
          aria-label="Pick a color"
        />
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" align="start">
        <div className="grid grid-cols-8 gap-1.5">
          {TAG_PALETTE.map((hex) => (
            <button
              key={hex}
              type="button"
              className={cn(
                "size-6 rounded-md border-2 transition-transform hover:scale-110",
                color === hex
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-transparent",
              )}
              style={{ backgroundColor: hex }}
              onClick={() => onChange(hex)}
              aria-label={`Select color ${hex}`}
            >
              {color === hex && (
                <CheckIcon
                  className="size-4 mx-auto"
                  style={{ color: getContrastTextColor(hex) }}
                />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
