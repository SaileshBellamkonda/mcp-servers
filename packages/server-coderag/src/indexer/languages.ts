export interface LanguageConfig {
  name: string;
  extensions: string[];
  query: string;
  grammarKey: string;
}

export const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
  typescript: {
    name: 'typescript',
    grammarKey: 'typescript',
    extensions: ['.ts', '.tsx'],
    query: `
(function_declaration name: (identifier) @name) @function
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function
(class_declaration name: (type_identifier) @name) @class
(interface_declaration name: (type_identifier) @name) @interface
(method_definition name: (property_identifier) @name) @method
`,
  },

  javascript: {
    name: 'javascript',
    grammarKey: 'javascript',
    extensions: ['.js', '.jsx'],
    query: `
(function_declaration name: (identifier) @name) @function
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function
(class_declaration name: (identifier) @name) @class
(method_definition name: (property_identifier) @name) @method
`,
  },

  python: {
    name: 'python',
    grammarKey: 'python',
    extensions: ['.py'],
    query: `
(function_definition name: (identifier) @name) @function
(class_definition name: (identifier) @name) @class
`,
  },

  go: {
    name: 'go',
    grammarKey: 'go',
    extensions: ['.go'],
    query: `
(function_declaration name: (identifier) @name) @function
(method_declaration name: (field_identifier) @name) @method
(type_declaration (type_spec name: (type_identifier) @name type: (struct_type))) @struct
(type_declaration (type_spec name: (type_identifier) @name type: (interface_type))) @interface
`,
  },

  rust: {
    name: 'rust',
    grammarKey: 'rust',
    extensions: ['.rs'],
    query: `
(function_item name: (identifier) @name) @function
(struct_item name: (type_identifier) @name) @struct
(enum_item name: (type_identifier) @name) @struct
(trait_item name: (type_identifier) @name) @interface
(impl_item type: (type_identifier) @name) @struct
`,
  },

  php: {
    name: 'php',
    grammarKey: 'php',
    extensions: ['.php'],
    query: `
(function_definition name: (name) @name) @function
(method_declaration name: (name) @name) @method
(class_declaration name: (name) @name) @class
(interface_declaration name: (name) @name) @interface
`,
  },

  java: {
    name: 'java',
    grammarKey: 'java',
    extensions: ['.java'],
    query: `
(method_declaration name: (identifier) @name) @method
(class_declaration name: (identifier) @name) @class
(interface_declaration name: (identifier) @name) @interface
(constructor_declaration name: (identifier) @name) @function
`,
  },

  csharp: {
    name: 'csharp',
    grammarKey: 'c_sharp',
    extensions: ['.cs'],
    query: `
(method_declaration name: (identifier) @name) @method
(class_declaration name: (identifier) @name) @class
(interface_declaration name: (identifier) @name) @interface
(constructor_declaration name: (identifier) @name) @function
`,
  },

  cpp: {
    name: 'cpp',
    grammarKey: 'cpp',
    extensions: ['.cpp', '.cc', '.cxx', '.hpp'],
    query: `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @function
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @name))) @method
(class_specifier name: (type_identifier) @name) @class
(struct_specifier name: (type_identifier) @name) @struct
`,
  },

  c: {
    name: 'c',
    grammarKey: 'c',
    extensions: ['.c', '.h'],
    query: `
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @function
(struct_specifier name: (type_identifier) @name) @struct
`,
  },

  ruby: {
    name: 'ruby',
    grammarKey: 'ruby',
    extensions: ['.rb'],
    query: `
(method name: (identifier) @name) @method
(singleton_method name: (identifier) @name) @method
(class name: (constant) @name) @class
(module name: (constant) @name) @class
`,
  },

  bash: {
    name: 'bash',
    grammarKey: 'bash',
    extensions: ['.sh', '.bash'],
    query: `
(function_definition name: (word) @name) @function
`,
  },

  vue: {
    name: 'vue',
    grammarKey: 'html',
    extensions: ['.vue'],
    query: `
(script_element (raw_text) @script)
`,
  },
};

const extensionMap: Record<string, string> = {};
for (const [key, config] of Object.entries(SUPPORTED_LANGUAGES)) {
  for (const ext of config.extensions) {
    extensionMap[ext] = key;
  }
}

export function getLanguageByExtension(ext: string): LanguageConfig | undefined {
  const key = extensionMap[ext.toLowerCase()];
  return key ? SUPPORTED_LANGUAGES[key] : undefined;
}

export function isSupportedExtension(ext: string): boolean {
  return ext.toLowerCase() in extensionMap;
}
