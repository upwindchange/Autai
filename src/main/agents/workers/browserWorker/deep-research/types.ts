import type { ExtractionResult } from "../browser-research/result-extractor";

export interface Subtopic {
  id: string;
  title: string;
  question: string;
  rationale: string;
}

export interface DeepResearchPlan {
  id: string;
  title: string;
  researchQuestion: string;
  subtopics: Subtopic[];
}

export interface SubtopicResult {
  subtopic: Subtopic;
  extractionResults: ExtractionResult[];
  summaryText: string;
  relevantResults: ExtractionResult[];
}

export interface GlobalCitationEntry {
  globalIndex: number;
  url: string;
  title: string;
  summary: string;
  quotes: string[];
}

export interface RemappedSubtopic {
  subtopic: Subtopic;
  text: string;
}
