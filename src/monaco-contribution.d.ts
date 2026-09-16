/**
 * Ambient declaration for Monaco's Monarch language-grammar bundle: a
 * side-effect import that registers every basic-language tokenizer. There is
 * no matching .d.ts in monaco-editor's esm build (the deep import is beyond
 * the package's exports map, and the module carries no types).
 */
declare module 'monaco-editor/esm/vs/basic-languages/monaco.contribution' {}
