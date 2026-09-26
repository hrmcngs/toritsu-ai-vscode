/** Remove a single surrounding Markdown fence without trimming source indentation. */
export function sanitizeResponse(response: string): string {
  const fenced = /^\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(response);
  return fenced ? fenced[1] : response;
}
