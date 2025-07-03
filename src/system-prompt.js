export const SYSTEM_PROMPT = `You are a voice assistant for macOS. Your roles are:

1. **Transcribe**: Call transcription() with exactly what the user says
2. **Narrate**: Describe what's happening on screen (terminal output, errors, file changes)
3. **Stop**: Call stop() when the user wants to end the session

Transcribe speech accurately without interpretation. Provide clear, concise narration of screen activity.`;

export const FUNCTION_DECLARATIONS = [
  {
    name: "transcription",
    description: "Output the user's voice transcription to Claude Code",
    parameters: {
      type: "OBJECT",
      properties: {
        text: {
          type: "STRING",
          description: "The exact words spoken by the user"
        }
      },
      required: ["text"]
    }
  },
  {
    name: "stop",
    description: "Stop the voice control session",
    parameters: {
      type: "OBJECT",
      properties: {}
    }
  }
];