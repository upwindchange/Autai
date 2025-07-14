import type { LLMOutputComponent, LookBackFunctionParams } from '@llm-ui/react';
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
    return match ? { 
      startIndex: match.index!, 
      endIndex: match.index! + match[0].length,
      outputRaw: input.slice(match.index!, match.index! + match[0].length)
    } : undefined;
  },
  findPartialMatch: (input: string) => {
    // Match partial error patterns
    const partialErrorPattern = /^Error: .*/m;
    const match = input.match(partialErrorPattern);
    return match ? { 
      startIndex: match.index!, 
      endIndex: input.length,
      outputRaw: input.slice(match.index!, input.length)
    } : undefined;
  },
  lookBack: ({ output, visibleTextLengthTarget }: LookBackFunctionParams) => ({
    output: output.slice(0, visibleTextLengthTarget),
    visibleText: output.slice(0, visibleTextLengthTarget)
  }),
  component: ErrorBlock,
};