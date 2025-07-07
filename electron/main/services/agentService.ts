import { OpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { WebContentsView } from "electron";
import { settingsService } from "./settingsService";

/**
 * Represents an element on a web page that can be interacted with
 */
interface InteractableElement {
  id: number;
  type: string;
  text: string;
  href?: string;
  rect: { top: number; left: number; width: number; height: number };
  reason?: string;
  selector: string;
}

/**
 * Service that manages AI agent interactions with web pages
 * Handles conversation memory, element detection, and action execution
 */
class AgentService {
  private model: OpenAI | null = null;
  private memory: InMemoryChatMessageHistory;

  constructor() {
    this.memory = new InMemoryChatMessageHistory();
  }

  /**
   * Creates an OpenAI model instance with current settings
   */
  private getModel(useComplexModel: boolean = false): OpenAI {
    const settings = settingsService.getActiveSettings();
    
    if (!settings || !settings.apiKey) {
      throw new Error("AI settings not configured. Please configure your API settings first.");
    }

    const modelName = useComplexModel ? settings.complexModel : settings.simpleModel;

    return new OpenAI({
      temperature: 0,
      apiKey: settings.apiKey,
      modelName: modelName,
      configuration: {
        baseURL: settings.apiUrl,
      },
    });
  }

  /**
   * Processes a user message through the AI model with conversation history
   */
  async processMessage(input: string, useComplexModel: boolean = true): Promise<string> {
    try {
      this.memory.addUserMessage(input);

      const history = await this.memory.getMessages();
      const model = this.getModel(useComplexModel);
      const response = await model.invoke(history);

      this.memory.addAIMessage(response.content.toString());

      return response.content.toString();
    } catch (error) {
      if (error instanceof Error && error.message.includes("not configured")) {
        throw error;
      }
      throw new Error(`AI processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Retrieves all interactable elements from a web page
   */
  async getInteractableElements(view: WebContentsView): Promise<InteractableElement[]> {
    try {
      const elements = await view.webContents.executeJavaScript('window.getInteractableElements()');
      return elements;
    } catch (error) {
      console.error('Failed to get interactable elements:', error);
      return [];
    }
  }

  /**
   * Clicks an element on the page by its ID
   */
  async clickElement(view: WebContentsView, elementId: number): Promise<boolean> {
    try {
      const result = await view.webContents.executeJavaScript(`window.clickElementById(${elementId})`);
      return result;
    } catch (error) {
      console.error('Failed to click element:', error);
      return false;
    }
  }

  /**
   * Processes a command with awareness of page elements, potentially executing actions
   */
  async processCommandWithContext(
    command: string, 
    view: WebContentsView
  ): Promise<{ response: string; action?: { type: string; elementId?: number } }> {
    const elements = await this.getInteractableElements(view);
    
    const context = `Available interactive elements on the page:
${elements.map(el => `${el.id}. ${el.type}: "${el.text}" ${el.href ? `(${el.href})` : ''}`).join('\n')}

User command: ${command}`;

    const response = await this.processMessage(context, true);
    
    /**
     * Parse AI response for action commands
     * TODO: Replace with structured output or function calling for production
     */
    const actionMatch = response.match(/CLICK_ELEMENT_(\d+)/);
    if (actionMatch) {
      const elementId = parseInt(actionMatch[1]);
      await this.clickElement(view, elementId);
      return {
        response: response.replace(/CLICK_ELEMENT_\d+/, ''),
        action: { type: 'click', elementId }
      };
    }

    return { response };
  }
}

export const agentService = new AgentService();