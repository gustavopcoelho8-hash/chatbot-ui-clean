import { CHAT_SETTING_LIMITS } from "@/lib/chat-setting-limits"
import { checkApiKey, getServerProfile } from "@/lib/server/server-chat-helpers"
import { getBase64FromDataURL, getMediaTypeFromDataURL } from "@/lib/utils"
import { ChatSettings } from "@/types"
import Anthropic from "@anthropic-ai/sdk"
import { AnthropicStream, StreamingTextResponse } from "ai"
import { NextRequest, NextResponse } from "next/server"

export const runtime = "edge"

export async function POST(request: NextRequest) {
  const json = await request.json()
  const { chatSettings, messages } = json as {
    chatSettings: ChatSettings
    messages: any[]
  }

  try {
    const profile = await getServerProfile()
    checkApiKey(profile.anthropic_api_key, "Anthropic")

    // ✅ Format messages for Anthropic API
    const ANTHROPIC_FORMATTED_MESSAGES = messages
      .slice(1)
      .map((message: any) => {
        const messageContent =
          typeof message?.content === "string"
            ? [message.content]
            : message?.content

        return {
          ...message,
          content: messageContent.map((content: any) => {
            if (typeof content === "string") {
              return { type: "text", text: content }
            } else if (
              content?.type === "image_url" &&
              content?.image_url?.url?.length
            ) {
              return {
                type: "image",
                source: {
                  type: "base64",
                  media_type: getMediaTypeFromDataURL(content.image_url.url),
                  data: getBase64FromDataURL(content.image_url.url)
                }
              }
            } else {
              return content
            }
          })
        }
      })

    const anthropic = new Anthropic({
      apiKey: profile.anthropic_api_key || ""
    })

    // ✅ Always define a valid max_tokens (integer)
    const maxTokens =
      CHAT_SETTING_LIMITS?.[chatSettings.model]?.MAX_TOKEN_OUTPUT_LENGTH || 4096

    // ✅ Build payload safely
    const response = await anthropic.messages.create({
      model: chatSettings.model,
      messages: ANTHROPIC_FORMATTED_MESSAGES,
      temperature: chatSettings.temperature ?? 0.7,
      system: messages[0]?.content ?? "You are a helpful assistant.",
      max_tokens: maxTokens,
      stream: true
    })

    // ✅ Handle streaming response
    const stream = AnthropicStream(response)
    return new StreamingTextResponse(stream)
  } catch (error: any) {
    console.error("🔥 Anthropic route error:", error)

    let errorMessage =
      error?.error?.message ||
      error?.message ||
      "An unexpected error occurred with Anthropic."
    const errorCode = error?.status || 500

    if (errorMessage.toLowerCase().includes("api key not found")) {
      errorMessage =
        "Anthropic API Key not found. Please set it in your profile settings."
    } else if (errorCode === 401) {
      errorMessage =
        "Anthropic API Key is incorrect. Please fix it in your profile settings."
    }

    return new NextResponse(JSON.stringify({ message: errorMessage }), {
      status: errorCode
    })
  }
}
