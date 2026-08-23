import Anthropic from '@anthropic-ai/sdk';
import { ConversationMessage, ToolResult } from './types';
import { getAllToolDefinitions, executeTool } from './tools';

const client = new Anthropic();

const SYSTEM_PROMPT = `You are Jarvis, an advanced AI assistant inspired by the AI from Iron Man. You are witty, sophisticated, and efficient. Address the user as 'ma'am'. Keep responses concise and conversational — they will be spoken aloud, so avoid markdown formatting, bullet points, or long lists. When using tools, briefly explain what you're doing. Your personality is helpful, slightly dry humor, and supremely competent.

You have web research capabilities. Use them proactively when the user asks about current events, needs information you are unsure about, or wants to research something.

WEB RESEARCH MODE:
When asked to research any topic, look up news, or find current information:
1. Use web_search to find relevant results. Try 2-3 different search queries for thorough coverage.
2. Use read_webpage on the most promising URLs to get full details.
3. Synthesize your findings into a clear, honest answer in plain English. Sidestep jargon — if a technical term is needed, explain it in one clause.
4. Always mention your sources. Distinguish facts from estimates.
5. Keep your spoken response to 2-4 crisp sentences with the key takeaway first. The detailed results appear in the tool panel for the user to review.

STARTUP RESEARCH MODE:
When asked to evaluate a startup idea, analyze competitors, assess a market, or validate a business concept:
1. Search for direct competitors and existing solutions in the space.
2. Search for market size, total addressable market, and industry growth data.
3. Read 2-3 key pages (competitor sites, industry reports) for deeper analysis.
4. Search for recent trends, funding news, and shifts in the space.
5. Deliver a brutally honest assessment covering: market opportunity (with numbers if found), competition intensity, differentiation potential, key risks, and your candid recommendation.
Be radically honest. If the idea has fatal flaws, say so plainly. Label your confidence — say when data is solid versus when you are estimating. The user wants the truth, not flattery.
Keep your spoken summary to 3-4 sentences. Lead with the most important finding.

NEWS MODE:
For news headlines by category, use get_news. For deeper research on a specific news topic, use web_search and read_webpage to get the full story, then explain it simply.`;

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
    web_search: 'search',
    read_webpage: 'webpage',
  };
  return map[toolName] || 'text';
}

export async function processMessage(
  userMessage: string,
  conversationHistory: ConversationMessage[],
  onChunk?: (chunk: string) => void,
  onToolResult?: (result: ToolResult) => void,
  // Speech pipeline (cloud TTS). onDelta receives streamed text to synthesize;
  // onReset is fired when a turn turns out to be a tool-use turn (i.e. interim
  // narration like "Let me search that"), telling the pipeline to discard that
  // turn's buffered text so ONLY the final answer is ever spoken. Kept separate
  // from onChunk (which drives the on-screen transcript for every turn).
  speech?: { onDelta: (delta: string) => void; onReset: () => void }
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
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: tools as any,
        messages,
      });

      const response = await handleStreamingResponse(stream, onChunk, speech);

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
        max_tokens: 4096,
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
  onChunk: (chunk: string) => void,
  speech?: { onDelta: (delta: string) => void; onReset: () => void }
): Promise<{
  text: string;
  content: Anthropic.ContentBlock[];
  stopReason: string | null;
}> {
  let text = '';

  stream.on('text', (textDelta) => {
    text += textDelta;
    onChunk(textDelta);
    // Feed the voice pipeline live so the final answer is spoken in real time.
    speech?.onDelta(textDelta);
  });

  // A tool_use block starting means this turn is interim narration, not the
  // final answer — tell the voice pipeline to drop this turn's buffered text so
  // filler like "Let me search that, ma'am" is never synthesized. Any leftover
  // buffered narration is still below the min chunk size at this point, so
  // nothing has been sent to the voice yet.
  stream.on('streamEvent', (event: any) => {
    if (event?.type === 'content_block_start' && event?.content_block?.type === 'tool_use') {
      speech?.onReset();
    }
  });

  const finalMessage = await stream.finalMessage();

  return {
    text,
    content: finalMessage.content,
    stopReason: finalMessage.stop_reason,
  };
}
