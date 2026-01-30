"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AVAILABLE_MODELS,
  getVisionModels,
  type LLMProvider,
  type ModelConfig,
} from "@/lib/llm-providers";

type Props = {
  value: string;
  onChange: (modelId: string) => void;
  filterVision?: boolean;
  className?: string;
};

const PROVIDER_LABELS: Record<LLMProvider, string> = {
  openai: "OpenAI",
  groq: "Groq",
  gemini: "Gemini",
};

function groupByProvider(models: ModelConfig[]): Record<LLMProvider, ModelConfig[]> {
  const grouped: Record<LLMProvider, ModelConfig[]> = {
    openai: [],
    groq: [],
    gemini: [],
  };

  for (const model of models) {
    grouped[model.provider].push(model);
  }

  return grouped;
}

export function ModelSelector({ value, onChange, filterVision, className }: Props) {
  const models = filterVision ? getVisionModels() : AVAILABLE_MODELS;
  const grouped = groupByProvider(models);
  const providers = (Object.keys(grouped) as LLMProvider[]).filter(
    (p) => grouped[p].length > 0
  );

  const selectedModel = models.find((m) => m.id === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="モデルを選択">
          {selectedModel?.name ?? "モデルを選択"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {providers.map((provider) => (
          <SelectGroup key={provider}>
            <SelectLabel>{PROVIDER_LABELS[provider]}</SelectLabel>
            {grouped[provider].map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
                {model.supportsVision && (
                  <span className="ml-1.5 text-xs text-muted-foreground">(Vision)</span>
                )}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
