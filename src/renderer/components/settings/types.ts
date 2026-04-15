import type { UserProviderConfig } from "@shared";

export interface EditingProvider extends UserProviderConfig {
  isNew?: boolean;
}

export type SectionType = "providers" | "development" | "about";
