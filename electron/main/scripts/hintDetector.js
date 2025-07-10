// Hint detection script to be injected into WebContentsView
(function () {
  // Helper functions
  const isVisible = (element, checkViewport = true) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    // Check if element has dimensions and is not hidden by CSS
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      style.visibility === "hidden" ||
      style.display === "none" ||
      parseFloat(style.opacity) <= 0
    ) {
      return false;
    }

    // Check viewport constraints if requested
    if (checkViewport) {
      if (
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth
      ) {
        return false;
      }
    }

    // Check if element is actually visible (not just in DOM)
    // Using getClientRects to handle multi-line links
    const rects = element.getClientRects();
    if (rects.length === 0) return false;

    // Check if any rect has actual area
    for (const r of rects) {
      if (r.width > 0 && r.height > 0) {
        return true;
      }
    }
    return false;
  };

  // Get all elements including shadow DOM
  const getAllElements = (root, elements = []) => {
    const children = root.querySelectorAll("*");
    for (const element of children) {
      elements.push(element);
      if (element.shadowRoot) {
        getAllElements(element.shadowRoot, elements);
      }
    }
    return elements;
  };

  // Check if element is scrollable
  const isScrollableElement = (element) => {
    const style = window.getComputedStyle(element);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    return (
      (element.scrollHeight > element.clientHeight &&
        ["auto", "scroll"].includes(overflowY)) ||
      (element.scrollWidth > element.clientWidth &&
        ["auto", "scroll"].includes(overflowX))
    );
  };

  const hasAngularClickHandler = (element) => {
    const ngAttributes = [
      "ng-click",
      "data-ng-click",
      "x-ng-click",
      "ng:click",
      "data-ng:click",
      "x-ng:click",
      "ng_click",
      "data-ng_click",
      "x-ng_click",
    ];

    return ngAttributes.some((attr) => element.hasAttribute(attr));
  };

  const hasJsAction = (element) => {
    if (!element.hasAttribute("jsaction")) return false;

    const jsaction = element.getAttribute("jsaction") || "";
    const rules = jsaction.split(";");

    for (const rule of rules) {
      const parts = rule.trim().split(":");
      if (parts.length === 1 || (parts.length === 2 && parts[0] === "click")) {
        const actionParts = (parts.length === 1 ? parts[0] : parts[1])
          .trim()
          .split(".");
        if (
          actionParts[0] !== "none" &&
          actionParts[actionParts.length - 1] !== "_"
        ) {
          return true;
        }
      }
    }

    return false;
  };

  const isInteractable = (element) => {
    const tagName = element.tagName.toLowerCase();
    const style = window.getComputedStyle(element);
    let clickable = false;
    let reason = null;
    let possibleFalsePositive = false;
    let secondClassCitizen = false;

    // Check aria-disabled
    const ariaDisabled = element.getAttribute("aria-disabled");
    if (ariaDisabled && ["", "true"].includes(ariaDisabled.toLowerCase())) {
      return { clickable: false };
    }

    // Native clickable elements
    switch (tagName) {
      case "a":
        clickable = true;
        break;
      case "button":
        clickable = !element.disabled;
        break;
      case "textarea":
        clickable = !element.disabled && !element.readOnly;
        break;
      case "input":
        clickable =
          element.type !== "hidden" &&
          !element.disabled &&
          !(
            element.readOnly &&
            ["text", "search", "email", "url", "tel", "password"].includes(
              element.type
            )
          );
        break;
      case "select":
        clickable = !element.disabled;
        break;
      case "label":
        clickable = element.control != null && !element.control.disabled;
        break;
      case "img":
        clickable = ["zoom-in", "zoom-out"].includes(style.cursor);
        break;
      case "details":
        clickable = true;
        reason = "Open/Close";
        break;
      case "object":
      case "embed":
        clickable = true;
        break;
      case "body":
        // Special handling for body element - for frame focusing
        if (element === document.body) {
          // Frame focusing - check if this is a focusable frame
          if (
            window.innerWidth > 3 &&
            window.innerHeight > 3 &&
            document.body.tagName.toLowerCase() !== "frameset"
          ) {
            // Check if we're in an iframe that can be focused
            if (window !== window.top) {
              clickable = true;
              reason = "Frame";
            } else if (isScrollableElement(element)) {
              clickable = true;
              reason = "Scroll";
            }
          }
        }
        break;
      case "div":
      case "ol":
      case "ul":
        // Scrollable containers
        if (isScrollableElement(element)) {
          clickable = true;
          reason = "Scroll";
        }
        break;
    }

    // Check for event handlers
    if (!clickable) {
      clickable =
        element.hasAttribute("onclick") ||
        hasAngularClickHandler(element) ||
        hasJsAction(element);
    }

    // Check role attribute
    if (!clickable) {
      const role = element.getAttribute("role");
      const clickableRoles = [
        "button",
        "tab",
        "link",
        "checkbox",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "radio",
      ];
      if (role && clickableRoles.includes(role.toLowerCase())) {
        clickable = true;
      }
    }

    // Check contentEditable
    if (!clickable) {
      const contentEditable = element.getAttribute("contentEditable");
      if (
        contentEditable &&
        ["", "contenteditable", "true"].includes(contentEditable.toLowerCase())
      ) {
        clickable = true;
      }
    }

    // Check class name for button-like classes
    if (!clickable) {
      const className = element.getAttribute("class") || "";
      if (className.toLowerCase().includes("button")) {
        clickable = true;
        possibleFalsePositive = true;
      }
    }

    // Check cursor style for clickable appearance
    if (!clickable) {
      const cursor = style.cursor || "";
      if (["pointer", "zoom-in", "zoom-out"].includes(cursor)) {
        clickable = true;
        possibleFalsePositive = true;
      }
    }

    // Check tabindex
    if (!clickable) {
      const tabIndexStr = element.getAttribute("tabindex");
      if (tabIndexStr) {
        const tabIndex = parseInt(tabIndexStr);
        if (!isNaN(tabIndex) && tabIndex >= 0) {
          clickable = true;
          secondClassCitizen = true;
        }
      }
    }

    return { clickable, reason, possibleFalsePositive, secondClassCitizen };
  };

  const getLinkText = (element) => {
    const tagName = element.tagName.toLowerCase();
    let linkText = "";

    if (tagName === "input") {
      if (element.labels && element.labels.length > 0) {
        linkText = element.labels[0].textContent?.trim() || "";
        if (linkText.endsWith(":")) {
          linkText = linkText.slice(0, -1);
        }
      } else if (element.type === "file") {
        linkText = "Choose File";
      } else if (element.type !== "password") {
        linkText = element.value || element.placeholder || "";
      }
    } else if (tagName === "a" && !element.textContent?.trim()) {
      const img = element.querySelector("img");
      if (img) {
        linkText = img.alt || img.title || "";
      }
    } else if (element.textContent) {
      linkText = element.textContent.slice(0, 256);
    } else if (element.hasAttribute("title")) {
      linkText = element.getAttribute("title") || "";
    } else {
      linkText = element.innerHTML.slice(0, 256);
    }

    return linkText.trim();
  };

  // Create hint marker overlay container
  const createHintContainer = (viewportOnly = true) => {
    let container = document.getElementById("vimium-hint-container");
    if (container) {
      // Remove existing container to ensure correct positioning mode
      container.remove();
    }
    
    container = document.createElement("div");
    container.id = "vimium-hint-container";

    if (viewportOnly) {
      // Use fixed positioning for viewport mode (better performance)
      container.style.cssText = `
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                pointer-events: none !important;
                z-index: 2147483647 !important;
                isolation: isolate !important;
              `;
    } else {
      // Use absolute positioning for full document mode
      const docHeight = Math.max(
        document.body.scrollHeight || 0,
        document.body.offsetHeight || 0,
        document.documentElement.clientHeight || 0,
        document.documentElement.scrollHeight || 0,
        document.documentElement.offsetHeight || 0
      );

      const docWidth = Math.max(
        document.body.scrollWidth || 0,
        document.body.offsetWidth || 0,
        document.documentElement.clientWidth || 0,
        document.documentElement.scrollWidth || 0,
        document.documentElement.offsetWidth || 0
      );

      container.style.cssText = `
                position: absolute !important;
                top: 0 !important;
                left: 0 !important;
                width: ${docWidth}px !important;
                height: ${docHeight}px !important;
                pointer-events: none !important;
                z-index: 2147483647 !important;
                isolation: isolate !important;
              `;
    }
    
    document.documentElement.appendChild(container);
    return container;
  };

  // Clear existing hint markers
  const clearHints = () => {
    const container = document.getElementById("vimium-hint-container");
    if (container) {
      container.innerHTML = "";
    }
  };

  // Generate hint numbers starting from 1
  const generateHintString = (index) => {
    return String(index);
  };

  // Display hint markers
  window.showHints = (viewportOnly = true) => {
    clearHints();
    const container = createHintContainer(viewportOnly);
    const hints = window.detectHints(viewportOnly);

    hints.forEach((hint, index) => {
      const marker = document.createElement("div");
      const hintLabel = generateHintString(index + 1);

      // Dynamic positioning based on mode
      let positionStyles;
      if (viewportOnly) {
        // Fixed positioning for viewport mode
        positionStyles = `
                position: fixed !important;
                left: ${hint.rect.left}px !important;
                top: ${hint.rect.top}px !important;`;
      } else {
        // Absolute positioning for full document mode
        const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
        const scrollY = window.pageYOffset || document.documentElement.scrollTop;
        
        positionStyles = `
                position: absolute !important;
                left: ${hint.rect.left + scrollX}px !important;
                top: ${hint.rect.top + scrollY}px !important;`;
      }
      
      marker.style.cssText = positionStyles + `
                background: linear-gradient(to bottom, #FFF785 0%, #FFC542 100%) !important;
                border: 1px solid #C38A22 !important;
                border-radius: 3px !important;
                box-shadow: 0px 3px 7px 0px rgba(0, 0, 0, 0.3) !important;
                color: #302505 !important;
                font-family: Helvetica, Arial, sans-serif !important;
                font-size: 11px !important;
                font-weight: bold !important;
                padding: 2px 5px !important;
                text-align: center !important;
                user-select: none !important;
                cursor: pointer !important;
                min-width: 16px !important;
                z-index: 2147483647 !important;
                pointer-events: auto !important;
              `;

      marker.textContent = hintLabel;
      marker.title = hint.reason || hint.linkText || hint.href || "";

      // Store hint data on the marker for click handling
      marker.setAttribute("data-hint-index", index);

      // Add click handler to the marker
      marker.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const hintIndex = parseInt(marker.getAttribute("data-hint-index"));

        // Find and click the corresponding element
        const allHints = window.detectHints(false); // Use full document for clicking
        if (allHints[hintIndex]) {
          const targetHint = allHints[hintIndex];
          const elements = getAllElements(document.documentElement);

          // Find the element that matches this hint
          for (const element of elements) {
            const rect = element.getBoundingClientRect();
            if (
              Math.abs(rect.top - targetHint.rect.top) < 1 &&
              Math.abs(rect.left - targetHint.rect.left) < 1 &&
              Math.abs(rect.width - targetHint.rect.width) < 1 &&
              Math.abs(rect.height - targetHint.rect.height) < 1
            ) {
              // Special handling for different element types
              if (element.tagName === "DETAILS") {
                element.open = !element.open;
              } else if (
                element.tagName === "INPUT" ||
                element.tagName === "TEXTAREA" ||
                element.tagName === "SELECT"
              ) {
                element.focus();
              } else {
                element.click();
              }
              break;
            }
          }
        }
      });

      container.appendChild(marker);
    });

    return hints;
  };

  // Hide hint markers
  window.hideHints = () => {
    clearHints();
  };

  // Main detection function with viewport option
  window.detectHints = (viewportOnly = true) => {
    let hints = [];
    const allElements = getAllElements(document.documentElement);

    // First pass: collect all hints
    allElements.forEach((element) => {
      if (!isVisible(element, viewportOnly)) return;

      const interactInfo = isInteractable(element);
      if (!interactInfo.clickable) return;

      const rect = element.getBoundingClientRect();
      const linkText = getLinkText(element);

      // Handle image maps
      if (element.tagName.toLowerCase() === "img") {
        const mapName = element.getAttribute("usemap");
        if (mapName) {
          const map = document.querySelector(
            'map[name="' + mapName.replace(/^#/, "") + '"]'
          );
          if (map) {
            const areas = map.getElementsByTagName("area");
            for (const area of areas) {
              const areaRect = area.getBoundingClientRect();
              if (areaRect.width > 0 && areaRect.height > 0) {
                hints.push({
                  element: area,
                  rect: {
                    top: areaRect.top,
                    left: areaRect.left,
                    width: areaRect.width,
                    height: areaRect.height,
                    right: areaRect.right,
                    bottom: areaRect.bottom,
                  },
                  linkText: area.alt || area.title || "Area",
                  tagName: "area",
                  href: area.href || null,
                  reason: interactInfo.reason,
                  possibleFalsePositive: false,
                  secondClassCitizen: false,
                });
              }
            }
            return; // Skip the image itself
          }
        }
      }

      hints.push({
        element: element,
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
        linkText,
        tagName: element.tagName.toLowerCase(),
        href: element.href || null,
        reason: interactInfo.reason,
        possibleFalsePositive: interactInfo.possibleFalsePositive,
        secondClassCitizen: interactInfo.secondClassCitizen,
      });
    });

    // Filter out false positives and duplicates
    hints = hints.filter((hint, index) => {
      if (!hint.possibleFalsePositive) return true;

      // Check if any descendant in nearby hints is clickable
      const lookbackWindow = 6;
      const start = Math.max(0, index - lookbackWindow);

      for (let i = start; i < index; i++) {
        let candidateDescendant = hints[i].element;
        // Check up to 3 levels of ancestry
        for (let j = 0; j < 3; j++) {
          candidateDescendant = candidateDescendant?.parentElement;
          if (candidateDescendant === hint.element) {
            return false; // This is a false positive
          }
        }
      }

      return true;
    });

    // Remove duplicate hints for label controls
    const labelledElements = new Set();
    hints = hints.filter((hint) => {
      if (hint.tagName === "label" && hint.element.control) {
        const controlId = hint.element.control.id || hint.element.control;
        if (labelledElements.has(controlId)) {
          return false;
        }
        labelledElements.add(controlId);
      }
      return true;
    });

    // Return only the data needed by the renderer (not the element references)
    return hints.map((hint) => ({
      rect: hint.rect,
      linkText: hint.linkText,
      tagName: hint.tagName,
      href: hint.href,
      reason: hint.reason,
    }));
  };

  // Get structured data for AI agent
  window.getInteractableElements = (viewportOnly = true) => {
    const hints = window.detectHints(viewportOnly);
    return hints.map((hint, index) => ({
      id: index + 1,
      type: determineElementType(hint),
      text: hint.linkText,
      href: hint.href,
      rect: hint.rect,
      reason: hint.reason,
      selector: generateSelector(hint)
    }));
  };

  // Determine element type for AI understanding
  const determineElementType = (hint) => {
    if (hint.href && hint.tagName === "a") return "link";
    if (hint.tagName === "button") return "button";
    if (hint.tagName === "input") return "input";
    if (hint.tagName === "select") return "select";
    if (hint.tagName === "textarea") return "textarea";
    if (hint.reason === "Scroll") return "scrollable";
    if (hint.reason === "Frame") return "frame";
    if (hint.reason === "Open/Close") return "details";
    return "interactive";
  };

  // Generate a selector for AI to reference elements
  const generateSelector = (hint) => {
    // Simple selector based on position for now
    // In production, this could be enhanced with more specific selectors
    return `hint-${hint.rect.top}-${hint.rect.left}`;
  };

  // Click element by ID (for AI agent)
  window.clickElementById = (id, viewportOnly = true) => {
    const elements = getAllElements(document.documentElement);
    const hints = window.detectHints(viewportOnly);
    const targetHint = hints[id - 1];
    
    if (!targetHint) return false;

    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (
        Math.abs(rect.top - targetHint.rect.top) < 1 &&
        Math.abs(rect.left - targetHint.rect.left) < 1 &&
        Math.abs(rect.width - targetHint.rect.width) < 1 &&
        Math.abs(rect.height - targetHint.rect.height) < 1
      ) {
        // Execute appropriate action
        if (element.tagName === "DETAILS") {
          element.open = !element.open;
        } else if (
          element.tagName === "INPUT" ||
          element.tagName === "TEXTAREA" ||
          element.tagName === "SELECT"
        ) {
          element.focus();
        } else {
          element.click();
        }
        return true;
      }
    }
    return false;
  };

  // Performance optimization: throttle and debounce utilities
  const throttle = (func, delay) => {
    let lastCall = 0;
    let timeout;
    return (...args) => {
      const now = Date.now();
      clearTimeout(timeout);
      if (now - lastCall >= delay) {
        lastCall = now;
        func(...args);
      } else {
        timeout = setTimeout(() => {
          lastCall = Date.now();
          func(...args);
        }, delay - (now - lastCall));
      }
    };
  };

  const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), delay);
    };
  };

  // Set up automatic hint management
  const refreshHints = () => {
    if (window.showHints) {
      window.showHints(); // Defaults to viewport only
    }
  };

  // Use requestIdleCallback for periodic updates
  const refreshHintsIdle = () => {
    requestIdleCallback(() => {
      refreshHints();
    }, { timeout: 2000 });
  };

  // Debounced refresh for mutations
  const refreshHintsDebounced = debounce(refreshHints, 100);
  
  // Throttled refresh for scroll/resize
  const refreshHintsThrottled = throttle(refreshHints, 150);

  // Auto-show hints when page loads
  setTimeout(() => {
    refreshHints();
  }, 1000);

  // Use throttled refresh for scroll/resize events
  window.addEventListener("scroll", refreshHintsThrottled, { passive: true });
  window.addEventListener("resize", refreshHintsThrottled, { passive: true });

  // Set up mutation observer for dynamic content with debounced refresh
  const observer = new MutationObserver(() => {
    refreshHintsDebounced();
  });

  // Start observing the document for changes
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "hidden"],
    });
  }

  // Use requestIdleCallback for periodic updates
  const periodicRefresh = () => {
    refreshHintsIdle();
    // Schedule next refresh
    setTimeout(periodicRefresh, 5000);
  };
  setTimeout(periodicRefresh, 5000);
})();
