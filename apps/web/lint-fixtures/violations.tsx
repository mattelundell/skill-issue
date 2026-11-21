// The browser app's rules: hooks are called unconditionally, and an effect
// names everything it reads.
import { useEffect, useState } from 'react';

export function Counter({ start, enabled }: { readonly start: number; readonly enabled: boolean }) {
  const [count, setCount] = useState(start);
  if (enabled) {
    useEffect(() => { // expect: react/hooks
      document.title = String(start);
    }, [start]);
  }
  useEffect(() => {
    document.title = String(start + 1);
  }, []); // expect-above: react-hooks/exhaustive-deps
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
