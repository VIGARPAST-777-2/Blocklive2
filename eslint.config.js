/** @type {import('eslint').Linter.Config[]} */
module.exports = [
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module', // sigue siendo módulo para tu código
            globals: {
                browser: true,
                node: true,
                es6: true,
            },
        },
        rules: {
            'indent': ['error', 4],
            'quotes': ['error', 'single'],
            'semi': ['error', 'always'],
            'comma-dangle': ['error', 'always-multiline'],
            'no-console': 'off',
        },
    },
];
