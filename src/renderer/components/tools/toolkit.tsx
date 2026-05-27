import { type Toolkit } from "@assistant-ui/react";
import { genericToolkit } from "./genericToolkit";
import { hitlToolkit } from "./hitlToolkit";

export const frontendToolkit: Toolkit = {
  ...genericToolkit,
  ...hitlToolkit,
};
