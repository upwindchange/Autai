import type { LLMOutputComponent } from '@llm-ui/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

/**
 * Error block component for displaying error messages
 */
export const ErrorBlock: LLMOutputComponent = ({ blockMatch }) => {
  const errorMessage = blockMatch.output;

  return (
    <Alert variant="destructive" className="my-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{errorMessage}</AlertDescription>
    </Alert>
  );
};

/**
 * Error block configuration
 */
export const errorBlock = {
  findCompleteMatch: (input: string) => {
    // Match error patterns
    const errorPattern = /^Error: .+$/m;
    const match = input.match(errorPattern);
    return match ? { startIndex: match.index!, endIndex: match.index! + match[0].length } : null;
  },
  findPartialMatch: (input: string) => {
    // Match partial error patterns
    const partialErrorPattern = /^Error: .*/m;
    const match = input.match(partialErrorPattern);
    return match ? { startIndex: match.index!, endIndex: input.length } : null;
  },
  lookBack: () => 0,
  component: ErrorBlock,
};