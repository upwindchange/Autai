import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { AppMessage } from "@shared/index";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createLogger } from "@/lib/logger";

import "./index.css";

import "./demos/ipc";

const logger = createLogger('Main');

// Main process message handler
const handleAppMessage = (event: unknown, message: AppMessage) => {
  logger.debug("app message received", { type: message.type, title: message.title });
  switch (message.type) {
    case "alert":
      // Persistent alert with dismiss button
      toast.custom(
        (t) => (
          <div className="w-full">
            <Alert variant="destructive" className="relative">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{message.title}</AlertTitle>
              <AlertDescription>{message.description}</AlertDescription>
              <button
                onClick={() => toast.dismiss(t)}
                className="absolute right-3 top-3 text-destructive-foreground/70 hover:text-destructive-foreground"
              >
                ×
              </button>
            </Alert>
          </div>
        ),
        {
          duration: Infinity, // Never auto-dismiss
        }
      );
      break;
    case "info":
      toast.custom(() => (
        <div className="w-full">
          <Alert className="relative">
            <Info className="h-4 w-4" />
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        </div>
      ));
      break;
    case "success":
      toast.custom(() => (
        <div className="w-full">
          <Alert className="relative">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>{message.title}</AlertTitle>
            <AlertDescription>{message.description}</AlertDescription>
          </Alert>
        </div>
      ));
      break;
  }
};

// Register the message listener once at application startup
window.ipcRenderer.on("app:message", handleAppMessage);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <Toaster />
  </React.StrictMode>
);

postMessage({ payload: "removeLoading" }, "*");
