// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'supabase/functions/*'],
  },
  {
    // React Native <Text> renders apostrophes literally; this rule is for HTML.
    rules: { 'react/no-unescaped-entities': 'off' },
  },
]);
