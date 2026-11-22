import { defineMessages } from '../../shell/messages.js';

const sv = {
  'also': 'Kallas också {names}',
  'sources.one': 'Källa',
  'sources.other': 'Källor',
  'image': 'Bild: {alt}',
};

const en: Readonly<Record<keyof typeof sv, string>> = {
  'also': 'Also called {names}',
  'sources.one': 'Source',
  'sources.other': 'Sources',
  'image': 'Image: {alt}',
};

export const catalogues = { sv, en };
export const useMessages = defineMessages(catalogues);
