/**
 * A translated message with one `{placeholder}` left in it, drawn with the
 * placeholder's value set as code — a command or an id the reader may copy.
 */
export function WithCode({ text, placeholder, code }: { readonly text: string; readonly placeholder: string; readonly code: string }) {
  const marker = `{${placeholder}}`;
  const at = text.indexOf(marker);
  if (at < 0) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, at)}
      <code>{code}</code>
      {text.slice(at + marker.length)}
    </>
  );
}
