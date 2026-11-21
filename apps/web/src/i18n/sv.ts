/** Swedish interface text. This catalogue defines which keys exist. */
export const sv = {
  'app.title': 'Skill Issue',
  'app.tagline': 'Har du ett skill issue? Fixa det.',
  'language.label': 'Språk',
  'start.empty.title': 'Inga ämnen än',
  'start.empty.body': 'Appen levereras utan ämnen. Ladda in ett subject pack via API:et eller kommandoraden, så dyker det upp här.',
  'status.loading': 'Kontaktar servern …',
  'status.ok': 'Servern svarar. Laddade moduler: {modules}.',
  'status.unavailable': 'Servern svarar, men databasen går inte att nå.',
  'status.unreachable': 'Servern går inte att nå.',
} as const;

export type MessageKey = keyof typeof sv;
export type Catalogue = Readonly<Record<MessageKey, string>>;
