import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ViewDebugTools() {
  const [viewId, setViewId] = useState<string>("");
  const [url, setUrl] = useState("");
  const [bounds, setBounds] = useState({ x: 0, y: 0, width: 800, height: 600 });
  const [result, setResult] = useState<{success: boolean, message: string} | null>(null);

  const handleNavigate = async () => {
    try {
      window.ipcRenderer.send("debug:threadview:navigateTo", {
        viewId,
        url,
      });
      
      setResult({
        success: true,
        message: `Navigation command sent to ${url}`
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Navigation failed: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  };

  const handleRefresh = async () => {
    try {
      window.ipcRenderer.send("debug:threadview:refresh", {
        viewId,
      });
      
      setResult({
        success: true,
        message: "Refresh command sent"
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  };

  const handleGoBack = async () => {
    try {
      window.ipcRenderer.send("debug:threadview:goBack", {
        viewId,
      });
      
      setResult({
        success: true,
        message: "Go back command sent"
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Go back failed: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  };

  const handleGoForward = async () => {
    try {
      window.ipcRenderer.send("debug:threadview:goForward", {
        viewId,
      });
      
      setResult({
        success: true,
        message: "Go forward command sent"
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Go forward failed: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  };

  const handleSetVisibility = async (isVisible: boolean) => {
    try {
      window.ipcRenderer.send("debug:threadview:setVisibility", {
        viewId,
        isVisible,
      });
      
      setResult({
        success: true,
        message: `View visibility command sent: ${isVisible}`
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Set visibility failed: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  };

  const handleSetBounds = async () => {
    try {
      window.ipcRenderer.send("debug:threadview:setBounds", {
        viewId,
        bounds,
      });
      
      setResult({
        success: true,
        message: "View bounds command sent"
      });
    } catch (error) {
      setResult({
        success: false,
        message: `Set bounds failed: ${error instanceof Error ? error.message : "Unknown error"}`
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>View Debug Tools</CardTitle>
        <CardDescription>
          Debugging tools for thread views (enabled via settings)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="view-id">View ID</Label>
          <Input
            id="view-id"
            value={viewId}
            onChange={(e) => setViewId(e.target.value)}
            placeholder="Enter view ID"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="url">URL</Label>
          <Input
            id="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Button onClick={handleNavigate}>Navigate</Button>
          <Button variant="outline" onClick={handleRefresh}>Refresh</Button>
          <Button variant="outline" onClick={handleGoBack}>Go Back</Button>
          <Button variant="outline" onClick={handleGoForward}>Go Forward</Button>
          <Button variant="outline" onClick={() => handleSetVisibility(true)}>Show</Button>
          <Button variant="outline" onClick={() => handleSetVisibility(false)}>Hide</Button>
        </div>

        <div className="space-y-2">
          <Label>Bounds</Label>
          <div className="grid grid-cols-4 gap-2">
            <Input
              type="number"
              value={bounds.x}
              onChange={(e) => setBounds({...bounds, x: parseInt(e.target.value) || 0})}
              placeholder="X"
            />
            <Input
              type="number"
              value={bounds.y}
              onChange={(e) => setBounds({...bounds, y: parseInt(e.target.value) || 0})}
              placeholder="Y"
            />
            <Input
              type="number"
              value={bounds.width}
              onChange={(e) => setBounds({...bounds, width: parseInt(e.target.value) || 0})}
              placeholder="Width"
            />
            <Input
              type="number"
              value={bounds.height}
              onChange={(e) => setBounds({...bounds, height: parseInt(e.target.value) || 0})}
              placeholder="Height"
            />
          </div>
          <Button onClick={handleSetBounds}>Set Bounds</Button>
        </div>

        {result && (
          <div className={`p-3 rounded-md ${result.success ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
            {result.message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}