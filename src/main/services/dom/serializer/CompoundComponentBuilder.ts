/**
 * Compound Component Builder - Virtual component generation
 *
 * Advanced system for generating virtual components for complex form controls
 * following browser-use patterns for enhanced accessibility and interaction.
 */

import type {
  EnhancedDOMTreeNode,
  SimplifiedNode,
  CompoundComponent
} from "@shared/dom";
import { ICompoundComponentBuilder } from "@shared/dom/interfaces";

/**
 * Compound Component Builder implementation
 */
export class CompoundComponentBuilder implements ICompoundComponentBuilder {
  private static readonly SUPPORTED_INPUT_TYPES = new Set([
    'date', 'datetime-local', 'month', 'time', 'number', 'range',
    'file', 'color', 'week'
  ]);

  private static readonly SUPPORTED_TAGS = new Set([
    'select', 'video', 'audio', 'input'
  ]);

  /**
   * Build compound components for complex form controls
   */
  buildCompoundComponents(node: SimplifiedNode): void {
    if (!this.canVirtualize(node.originalNode)) {
      return;
    }

    const originalNode = node.originalNode;
    const tag = originalNode.tag?.toLowerCase();

    if (!tag) return;

    switch (tag) {
      case 'input':
        this.buildInputCompound(node);
        break;
      case 'select':
        this.buildSelectCompound(node);
        break;
      case 'video':
      case 'audio':
        this.buildMediaCompound(node);
        break;
    }
  }

  /**
   * Check if node can be virtualized as a compound component
   */
  canVirtualize(node: EnhancedDOMTreeNode): boolean {
    const tag = node.tag?.toLowerCase();

    if (!tag) return false;

    // Check supported tags
    if (!CompoundComponentBuilder.SUPPORTED_TAGS.has(tag)) {
      return false;
    }

    // For input elements, check type
    if (tag === 'input') {
      const inputType = node.attributes.type?.toLowerCase();
      if (!inputType || !CompoundComponentBuilder.SUPPORTED_INPUT_TYPES.has(inputType)) {
        return false;
      }
    }

    // Skip hidden or disabled elements
    if (node.attributes.type === 'hidden' || node.attributes.disabled === 'true') {
      return false;
    }

    return true;
  }

  /**
   * Get supported virtual component types
   */
  getSupportedTypes(): string[] {
    return [
      'date', 'datetime-local', 'month', 'time', 'number', 'range',
      'file', 'color', 'select', 'video', 'audio'
    ];
  }

  /**
   * Build input compound components
   */
  private buildInputCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;
    const inputType = originalNode.attributes.type?.toLowerCase();

    if (!inputType) return;

