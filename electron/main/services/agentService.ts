import { OpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";
import { WebContentsView } from "electron";

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
  private model: OpenAI;
  private memory: InMemoryChatMessageHistory;

  constructor() {
    this.model = new OpenAI({
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      },
    });
    this.memory = new InMemoryChatMessageHistory();
  }

  async processMessage(input: string): Promise<string> {
    // Add user message to memory
    this.memory.addUserMessage(input);

    // Get conversation history
    const history = await this.memory.getMessages();

    // Generate response
    const response = await this.model.invoke(history);

    // Add AI response to memory
    this.memory.addAIMessage(response.content.toString());

    return response.content.toString();
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

    const response = await this.processMessage(context);
    
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