/** The learner's time zone, sent with everything the learning record keeps, so a day can be read as theirs. */
export const learnerTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
