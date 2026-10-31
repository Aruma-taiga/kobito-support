import type { RetentionItem } from "@kobito/shared";

export interface RetentionModule {
  listRetention(): Promise<RetentionItem[]>;
}
