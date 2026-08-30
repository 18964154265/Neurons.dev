export type TextareaSubmitKey = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
};

export function shouldSubmitTextareaOnEnter(event: TextareaSubmitKey) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
