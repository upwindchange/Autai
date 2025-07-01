// Adapted from Vimium's link_hints.js

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export class LocalHint {
  element: Element;
  rect: Rect;
  
  constructor(options: {
    element: Element;
    rect: Rect;
  }) {
    this.element = options.element;
    this.rect = options.rect;
  }
}

export const getLocalHints = (container: HTMLElement): LocalHint[] => {
  const hints: LocalHint[] = [];
  const elements = container.querySelectorAll('*');
  
  elements.forEach(element => {
    if (isInteractable(element)) {
      const rect = element.getBoundingClientRect();
      hints.push(new LocalHint({
        element,
        rect: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        }
      }));
    }
  });
  
  return hints;
};

const isInteractable = (element: Element): boolean => {
  // Simplified version of Vimium's detection logic
  const tagName = element.tagName.toLowerCase();
  
  if (tagName === 'a' || tagName === 'button') return true;
  if (tagName === 'input' && (element as HTMLInputElement).type !== 'hidden') return true;
  if (element.hasAttribute('onclick')) return true;
  if (element.getAttribute('role') === 'button') return true;
  
  return false;
};