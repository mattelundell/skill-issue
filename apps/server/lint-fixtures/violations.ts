// Every line marked `expect:` must be reported with exactly that rule, and no
// other line may be reported. See scripts/check-lint-rules.ts.

type Shape = { readonly kind: 'circle' } | { readonly kind: 'square' } | { readonly kind: 'line' };

declare function parse(text: string): unknown;
declare function save(value: string): Promise<void>;
declare const maybe: string | undefined;

export function silencedChecker(input: any): string { // expect: typescript/no-explicit-any
  const asserted = parse('x') as string; // expect: typescript/consistent-type-assertions, typescript/no-unsafe-type-assertion
  const forced = maybe!; // expect: typescript/no-non-null-assertion
  // @ts-ignore
  const ignored: number = 'not a number'; // expect-above: typescript/ban-ts-comment
  return asserted + forced + String(ignored) + String(input);
}

export function droppedFailure(shape: Shape, text: string): number {
  save(text); // expect: typescript/no-floating-promises
  try {
    parse(text);
  } catch {} // expect: eslint/no-empty
  switch (shape.kind) { // expect: typescript/switch-exhaustiveness-check
    case 'circle':
      return 1;
    case 'square':
      return 2;
  }
  throw 'unreachable'; // expect: typescript/only-throw-error
}

export function coerced(count: number, label: string | undefined): string {
  if (count) { // expect: typescript/strict-boolean-expressions
    return 'some';
  }
  return label == undefined ? 'none' : label; // expect: eslint/eqeqeq
}

export function mutated(options: { limit: number }): number {
  options.limit = 10; // expect: eslint/no-param-reassign
  let fixed = options.limit; // expect: eslint/prefer-const
  console.log(fixed); // expect: eslint/no-console
  return fixed;
}

// oxlint-disable-next-line eslint/no-console -- nothing on the next line logs
export const unusedSuppression = 1; // expect-above: unused-disable-directive
