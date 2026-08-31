import { parseSpecialFormat } from "../api/format";

export interface FormattedTextProps {
    text: string;
    className?: string;
}

/**
 * Renders a §-formatted item/fluid name. Server-controlled text only (AE2 registry display names) -
 * see the trust-boundary note on `parseSpecialFormat`.
 */
export function FormattedText({ text, className }: FormattedTextProps) {
    if (!text.includes("§")) return <span className={className}>{text}</span>;
    return <span className={className} dangerouslySetInnerHTML={{ __html: parseSpecialFormat(text) }} />;
}
