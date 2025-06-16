import { OpenAI } from "@langchain/openai";
import { InMemoryChatMessageHistory } from "@langchain/core/chat_history";

class AgentService {
  private model: OpenAI;
  private memory: InMemoryChatMessageHistory;

  constructor() {
    this.model = new OpenAI({
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: "https://your_custom_url.com",
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
}

export const agentService = new AgentService();
