"use client";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/message";
import { Loader } from "@/components/ai-elements/loader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useChat } from "@ai-sdk/react";
import {
  BotIcon,
  PlugIcon,
  SendHorizonalIcon,
  UserIcon,
  XCircleIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

export default function Home() {
  const { messages, sendMessage, stop, status, error } = useChat({
    api: "/api/chat",
    initialMessages: [
      {
        id: "intro",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "こんにちは！Vercel AI Gateway 経由で動くチャットです。質問やアイデアを送ってください。",
          },
        ],
      },
    ],
  });

  const [input, setInput] = useState("");
  const safeInput = input ?? "";
  const isLoading = status === "streaming" || status === "submitted";

  const hasMessages = useMemo(
    () => messages.length > 0,
    [messages.length]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-zinc-100 text-foreground dark:from-black dark:via-zinc-950 dark:to-black">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <PlugIcon className="size-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Vercel AI Gateway Chat
              </p>
              <h1 className="text-2xl font-semibold leading-tight sm:text-3xl">
                AI Gateway と接続したチャットデモ
              </h1>
            </div>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            `/api/chat` が AI Gateway 経由でモデルを呼び出します。環境変数
            `AI_GATEWAY_URL` と `AI_GATEWAY_API_KEY` を設定して使ってください。
          </p>
        </div>

        <Card className="flex min-h-[70vh] flex-col border bg-card/60 p-4 shadow-sm backdrop-blur-sm sm:p-6">
          <div className="flex flex-1 flex-col gap-4">
            <Conversation className="rounded-md border bg-background/50">
              <ConversationContent>
                {!hasMessages && (
                  <ConversationEmptyState
                    description="モデルがこのエリアに返信を流します。下のフォームから送信してください。"
                    icon={<BotIcon className="size-6" />}
                    title="まだメッセージがありません"
                  />
                )}

                {messages.map((message) => {
                  const text = (message.parts || [])
                    .filter((part) => part.type === "text")
                    .map((part) => "text" in part ? part.text : "")
                    .join("");

                  return (
                    <Message from={message.role} key={message.id}>
                      <MessageContent>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {message.role === "assistant" ? (
                            <BotIcon className="size-4" />
                          ) : (
                            <UserIcon className="size-4" />
                          )}
                          <span className="capitalize">{message.role}</span>
                        </div>
                        <MessageResponse>{text}</MessageResponse>
                      </MessageContent>
                    </Message>
                  );
                })}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>

            <MessageToolbar className="items-start">
              <form
                className="flex w-full flex-col gap-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const prompt = safeInput.trim();
                  if (!prompt || isLoading) return;
                  setInput("");
                  await sendMessage({ text: prompt });
                }}
              >
                <Textarea
                  autoFocus
                  className="min-h-[96px] resize-none"
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="AIに聞きたいことを書いてください..."
                  value={safeInput}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {error ? (
                      <div className="flex items-center gap-1 text-destructive">
                        <XCircleIcon className="size-4" />
                        <span>{error.message}</span>
                      </div>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-secondary-foreground">
                          <PlugIcon className="size-3" />
                          Gateway 経由
                        </span>
                        <Separator className="hidden h-4 sm:block" orientation="vertical" />
                        <span className="hidden sm:inline">/api/chat でストリーミング</span>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      disabled={!isLoading}
                      onClick={stop}
                      type="button"
                      variant="outline"
                    >
                      {isLoading ? "ストップ" : "停止"}
                    </Button>
                    <Button
                      className={cn("min-w-[120px]", isLoading && "pl-3")}
                      disabled={!safeInput.trim() || isLoading}
                      type="submit"
                    >
                      {isLoading ? (
                        <div className="flex items-center gap-2">
                          <Loader size={14} />
                          <span>送信中...</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <SendHorizonalIcon className="size-4" />
                          <span>送信</span>
                        </div>
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </MessageToolbar>
          </div>
        </Card>
      </main>
    </div>
  );
}
