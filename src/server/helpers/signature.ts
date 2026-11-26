export function formatSignature(raw: string | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const superscripted = trimmed
    .split(/\s+/)
    .map((token) => `^${token}`)
    .join(' ');
  return `\n\n---\n\n${superscripted}`;
}
