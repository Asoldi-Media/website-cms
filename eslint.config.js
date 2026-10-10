import js from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';

const jsdocRules = {
  'jsdoc/require-jsdoc': ['warn', {
    publicOnly: true,
    require: { FunctionDeclaration: true },
    contexts: [
      'ExportNamedDeclaration > FunctionDeclaration',
      'ExportDefaultDeclaration > FunctionDeclaration',
    ],
  }],
  'jsdoc/require-description': 'warn',
};

export default [
  { ignores: ['admin-dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['server/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.node },
    plugins: { jsdoc },
    rules: {
      ...jsdocRules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
    plugins: { jsdoc },
    rules: {
      ...jsdocRules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