    switch (inputType) {
      case 'date':
      case 'datetime-local':
      case 'month':
        this.buildDateCompound(node);
        break;
      case 'time':
        this.buildTimeCompound(node);
        break;
      case 'number':
        this.buildNumberCompound(node);
        break;
      case 'range':
        this.buildRangeCompound(node);
        break;
      case 'file':
        this.buildFileCompound(node);
        break;
      case 'color':
        this.buildColorCompound(node);
        break;
      case 'week':
        this.buildWeekCompound(node);
        break;
    }
  }

  /**
   * Build date/time compound components
   */
  private buildDateCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;
    const inputType = originalNode.attributes.type?.toLowerCase();

    let components: CompoundComponent[] = [];

    if (inputType === 'date') {
      components = [
        this.createSpinButton('Day', 1, 31),
        this.createSpinButton('Month', 1, 12),
        this.createSpinButton('Year', 1, 275760)
      ];
    } else if (inputType === 'datetime-local') {
      components = [
        this.createSpinButton('Day', 1, 31),
        this.createSpinButton('Month', 1, 12),
        this.createSpinButton('Year', 1, 275760),
        this.createSpinButton('Hour', 0, 23),
        this.createSpinButton('Minute', 0, 59)
      ];
    } else if (inputType === 'month') {
      components = [
        this.createSpinButton('Month', 1, 12),
        this.createSpinButton('Year', 1, 275760)
      ];
    }

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Build time compound components
   */
  private buildTimeCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;
    const hasSeconds = originalNode.attributes.step &&
                     parseFloat(originalNode.attributes.step) < 60;

    const components = [
      this.createSpinButton('Hour', 0, 23),
      this.createSpinButton('Minute', 0, 59)
    ];

    if (hasSeconds) {
      components.push(this.createSpinButton('Second', 0, 59));
    }

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Build number input compound components
   */
  private buildNumberCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;
    const min = parseFloat(originalNode.attributes.min) || 0;
    const max = parseFloat(originalNode.attributes.max) || 100;
    const step = parseFloat(originalNode.attributes.step) || 1;
    const value = parseFloat(originalNode.attributes.value) || min;

    const components = [
      this.createButton('Increment', `Increase value by ${step}`),
      this.createTextBox('Number', min, max, value),
      this.createButton('Decrement', `Decrease value by ${step}`)
    ];

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Build range input compound components
   */
  private buildRangeCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;
    const min = parseFloat(originalNode.attributes.min) || 0;
    const max = parseFloat(originalNode.attributes.max) || 100;
    const value = parseFloat(originalNode.attributes.value) || min;

    const components = [
      this.createSlider('Range', min, max, value)
    ];

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Build file input compound components
   */
  private buildFileCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;
    const accept = originalNode.attributes.accept || '';
    const multiple = originalNode.attributes.multiple === 'true';
    const capture = originalNode.attributes.capture;

    let description = 'Select files';
    if (multiple) {
      description += ' (multiple allowed)';
    }
    if (capture) {
      description += ` (${capture})`;
    }

    const components = [
      this.createButton('Browse', description, accept),
      this.createTextBox('Selected files', 0, 1000, 0, true)
    ];

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Build color input compound components
   */
  private buildColorCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;
    const value = originalNode.attributes.value || '#000000';

    const components = [
      this.createButton('Color picker', 'Choose a color', undefined, value)
    ];

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Build week input compound components
   */
  private buildWeekCompound(node: SimplifiedNode): void {
    const components = [
      this.createSpinButton('Week', 1, 53)
    ];

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Build select element compound components
   */
  private buildSelectCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;

    // Extract options from children
    const options: string[] = [];
    const _optionValues: string[] = [];

    for (const child of originalNode.children || []) {
      if (child.tag === 'option') {
        const text = child.nodeValue?.trim() || '';
        const value = child.attributes.value || text;
        if (text) {
          options.push(text);
          _optionValues.push(value);
        }
      }
    }

    // Detect value formats
    const formatHint = this.detectOptionFormat(options, _optionValues);

    const components = [
      this.createButton(
        originalNode.attributes.name || 'Select dropdown',
        `${options.length} options available`,
        undefined,
        undefined,
        {
          options_count: options.length,
          first_options: options.slice(0, 4),
          format_hint: formatHint
        }
      )
    ];

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Build media compound components
   */
  private buildMediaCompound(node: SimplifiedNode): void {
    const originalNode = node.originalNode;
    const isVideo = originalNode.tag === 'video';

    const components = [
      this.createButton('Play/Pause', 'Play or pause the media'),
      this.createSlider('Progress', 0, 100, null),
      this.createSlider('Volume', 0, 100, 100)
    ];

    if (isVideo) {
      components.push(this.createButton('Fullscreen', 'Toggle fullscreen mode'));
    }

    node.isCompoundComponent = true;
    node.hasCompoundChildren = true;
    node.originalNode._compoundChildren = components as unknown as Record<string, unknown>[];
  }

  /**
   * Create a spin button component
   */
  private createSpinButton(name: string, min: number, max: number): CompoundComponent {
    return {
      role: 'spinbutton',
      name,
      valuemin: min,
      valuemax: max,
      valuenow: null
    };
  }

  /**
   * Create a button component
   */
  private createButton(
    name: string,
    description: string,
    formats?: string,
    valuenow?: string | number,
    additionalProps?: Record<string, unknown>
  ): CompoundComponent {
    const button: CompoundComponent = {
      role: 'button',
      name,
      description
    };

    if (formats) {
      button.formats = formats;
    }

    if (valuenow !== undefined) {
      button.valuenow = typeof valuenow === 'number' ? valuenow : parseFloat(valuenow.toString()) || null;
    }

    if (additionalProps) {
      Object.assign(button, additionalProps);
    }

    return button;
  }

  /**
   * Create a textbox component
   */
  private createTextBox(
    name: string,
    min: number,
    max: number,
    value: number | null,
    readonly = false
  ): CompoundComponent {
    return {
      role: 'textbox',
      name,
      valuemin: min,
      valuemax: max,
      valuenow: value,
      readonly
    };
  }

  /**
   * Create a slider component
   */
  private createSlider(
    name: string,
    min: number,
    max: number,
    value: number | null
  ): CompoundComponent {
    return {
      role: 'slider',
      name,
      valuemin: min,
      valuemax: max,
      valuenow: value
    };
  }

  /**
   * Detect format hint for option values
   */
  private detectOptionFormat(options: string[], _values: string[]): string {
    if (options.length === 0) return '';

    const samples = options.slice(0, 10); // Check first 10 options

    // Check for country codes (2-3 letters)
    if (samples.every(opt => /^[A-Z]{2,3}$/.test(opt))) {
      return 'Country codes';
    }

    // Check for years (4 digits)
    if (samples.every(opt => /^\d{4}$/.test(opt))) {
      return 'Years';
    }

    // Check for dates
    if (samples.every(opt => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(opt))) {
      return 'Dates';
    }

    // Check for emails
    if (samples.every(opt => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(opt))) {
      return 'Email addresses';
    }

    // Check for phone numbers
    if (samples.every(opt => /^[\d\s\-+()]+$/.test(opt))) {
      return 'Phone numbers';
    }

    // Check for numbers only
    if (samples.every(opt => /^\d+$/.test(opt))) {
      return 'Numbers';
    }

    // Check for currency
    if (samples.every(opt => /^[£€¥$]\s*\d+(\.\d{2})?$/.test(opt))) {
      return 'Currency';
    }

    return '';
  }

  /**
   * Get statistics about compound component building
   */
  getBuildStats(): {
    totalNodesProcessed: number;
    componentsBuilt: number;
    componentsByType: Record<string, number>;
  } {
    // This would be tracked during actual processing
    return {
      totalNodesProcessed: 0,
      componentsBuilt: 0,
      componentsByType: {}
    };
  }

  /**
   * Reset builder statistics
   */
  resetStats(): void {
    // Reset internal tracking
  }
}