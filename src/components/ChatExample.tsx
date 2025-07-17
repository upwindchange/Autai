import { useChat } from '@ai-sdk/react';
import { IPCChatTransport } from '@/lib/IPCChatTransport';
import { useLLMOutput } from '@llm-ui/react';
import { markdownLookBack } from '@llm-ui/markdown';
import { MarkdownBlock } from './ai-chat/blocks/markdown-block';
import { codeBlock } from './ai-chat/blocks/code-block';

/**
 * Example component demonstrating how to use the IPCChatTransport with useChat
 */
export function ChatExample() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    // Use the custom IPC transport instead of the default HTTP transport
    transport: new IPCChatTransport({
      // Optional: customize channel names if needed
      sendChannel: 'chat:sendMessages',
      reconnectChannel: 'chat:reconnectToStream',
      
      // Optional: add metadata to all requests
      metadata: {
        userId: 'user-123',
        sessionId: 'session-456',
      },
      
      // Optional: transform request before sending
      prepareSendMessagesRequest: async ({ messages, ...options }) => {
        // You can filter or transform messages here
        return {
          ...options,
          messages: messages.slice(-10), // Only send last 10 messages
        };
      },
    }),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <MessageContent key={message.id} message={message} />
        ))}
        
        {isLoading && (
          <div className="bg-gray-100 mr-auto max-w-[80%] p-3 rounded-lg">
            <div className="font-semibold text-sm mb-1">Assistant</div>
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
            </div>
          </div>
        )}
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="p-4 border-t">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Message content component with llm-ui integration
 */
function MessageContent({ message }: { message: any }) {
  const { blockMatches } = useLLMOutput({
    llmOutput: message.content,
    blocks: [codeBlock],
    fallbackBlock: {
      component: MarkdownBlock,
      lookBack: markdownLookBack()
    },
    isStreamFinished: true
  });

  const isUser = message.role === 'user';

  return (
    <div
      className={`p-3 rounded-lg ${
        isUser
          ? 'bg-blue-100 ml-auto max-w-[80%]'
          : 'bg-gray-100 mr-auto max-w-[80%]'
      }`}
    >
      <div className="font-semibold text-sm mb-1">
        {isUser ? 'You' : 'Assistant'}
      </div>
      <div className={`prose prose-sm max-w-none ${!isUser && 'dark:prose-invert'}`}>
        {blockMatches.map((match, i) => {
          const Component = match.block.component;
          return <Component key={i} blockMatch={match} />;
        })}
      </div>
    </div>
  );
}