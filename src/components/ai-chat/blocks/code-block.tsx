import parse from 'html-react-parser';
import type { LLMOutputComponent } from '@llm-ui/react';
import { findCompleteCodeBlock, findPartialCodeBlock, codeBlockLookBack } from '@llm-ui/code';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Check, Copy } from 'lucide-react';
import { loadHighlighter, getTheme } from '../utils/highlighter';
import { useState, useEffect } from 'react';

/**
 * Parse code block to extract language and code
 */
function parseCodeBlock(output: string): { language: string; code: string } {
  const lines = output.split('\n');
  const firstLine = lines[0];
  const match = firstLine.match(/^```(\w+)?/);
  
  const language = match?.[1] || 'text';
  const codeLines = lines.slice(1, -1); // Remove first and last line (```)
  const code = codeLines.join('\n');
  
  return { language, code };
}

/**
 * Code block component with syntax highlighting
 */
export const CodeBlock: LLMOutputComponent = ({ blockMatch }) => {
  const [copied, setCopied] = useState(false);
  const [highlighter, setHighlighter] = useState<any>(null);
  const { language, code } = parseCodeBlock(blockMatch.output);
  
  // Load highlighter asynchronously
  useEffect(() => {
    loadHighlighter().then(setHighlighter);
  }, []);
  
  // Don't render incomplete blocks
  if (!blockMatch.isVisible) {
    return null;
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Render plain text while highlighter is loading
  if (!highlighter) {
    return (
      <Card className="relative group my-4 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
          <span className="text-xs font-mono text-muted-foreground">
            {language}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3 mr-1" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </>
            )}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <pre className="p-4 text-sm">
            <code>{code}</code>
          </pre>
        </div>
      </Card>
    );
  }

  let html: string;
  try {
    html = highlighter.codeToHtml(code, {
      lang: language,
      theme: getTheme(),
    });
  } catch (error) {
    // Fallback for unsupported languages
    html = highlighter.codeToHtml(code, {
      lang: 'text',
      theme: getTheme(),
    });
  }

  return (
    <Card className="relative group my-4 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/50">
        <span className="text-xs font-mono text-muted-foreground">
          {language}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 mr-1" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3 mr-1" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <div className="text-sm [&>pre]:!bg-transparent [&>pre]:!p-4">
          {parse(html)}
        </div>
      </div>
    </Card>
  );
};

/**
 * Code block configuration for llm-ui
 */
export const codeBlock = {
  findCompleteMatch: findCompleteCodeBlock(),
  findPartialMatch: findPartialCodeBlock(),
  lookBack: codeBlockLookBack(),
  component: CodeBlock,
};