import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";

/**
 * Table of contents — frontend-only scaffold.
 *
 * Renders an empty state for now. The chapter list (and click-to-jump, wired to
 * the paginated reader's current-chapter state) will be populated once the
 * backend/DB chapter contract exists. Kept intentionally free of data fetching
 * so this component is ready to receive a chapters prop later.
 *
 * Rendered inside the responsive reader-controls shell, which supplies the
 * panel title — so this is just the body.
 */
export const TableOfContents: FC = () => {
  const { t } = useTranslation("reader");
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
      <BookOpen className="size-6 opacity-50" />
      <p className="text-sm">{t("reader.toc.empty")}</p>
    </div>
  );
};
