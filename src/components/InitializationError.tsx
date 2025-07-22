import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function InitializationError() {
  const isInitializing = useAppStore((state) => state.isInitializing);
  const initializationError = useAppStore((state) => state.initializationError);
  const retryInitialization = useAppStore((state) => state.retryInitialization);

  if (!initializationError && !isInitializing) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Alert className="max-w-md">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>
          {isInitializing ? "Loading Application State" : "Initialization Failed"}
        </AlertTitle>
        <AlertDescription className="mt-2">
          {initializationError || "Loading application state, please wait..."}
        </AlertDescription>
        {!isInitializing && initializationError && (
          <Button
            onClick={retryInitialization}
            className="mt-4"
            size="sm"
            variant="outline"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        )}
      </Alert>
    </div>
  );
}