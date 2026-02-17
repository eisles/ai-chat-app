export type ConversationStepKey =
  | "purpose"
  | "budget"
  | "category"
  | "delivery"
  | "additional";

export type SlotState = {
  budget?: string;
  category?: string;
  purpose?: string;
  delivery?: string[];
  allergen?: string;
  prefecture?: string;
  cityCode?: string;
  negativeKeywords?: string[];
};

export type ConversationSession = {
  slots: SlotState;
  askedKeys: ConversationStepKey[];
};
