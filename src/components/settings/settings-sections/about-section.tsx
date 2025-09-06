import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Github, FileText, Heart } from "lucide-react";

export function AboutSection() {
  const [appVersion, setAppVersion] = useState<string>("Loading...");
  const [platform, setPlatform] = useState<string>("Loading...");
  const [electronVersion, setElectronVersion] = useState<string>("Loading...");
  const [nodeVersion, setNodeVersion] = useState<string>("Loading...");

  useEffect(() => {
    // Get app version from main process
    window.ipcRenderer.invoke("app:getVersion").then((version: unknown) => {
      setAppVersion(String(version));
    }).catch(() => {
      setAppVersion("Unknown");
    });

    // Get system info from main process
    window.ipcRenderer.invoke("app:getSystemInfo").then((info: unknown) => {
      if (info && typeof info === 'object') {
        const systemInfo = info as {
          platform: string;
          electronVersion: string;
          nodeVersion: string;
          chromeVersion?: string;
          v8Version?: string;
        };
        setPlatform(systemInfo.platform || "Unknown");
        setElectronVersion(systemInfo.electronVersion || "Unknown");
        setNodeVersion(systemInfo.nodeVersion || "Unknown");
      } else {
        setPlatform("Unknown");
        setElectronVersion("Unknown");
        setNodeVersion("Unknown");
      }
    }).catch(() => {
      setPlatform("Unknown");
      setElectronVersion("Unknown");
      setNodeVersion("Unknown");
    });
  }, []);

  const openExternal = (url: string) => {
    window.ipcRenderer.invoke("shell:openExternal", url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">About Autai</h2>
        <p className="text-muted-foreground mt-1">
          Automatic AI Agent Driven Browser
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Application Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Version</p>
              <p className="font-mono">{appVersion}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Platform</p>
              <p className="font-mono">{platform}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Electron</p>
              <p className="font-mono">{electronVersion}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Node.js</p>
              <p className="font-mono">{nodeVersion}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resources</CardTitle>
          <CardDescription>
            Helpful links and documentation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => openExternal("https://github.com/yourusername/autai")}
          >
            <Github className="h-4 w-4" />
            GitHub Repository
            <ExternalLink className="h-3 w-3 ml-auto" />
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => openExternal("https://github.com/yourusername/autai/issues")}
          >
            <FileText className="h-4 w-4" />
            Report an Issue
            <ExternalLink className="h-3 w-3 ml-auto" />
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={() => openExternal("https://github.com/yourusername/autai/wiki")}
          >
            <FileText className="h-4 w-4" />
            Documentation
            <ExternalLink className="h-3 w-3 ml-auto" />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credits</CardTitle>
          <CardDescription>
            Built with amazing open source technologies
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <Heart className="h-3 w-3 text-red-500" />
              Built with Electron, React, and TypeScript
            </p>
            <p className="text-muted-foreground">
              UI components by shadcn/ui and Radix UI
            </p>
            <p className="text-muted-foreground">
              AI SDK by Vercel
            </p>
            <p className="text-muted-foreground">
              Assistant UI components by assistant-ui
            </p>
          </div>
          <Separator />
          <div className="text-xs text-muted-foreground">
            <p>© 2024 Autai. All rights reserved.</p>
            <p className="mt-1">
              This software is provided as-is without warranty of any kind.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}