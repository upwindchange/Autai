import { useState, FormEvent, KeyboardEvent } from 'react';
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizontal, Loader2 } from "lucide-react";
import type { InputBoxProps } from "./types";

/**
 * Chat input component with textarea and send button
 */
export function InputBox({ onSend, disabled, placeholder = "Type a message..." }: InputBoxProps) {
  const [value, setValue] = useState('');

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    
    if (value.trim() && !disabled) {
      onSend(value);
      setValue('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Enter, new line on Shift+Enter
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-[80px] max-h-[200px] resize-none"
        rows={3}
      />
      <Button 
        type="submit" 
        disabled={disabled || !value.trim()}
        size="icon"
        className="shrink-0"
      >
        {disabled ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <SendHorizontal className="h-4 w-4" />
        )}
      </Button>
    </form>
  );
}