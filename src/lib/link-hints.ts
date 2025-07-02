// Adapted from Vimium's link_hints.js

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
  right?: number;
  bottom?: number;
};

export class LocalHint {
  element: Element;
  rect: Rect;
  linkText?: string;
  reason?: string;
  secondClassCitizen?: boolean;
  possibleFalsePositive?: boolean;
  
  constructor(options: {
    element: Element;
    rect: Rect;
    linkText?: string;
    reason?: string;
    secondClassCitizen?: boolean;
    possibleFalsePositive?: boolean;
  }) {
    this.element = options.element;
    this.rect = options.rect;
    this.linkText = options.linkText;
    this.reason = options.reason;
    this.secondClassCitizen = options.secondClassCitizen;
    this.possibleFalsePositive = options.possibleFalsePositive;
  }
}

// Get visible client rect for an element
const getVisibleClientRect = (element: Element): DOMRect | null => {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  
  // Check if element is visible
  const style = window.getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  
  return rect;
};

// Check if element is visible and in viewport
const isVisible = (element: Element): boolean => {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  
  return rect.width > 0 && 
         rect.height > 0 &&
         rect.top < window.innerHeight &&
         rect.bottom > 0 &&
         rect.left < window.innerWidth &&
         rect.right > 0 &&
         style.visibility !== 'hidden' &&
         style.display !== 'none' &&
         parseFloat(style.opacity) > 0;
};

// Get all elements including shadow DOM
const getAllElements = (root: Element | ShadowRoot): Element[] => {
  const elements: Element[] = [];
  const children = root.querySelectorAll('*');
  
  children.forEach(element => {
    elements.push(element);
    if (element.shadowRoot) {
      elements.push(...getAllElements(element.shadowRoot));
    }
  });
  
  return elements;
};

// Check for AngularJS click handlers
const hasAngularClickHandler = (element: Element): boolean => {
  const ngAttributes = ['ng-click', 'data-ng-click', 'x-ng-click', 
                       'ng:click', 'data-ng:click', 'x-ng:click',
                       'ng_click', 'data-ng_click', 'x-ng_click'];
  
  return ngAttributes.some(attr => element.hasAttribute(attr));
};

// Check for jsaction handlers
const hasJsAction = (element: Element): boolean => {
  if (!element.hasAttribute('jsaction')) return false;
  
  const jsaction = element.getAttribute('jsaction') || '';
  const rules = jsaction.split(';');
  
  for (const rule of rules) {
    const parts = rule.trim().split(':');
    if (parts.length === 1 || (parts.length === 2 && parts[0] === 'click')) {
      const actionParts = (parts.length === 1 ? parts[0] : parts[1]).trim().split('.');
      if (actionParts[0] !== 'none' && actionParts[actionParts.length - 1] !== '_') {
        return true;
      }
    }
  }
  
  return false;
};

