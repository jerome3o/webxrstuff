// Phase-2 feature plugins. Each default-exports `async install(game, ctx)` returning { dispose() }.
// Module top-level code runs before create(), so plugins may register blocks/items/tiles at import time.
import crafting from './plugins/crafting.js';
import survival from './plugins/survival.js';

export const PLUGINS = [crafting, survival];
