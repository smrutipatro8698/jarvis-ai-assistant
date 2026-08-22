import Anthropic from '@anthropic-ai/sdk';
import { ConversationMessage, ToolResult } from './types';
import { getAllToolDefinitions, executeTool } from './tools';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Jarvis, an advanced AI assistant inspired by the AI from Iron Man. You are witty, sophisticated, and efficient. Address the user as 'ma'am'. Keep responses concise and conversational — they will be spoken aloud, so avoid markdown formatting, bullet points, or long lists. When using tools, briefly explain what you're doing. Your personality is helpful, slightly dry humor, and supremely competent.`;

const MODEL = 'claude-sonnet-4-6';

function getDisplayType(toolName: string): ToolResult['displayType'] {
  const map: Record<string, ToolResult['displayType']> = {
    get_weather: 'weather',
    get_time: 'time',
    calculate: 'calculation',
    set_reminder: 'reminder',
    get_reminders: 'reminder',
    system_status: 'system',
    control_device: 'device',
    get_devices: 'device',
    get_news: 'news',
  };
  return map[toolName] || 'text';
}

export async function processMessage(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  onChunk?: (chunk: string) => void,
  onToolResult?: (result: ToolResult) => void
): Promise<{ text: string; toolResults: ToolResult[] }> {
  conversationHistory.push({ role: 'user', content: userMessage });

  const tools = getAllToolDefinitions();
  const toolResults: ToolResult[] = [];

  let messages: Anthropic.MessageParam[] = conversationHistory.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  while (true) {
    if (onChunk) {
      // Streaming path for the first call
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: tools as any,
        messages,
      });

      const response = await handleStreamingResponse(stream, onChunk);

      if (response.stopReason === 'tool_use') {
        // Process tool calls from the streamed response
        const assistantContent = response.content;
        messages = [...messages, { role: 'assistant', content: assistantContent }];

        const toolResultMessages: Anthropic.ToolResultBlockParam[] = [];
        for (const block of assistantContent) {
          if (block.type === 'tool_use') {
            const result = await executeTool(block.name, block.input);
            const toolResult: ToolResult = {
              name: block.name,
              result,
              displayType: getDisplayType(block.name),
            };
            toolResults.push(toolResult);
            onToolResult?.(toolResult);

            toolResultMessages.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        messages = [...messages, { role: 'user', content: toolResultMessages }];
        // Continue the loop — next iteration will stream the continuation
        continue;
      }

      // Final text response
      const finalText = response.text;
      conversationHistory.push({ role: 'assistant', content: finalText });
      return { text: finalText, toolResults };
    } else {
      // Non-streaming path
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: tools as any,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages = [...messages, { role: 'assistant', content: response.content }];

        const toolResultMessages: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const result = await executeTool(block.name, block.input);
            const toolResult: ToolResult = {
              name: block.name,
              result,
              displayType: getDisplayType(block.name),
            };
            toolResults.push(toolResult);
            onToolResult?.(toolResult);

            toolResultMessages.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          }
        }

        messages = [...messages, { role: 'user', content: toolResultMessages }];
        continue;
      }

      const finalText = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      conversationHistory.push({ role: 'assistant', content: finalText });
      return { text: finalText, toolResults };
    }
  }
}

async function handleStreamingResponse(
  stream: ReturnType<typeof client.messages.stream>,
  onChunk: (chunk: string) => void
): Promise<{
  text: string;
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
}> {
  let text = '';

  stream.on('text', (textDelta) => {
    text += textDelta;
    onChunk(textDelta);
  });

  const finalMessage = await stream.finalMessage();

  return {
    text,
    content: finalMessage.content,
    stopReason: finalMessage.stop_reason,
  };
}
