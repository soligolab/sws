/** The AI providers of the menu, as the runtime lists them (`ai/scopi.rs`,
 *  `FORNITORI`). Their names are in the language files, `aiProviders.<id>`. */
export const AI_PROVIDERS = ["anthropic", "kimi", "mistral", "openai", "bfl"] as const;
/** The providers an account can prefer, by kind (`ai_keys.rs`,
 *  `preference_fits`): the local model is the installation's, not a person's. */
export const AI_TEXT_PROVIDERS = ["anthropic", "kimi", "mistral"] as const;
export const AI_IMAGE_PROVIDERS = ["openai", "bfl"] as const;
