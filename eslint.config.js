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
  {
    // Node scripts read their own environment at runtime, not Expo's inlined EXPO_PUBLIC_* vars.
    files: ['scripts/**'],
    languageOptions: { globals: { __dirname: 'readonly', require: 'readonly', process: 'readonly' } },
    rules: { 'expo/no-dynamic-env-var': 'off' },
  },
]);
