# DomService API Documentation

The `DomService` class provides comprehensive DOM analysis and manipulation capabilities for web automation. It enables extraction of interactive elements, page information, element hashing for tracking changes, and DOM state comparison.

## Constructor

### `new DomService(webContents: WebContents)`
Creates a new DomService instance with the specified WebContents.

**Parameters:**
- `webContents`: Electron WebContents object for the target web page

## Public Methods

### DOM Analysis & Extraction

#### `getClickableElements(highlightElements?, focusElement?, viewportExpansion?): Promise<DOMState>`
Extracts clickable/interactive elements from the current page DOM and returns structured representation.

**Parameters:**
- `highlightElements` (boolean, default: true): Whether to visually highlight elements on the page
- `focusElement` (number, default: -1): Index of element to focus specifically
- `viewportExpansion` (number, default: 0): Additional area around viewport to include

**Returns:**
- `Promise<DOMState>`: Contains elementTree (DOM hierarchy) and selectorMap (index to element mapping)

#### `clickableElementsToString(rootNode, includeAttributes?): string`
Converts structured DOM elements to a human-readable string representation optimized for LLM consumption.

**Parameters:**
- `rootNode`: DOMElementNode to convert
- `includeAttributes`: Array of attribute names to include, uses DEFAULT_INCLUDE_ATTRIBUTES if null

**Returns:**
- `string`: Formatted text representation of elements

#### `getPageInfo(): Promise<PageInfo>`
Retrieves comprehensive information about the current page including dimensions and scroll position.

**Returns:**
- `Promise<PageInfo>`: Object containing viewport dimensions, page dimensions, and scroll information

#### `buildDomTree(args?): Promise<DOMExtractionResult>`
Executes the DOM tree building function in the page context to extract the page structure.

**Parameters:**
- `args`: Partial<BuildDomTreeArgs> with options for DOM extraction

**Returns:**
- `Promise<DOMExtractionResult>`: Success/failure status with extracted DOM data

### Element Hashing & Fingerprinting

#### `hashDomElement(element): string`
Creates a unique hash fingerprint for a DOM element based on its attributes, path, and xpath.

**Parameters:**
- `element`: DOMElementNode to hash

**Returns:**
- `string`: Combined hash of branch path, attributes, and xpath

#### `getClickableElementHashes(rootElement): Set<string>`
Extracts hash fingerprints for all clickable elements in a DOM tree.

**Parameters:**
- `rootElement`: DOMElementNode root to traverse

**Returns:**
- `Set<string>`: Unique hashes for all clickable elements

#### `updateElementCache(url, rootElement): void`
Updates internal cache of element hashes and marks new elements as "isNew".

**Parameters:**
- `url`: Page URL for cache identification
- `rootElement`: DOMElementNode root to analyze

#### `clearElementCache(url?): void`
Clears the element hash cache for a specific URL or all URLs.

**Parameters:**
- `url`: Specific URL to clear, or clears all if undefined

### DOM State Management

#### `compareDOMStates(previous, current): DOMStateDiff`
Compares two DOM states to identify added, removed, or modified elements.

**Parameters:**
- `previous`: Previous DOMState
- `current`: Current DOMState

**Returns:**
- `DOMStateDiff`: Lists of added, removed, modified, and unchanged elements

## Private Methods

### DOM Building & Parsing

#### `_buildDomTree()`
Internal method that orchestrates the DOM analysis process by executing JavaScript in the page context and constructing the TypeScript DOM tree.

#### `_constructDomTree()`
Transforms JavaScript evaluation results into TypeScript DOM structures.

#### `_parseNode()`
Parses individual nodes from JavaScript data structures into TypeScript representations.

### Element Analysis

#### `_getAllHighlightedElements()`
Extracts all elements with highlightIndex from a DOM tree.

#### `_getParentBranchPath()`
Calculates the hierarchical path from root to element as tag names.

#### `hasParentWithHighlightIndex()`
Checks if a node has a highlighted parent element.

#### `getAllTextTillNextClickableElement()`
Extracts text content from an element until the next clickable element is encountered.

### Text Processing

#### `capTextLength()`
Truncates text with ellipsis when exceeding specified length.

### Hashing

#### `_hashDomElementToComponents()`
Breaks down a DOM element into components for hashing (internal use).

#### `_hashString()`
SHA256 hash function implementation.

### Performance & Logging

#### `logPerformanceMetrics()`
Logs performance information about DOM analysis operations.

## Types

The DomService works with several important types defined in `@shared/index`:

- `DOMElementNode`: Structured representation of a DOM element
- `DOMTextNode`: Representation of text nodes
- `DOMNode`: Union of element and text nodes
- `SelectorMap`: Index-based mapping of elements
- `DOMState`: Complete DOM state including elements and selector mapping
- `DOMStateDiff`: Differences between DOM states
- `PageInfo`: Page dimensions and scroll information
- `HashedDomElement`: Hashed components of a DOM element