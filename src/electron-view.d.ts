declare global {
  interface Window {
    electronView: {
      createView: (options: any) => Promise<number>;
      setViewBounds: (viewId: number, bounds: Electron.Rectangle) => Promise<void>;
      loadViewUrl: (viewId: number, url: string) => Promise<void>;
      removeView: (viewId: number) => Promise<void>;
    };
  }
}

export {};