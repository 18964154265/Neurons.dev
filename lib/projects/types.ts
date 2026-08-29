export type ProjectSummary = {
  id: string;
  name: string;
  status: "ready" | "running" | "waiting" | "failed" | "stopped";
  resultStatus: "none" | "available" | "published";
  defaultMode: "engineer" | "team";
  defaultScheduleStrategy: "automatic" | "user_selected";
  activeRunId: string | null;
  latestSuccessfulVersionId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateProjectResult = {
  projectId: string;
  conversationId: string;
  messageId: string;
  runId: string;
  reused: boolean;
};
