import type { WebContentsView, Session } from "electron";
import log from "electron-log/main";

const logger = log.scope("FingerprintObfuscation");

export interface FingerprintConfig {
  userAgent?: string;
  webRTCIPPolicy?:
    | "default"
    | "default_public_interface_only"
    | "default_public_and_private_interfaces"
    | "disable_non_proxied_udp";
}

const registeredSessions = new WeakSet<Session>();

function getDefaultUA(): string {
  const chromeVersion = process.versions.chrome || "136.0.0.0";
  const platform = process.platform;

  if (platform === "darwin") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
  if (platform === "win32") {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

function fixSecChUa(headers: Record<string, string>): void {
  const chromeVersion = process.versions.chrome || "136";
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "sec-ch-ua") {
      headers[key] = `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not-A.Brand";v="99"`;
    }
  }
}

function ensureHeadersModified(session: Session): void {
  if (registeredSessions.has(session)) return;
  registeredSessions.add(session);

  session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.requestHeaders) {
      fixSecChUa(details.requestHeaders);
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

function buildInjectionScript(): string {
  return `
(function() {
  // navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', {
    get: () => false,
    configurable: true
  });

  // navigator.plugins
  const pluginArray = [
    Object.create(Plugin.prototype, {
      name: { value: 'Chrome PDF Plugin', enumerable: true },
      filename: { value: 'internal-pdf-viewer', enumerable: true },
      description: { value: 'Portable Document Format', enumerable: true },
      length: { value: 1, enumerable: true },
      0: { value: Object.create(MimeType.prototype, {
        type: { value: 'application/x-google-chrome-pdf', enumerable: true },
        suffixes: { value: 'pdf', enumerable: true },
        description: { value: 'Portable Document Format', enumerable: true }
      }), enumerable: true }
    }),
    Object.create(Plugin.prototype, {
      name: { value: 'Chrome PDF Viewer', enumerable: true },
      filename: { value: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', enumerable: true },
      description: { value: '', enumerable: true },
      length: { value: 1, enumerable: true },
      0: { value: Object.create(MimeType.prototype, {
        type: { value: 'application/pdf', enumerable: true },
        suffixes: { value: 'pdf', enumerable: true },
        description: { value: '', enumerable: true }
      }), enumerable: true }
    }),
    Object.create(Plugin.prototype, {
      name: { value: 'Native Client', enumerable: true },
      filename: { value: 'internal-nacl-plugin', enumerable: true },
      description: { value: '', enumerable: true },
      length: { value: 2, enumerable: true },
      0: { value: Object.create(MimeType.prototype, {
        type: { value: 'application/x-nacl', enumerable: true },
        suffixes: { value: '', enumerable: true },
        description: { value: 'Native Client Executable', enumerable: true }
      }), enumerable: true },
      1: { value: Object.create(MimeType.prototype, {
        type: { value: 'application/x-pnacl', enumerable: true },
        suffixes: { value: '', enumerable: true },
        description: { value: 'Portable Native Client Executable', enumerable: true }
      }), enumerable: true }
    })
  ];

  Object.defineProperty(navigator, 'plugins', {
    get: () => pluginArray,
    configurable: true
  });

  Object.defineProperty(navigator, 'mimeTypes', {
    get: () => {
      const mimes = [];
      for (const plugin of pluginArray) {
        for (let i = 0; i < plugin.length; i++) {
          mimes.push(plugin[i]);
        }
      }
      return mimes;
    },
    configurable: true
  });

  // window.chrome
  if (!window.chrome) {
    window.chrome = {};
  }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() {},
      sendMessage: function() {}
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return {
        startE: Date.now(),
        onloadT: Date.now(),
        pageT: Math.random() * 500 + 100,
        tran: 15
      };
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - 0.5,
        startLoadTime: Date.now() / 1000 - 0.3,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true
      };
    };
  }

  // Permissions API
  const originalQuery = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = function(parameters) {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission });
    }
    return originalQuery(parameters);
  };

  // WebGL vendor/renderer
  const getParameterProxyHandler = {
    apply: function(target, ctx, args) {
      const param = args[0];
      // UNMASKED_VENDOR_WEBGL
      if (param === 0x9245) return 'Google Inc. (NVIDIA)';
      // UNMASKED_RENDERER_WEBGL
      if (param === 0x9246) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return Reflect.apply(target, ctx, args);
    }
  };

  if (typeof WebGLRenderingContext !== 'undefined') {
    WebGLRenderingContext.prototype.getParameter = new Proxy(
      WebGLRenderingContext.prototype.getParameter,
      getParameterProxyHandler
    );
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    WebGL2RenderingContext.prototype.getParameter = new Proxy(
      WebGL2RenderingContext.prototype.getParameter,
      getParameterProxyHandler
    );
  }

  // window.outerWidth / outerHeight
  Object.defineProperty(window, 'outerWidth', {
    get: () => window.innerWidth,
    configurable: true
  });
  Object.defineProperty(window, 'outerHeight', {
    get: () => window.innerHeight + 85,
    configurable: true
  });

  // navigator.languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en'],
    configurable: true
  });
})();
  `;
}

export function applyFingerprintObfuscation(
  tab: WebContentsView,
  config: FingerprintConfig = {}
): void {
  const { webContents } = tab;
  const ua = config.userAgent ?? getDefaultUA();

  // Native: User Agent
  webContents.setUserAgent(ua);
  logger.debug(`User agent set to: ${ua}`);

  // Native: WebRTC IP leak prevention
  webContents.setWebRTCIPHandlingPolicy(
    config.webRTCIPPolicy ?? "default_public_interface_only"
  );

  // Native: Fix sec-ch-ua and other HTTP headers
  ensureHeadersModified(webContents.session);

  // JS injection on every page load
  const script = buildInjectionScript();
  webContents.on("dom-ready", () => {
    webContents.executeJavaScript(script).catch((err: Error) => {
      logger.error("Failed to inject fingerprint script:", err.message);
    });
  });
}
