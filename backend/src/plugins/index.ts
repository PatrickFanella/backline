/**
 * Plugin System for Backline
 *
 * This module provides a comprehensive plugin system for extending Backline functionality.
 * Plugins can hook into Discord events, register API routes, and access various services.
 */

export * from './types';
export { PluginLoader } from './PluginLoader';
export { PluginManager, pluginManager } from './PluginManager';
