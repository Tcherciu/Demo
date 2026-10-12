export const colors = {
  bg: '#F4F6F3',
  card: '#FFFFFF',
  text: '#13201A',
  muted: '#667085',
  border: '#E4E7EC',
  primary: '#F0571B',
  primaryText: '#FFFFFF',
  good: '#12B76A',
  warn: '#F79009',
  bad: '#D92D20',
  gold: '#EAAA08',
  /** Brand ground, from the app icon. */
  brandDark: '#0F1C17',
};

export const difficultyColor = (score: number) =>
  score < 3 ? '#12B76A' : score < 5 ? '#84CC16' : score < 7 ? '#F79009' : score < 8.5 ? '#E8590C' : '#D92D20';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