// Main function to check if element is interactable
const isInteractable = (element: Element): {
  clickable: boolean;
  secondClassCitizen?: boolean;
  possibleFalsePositive?: boolean;
  reason?: string;
} => {
  const tagName = element.tagName.toLowerCase();
  let clickable = false;
  let secondClassCitizen = false;
  let possibleFalsePositive = false;
  let reason: string | undefined;

  // Check aria-disabled
  const ariaDisabled = element.getAttribute('aria-disabled');
  if (ariaDisabled && ['', 'true'].includes(ariaDisabled.toLowerCase())) {
    return { clickable: false };
  }

  // Native clickable elements
  switch (tagName) {
    case 'a':
      clickable = true;
      break;
    case 'button':
      clickable = !(element as HTMLButtonElement).disabled;
      break;
    case 'textarea':
      clickable = !(element as HTMLTextAreaElement).disabled && 
                  !(element as HTMLTextAreaElement).readOnly;
      break;
    case 'input':
      const inputEl = element as HTMLInputElement;
      clickable = inputEl.type !== 'hidden' && 
                  !inputEl.disabled && 
                  !(inputEl.readOnly && ['text', 'search', 'email', 'url', 'tel', 'password'].includes(inputEl.type));
      break;
    case 'select':
      clickable = !(element as HTMLSelectElement).disabled;
      break;
    case 'label':
      const labelEl = element as HTMLLabelElement;
      clickable = labelEl.control != null && 
                  !(labelEl.control as any).disabled;
      break;
    case 'img':
      clickable = ['zoom-in', 'zoom-out'].includes(getComputedStyle(element).cursor);
      break;
    case 'details':
      clickable = true;
      reason = 'Open/Close';
      break;
    case 'object':
    case 'embed':
      clickable = true;
      break;
  }

  // Check for event handlers
  if (!clickable) {
    clickable = element.hasAttribute('onclick') ||
                hasAngularClickHandler(element) ||
                hasJsAction(element);
  }

  // Check role attribute
  if (!clickable) {
    const role = element.getAttribute('role');
    const clickableRoles = ['button', 'tab', 'link', 'checkbox', 'menuitem', 
                           'menuitemcheckbox', 'menuitemradio', 'radio'];
    if (role && clickableRoles.includes(role.toLowerCase())) {
      clickable = true;
    }
  }

  // Check contentEditable
  if (!clickable) {
    const contentEditable = element.getAttribute('contentEditable');
    if (contentEditable && ['', 'contenteditable', 'true'].includes(contentEditable.toLowerCase())) {
      clickable = true;
    }
  }

  // Check class name for button-like classes
  if (!clickable) {
    const className = element.getAttribute('class') || '';
    if (className.toLowerCase().includes('button')) {
      clickable = true;
      possibleFalsePositive = true;
    }
  }

  // Check tabindex
  if (!clickable) {
    const tabIndexStr = element.getAttribute('tabindex');
    if (tabIndexStr) {
      const tabIndex = parseInt(tabIndexStr);
      if (!isNaN(tabIndex) && tabIndex >= 0) {
        clickable = true;
        secondClassCitizen = true;
      }
    }
  }

  return { clickable, secondClassCitizen, possibleFalsePositive, reason };
};

// Get link text for filtering
const getLinkText = (element: Element): string => {
  const tagName = element.tagName.toLowerCase();
  let linkText = '';

  if (tagName === 'input') {
    const inputEl = element as HTMLInputElement;
    if (inputEl.labels && inputEl.labels.length > 0) {
      linkText = inputEl.labels[0].textContent?.trim() || '';
      if (linkText.endsWith(':')) {
        linkText = linkText.slice(0, -1);
      }
    } else if (inputEl.type === 'file') {
      linkText = 'Choose File';
    } else if (inputEl.type !== 'password') {
      linkText = inputEl.value || inputEl.placeholder || '';
    }
  } else if (tagName === 'a' && !element.textContent?.trim()) {
    // Check for image alt text within links
    const img = element.querySelector('img');
    if (img) {
      linkText = img.alt || img.title || '';
    }
  } else if (element.textContent) {
    linkText = element.textContent.slice(0, 256);
  } else if (element.hasAttribute('title')) {
    linkText = element.getAttribute('title') || '';
  } else {
    linkText = element.innerHTML.slice(0, 256);
  }

  return linkText.trim();
};

// Main function to get local hints
export const getLocalHints = (container: HTMLElement): LocalHint[] => {
  const elements = getAllElements(container);
  const hints: LocalHint[] = [];
  
  for (const element of elements) {
    if (!isVisible(element)) continue;
    
    const { clickable, secondClassCitizen, possibleFalsePositive, reason } = isInteractable(element);
    if (!clickable) continue;
    
    const rect = getVisibleClientRect(element);
    if (!rect) continue;
    
    const linkText = getLinkText(element);
    
    hints.push(new LocalHint({
      element,
      rect: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      },
      linkText,
      reason,
      secondClassCitizen,
      possibleFalsePositive
    }));
  }
  
  // Filter out false positives
  const filteredHints = hints.filter((hint, index) => {
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
  
  return filteredHints;
};