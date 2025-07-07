import { OpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { WebContentsView } from "electron";
import { settingsService } from "./settingsService";

interface InteractableElement {
  id: number;
  type: string;
  text: string;
  href?: string;
  rect: { top: number; left: number; width: number; height: number };
  reason?: string;
  selector: string;
}

class AgentService {
  private model: OpenAI | null = null;
  private memory: InMemoryChatMessageHistory;

  constructor() {
    this.memory = new InMemoryChatMessageHistory();
  }

  private getModel(useComplexModel: boolean = false): OpenAI {
    const settings = settingsService.getActiveSettings();
    
    if (!settings || !settings.apiKey) {
      throw new Error("AI settings not configured. Please configure your API settings first.");
    }

    const modelName = useComplexModel ? settings.complexModel : settings.simpleModel;

    // Create a new model instance with current settings
    return new OpenAI({
      temperature: 0,
      apiKey: settings.apiKey,
      modelName: modelName,
      configuration: {
        baseURL: settings.apiUrl,
      },
    });
  }

  async processMessage(input: string, useComplexModel: boolean = true): Promise<string> {
    try {
      // Add user message to memory
      this.memory.addUserMessage(input);

      // Get conversation history
      const history = await this.memory.getMessages();

      // Get model with current settings
      const model = this.getModel(useComplexModel);

      // Generate response
      const response = await model.invoke(history);

      // Add AI response to memory
      this.memory.addAIMessage(response.content.toString());

      return response.content.toString();
    } catch (error) {
      if (error instanceof Error && error.message.includes("not configured")) {
        throw error;
      }
      throw new Error(`AI processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Get interactable elements from a web view
  async getInteractableElements(view: WebContentsView): Promise<InteractableElement[]> {
    try {
      const elements = await view.webContents.executeJavaScript('window.getInteractableElements()');
      return elements;
    } catch (error) {
      console.error('Failed to get interactable elements:', error);
      return [];
    }
  }

  // Click an element by its ID
  async clickElement(view: WebContentsView, elementId: number): Promise<boolean> {
    try {
      const result = await view.webContents.executeJavaScript(`window.clickElementById(${elementId})`);
      return result;
    } catch (error) {
      console.error('Failed to click element:', error);
      return false;
    }
  }

  // Process a command with context of available elements
  async processCommandWithContext(
    command: string, 
    view: WebContentsView
  ): Promise<{ response: string; action?: { type: string; elementId?: number } }> {
    const elements = await this.getInteractableElements(view);
    
    // Add context about available elements to the prompt
    const context = `Available interactive elements on the page:
${elements.map(el => `${el.id}. ${el.type}: "${el.text}" ${el.href ? `(${el.href})` : ''}`).join('\n')}

User command: ${command}`;

    const response = await this.processMessage(context, true);
    
    // Parse response to determine if an action should be taken
    // This is a simplified example - in production, you'd use function calling or structured output
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