// Hint detection script to be injected into WebContentsView
(function () {
  // Helper functions
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    // Check if element has dimensions and is not hidden by CSS
    // Remove viewport constraints to detect entire webpage
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      parseFloat(style.opacity) > 0
    );
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
        clickable = ["zoom-in", "zoom-out"].includes(
          getComputedStyle(element).cursor
        );
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
        if (
          element === document.body &&
          window.innerWidth > 3 &&
          window.innerHeight > 3
        ) {
          if (isScrollableElement(element)) {
            clickable = true;
            reason = "Scroll";
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
  const createHintContainer = () => {
    let container = document.getElementById("vimium-hint-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "vimium-hint-container";

      // Use absolute positioning to cover entire document, not just viewport
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
      document.documentElement.appendChild(container);
    }
    return container;
  };

  // Clear existing hint markers
  const clearHints = () => {
    const container = document.getElementById("vimium-hint-container");
    if (container) {
      container.innerHTML = "";
    }
  };

  // Generate hint strings (A, B, C, ..., AA, AB, etc.)
  const generateHintString = (index) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let result = "";
    let num = index - 1;

    while (num >= 0) {
      result = chars[num % 26] + result;
      num = Math.floor(num / 26) - 1;
    }

    return result || "A";
  };

  // Display hint markers
  window.showHints = () => {
    clearHints();
    const container = createHintContainer();
    const hints = window.detectHints();

    hints.forEach((hint, index) => {
      const marker = document.createElement("div");
      const hintLabel = generateHintString(index + 1);

      // Use absolute positioning relative to the document, not viewport
      // This ensures hints work even when elements are outside viewport
      const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollY = window.pageYOffset || document.documentElement.scrollTop;

      marker.style.cssText = `
                position: absolute !important;
                left: ${hint.rect.left + scrollX}px !important;
                top: ${hint.rect.top + scrollY}px !important;
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
        const allHints = window.detectHints();
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

  // Main detection function
  window.detectHints = () => {
    let hints = [];
    const allElements = getAllElements(document.documentElement);

    // First pass: collect all hints
    allElements.forEach((element) => {
      if (!isVisible(element)) return;

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

    // Filter out false positives
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

    // Return only the data needed by the renderer (not the element references)
    return hints.map((hint) => ({
      rect: hint.rect,
      linkText: hint.linkText,
      tagName: hint.tagName,
      href: hint.href,
      reason: hint.reason,
    }));
  };

  // Set up automatic hint management
  let hintRefreshTimeout;

  const refreshHints = () => {
    clearTimeout(hintRefreshTimeout);
    hintRefreshTimeout = setTimeout(() => {
      if (window.showHints) {
        window.showHints();
      }
    }, 100); // Debounce rapid events
  };

  // Auto-show hints when page loads
  setTimeout(() => {
    if (window.showHints) {
      window.showHints();
    }
  }, 1000);

  // Refresh hints on scroll to maintain correct positioning
  window.addEventListener("scroll", refreshHints, { passive: true });

  // Refresh hints when window is resized
  window.addEventListener("resize", refreshHints, { passive: true });

  // Set up mutation observer for dynamic content
  const observer = new MutationObserver(() => {
    refreshHints();
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

  // Also refresh hints periodically to catch any missed changes
  setInterval(() => {
    if (window.showHints) {
      window.showHints();
    }
  }, 5000);
})();
